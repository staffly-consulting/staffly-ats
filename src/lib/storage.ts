import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";

/**
 * Supabase Storage access for resume files and raw email archives.
 *
 * Everything here runs with the service-role key, because the caller is an
 * Inngest function with no user session. That bypasses Storage RLS, so the
 * object path is what enforces tenancy: every key is prefixed with `orgId`,
 * and the org id always comes from the `EmailInbox` row the alias resolved to —
 * never from anything in the email itself.
 *
 * The bucket must be created manually and kept PRIVATE; see the README.
 */

export const RESUME_BUCKET = "resumes";

export interface StoredObject {
  /** `bucket/path`, which is what goes in `Candidate.resumeFileUrl`. */
  key: string;
  bytes: number;
}

/** `{orgId}/{candidateId}/{filename}` inside the `resumes` bucket. */
export function resumeObjectPath(
  orgId: string,
  candidateId: string,
  filename: string,
): string {
  return `${orgId}/${candidateId}/${filename}`;
}

/**
 * One archive per inbound message, not per candidate: an agency email carrying
 * three CVs produces three candidates that all reference the same raw source,
 * which is what you want when auditing where a record came from.
 */
export function rawEmailObjectPath(orgId: string, messageId: string): string {
  const safeId = messageId.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  return `${orgId}/_raw-emails/${safeId}.json`;
}

export async function uploadObject(
  path: string,
  body: Uint8Array | string,
  contentType: string,
): Promise<StoredObject> {
  const supabase = createServiceRoleSupabaseClient();

  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;

  const { error } = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(path, bytes, {
      contentType,
      // Retries of the same Inngest step must not fail on a second attempt.
      upsert: true,
    });

  if (error) {
    throw new Error(
      `Supabase Storage upload failed for ${RESUME_BUCKET}/${path}: ${error.message}`,
    );
  }

  return { key: `${RESUME_BUCKET}/${path}`, bytes: bytes.byteLength };
}

/**
 * Reads a stored object back into memory.
 *
 * Service-role, so no RLS: the caller must already have established that the
 * key belongs to the org it is acting for. Every key here originates from a
 * `Candidate` row that was itself fetched with an `orgId` filter.
 */
export async function downloadObject(
  key: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const supabase = createServiceRoleSupabaseClient();
  const path = key.startsWith(`${RESUME_BUCKET}/`)
    ? key.slice(RESUME_BUCKET.length + 1)
    : key;

  const { data, error } = await supabase.storage
    .from(RESUME_BUCKET)
    .download(path);

  if (error || !data) {
    throw new Error(
      `Supabase Storage download failed for ${RESUME_BUCKET}/${path}: ${error?.message ?? "no body returned"}`,
    );
  }

  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    contentType: data.type || "application/octet-stream",
  };
}

/**
 * Removes every object under an org's prefix.
 *
 * Called when an organization is deleted in Clerk. Storage sits outside the
 * foreign-key graph, so the `onDelete: Cascade` chain that clears the database
 * does not reach the files — without this, every candidate's CV would sit in
 * the bucket forever with no row pointing at it and no way to reach it.
 *
 * Supabase Storage has no recursive delete, so this walks the prefix. Returns
 * the number of objects removed. Never throws: a storage failure must not turn
 * an otherwise-successful deletion into a webhook retry that re-runs the
 * database delete.
 */
export async function deleteOrgObjects(orgId: string): Promise<number> {
  const supabase = createServiceRoleSupabaseClient();
  let removed = 0;

  async function walk(prefix: string, depth = 0): Promise<void> {
    // Guard against a pathological tree; our own layout is only two levels
    // ({orgId}/{candidateId}/file and {orgId}/_raw-emails/file).
    if (depth > 4) return;

    const { data, error } = await supabase.storage
      .from(RESUME_BUCKET)
      .list(prefix, { limit: 1000 });

    if (error) {
      console.error(`[storage] could not list ${prefix}`, error);
      return;
    }
    if (!data || data.length === 0) return;

    // Entries with no `id` are prefixes (folders), not objects.
    const files = data.filter((entry) => entry.id !== null);
    const folders = data.filter((entry) => entry.id === null);

    if (files.length > 0) {
      const paths = files.map((entry) => `${prefix}/${entry.name}`);
      const { error: removeError } = await supabase.storage
        .from(RESUME_BUCKET)
        .remove(paths);

      if (removeError) {
        console.error(
          `[storage] could not remove ${paths.length} objects under ${prefix}`,
          removeError,
        );
      } else {
        removed += paths.length;
      }
    }

    for (const folder of folders) {
      await walk(`${prefix}/${folder.name}`, depth + 1);
    }
  }

  try {
    await walk(orgId);
  } catch (error) {
    console.error(`[storage] failed to clear objects for org ${orgId}`, error);
  }

  return removed;
}

/**
 * Short-lived signed URL for reading a stored object.
 *
 * The bucket is private, so this is the only way to hand a file to a browser.
 * Callers must have already established that the object belongs to the caller's
 * org — this function does not check, it only signs.
 */
export async function createSignedUrl(
  key: string,
  expiresInSeconds = 60 * 10,
): Promise<string | null> {
  const supabase = createServiceRoleSupabaseClient();
  const path = key.startsWith(`${RESUME_BUCKET}/`)
    ? key.slice(RESUME_BUCKET.length + 1)
    : key;

  const { data, error } = await supabase.storage
    .from(RESUME_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error) {
    console.error(`[storage] could not sign ${key}`, error);
    return null;
  }

  return data?.signedUrl ?? null;
}
