/**
 * Message catalogue checks. Run: npm run test:i18n
 *
 * The failure mode this exists to catch is silent: someone adds an English
 * string, forgets the Thai, and a Thai customer sees a bare key or English text
 * in the middle of a Thai page. Nothing else in the build notices.
 *
 * No database and no network — pure file checks, so it runs anywhere.
 */
import fs from "node:fs";
import path from "node:path";

import { createTranslator } from "use-intl/core";

import { LANGUAGES, LANGUAGE_ORDER, localeFor } from "../src/lib/languages";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}`);
    if (detail !== undefined) console.log("   ", detail);
  }
}

type Messages = Record<string, unknown>;

function load(language: string): Messages {
  const file = path.join("messages", `${language.toLowerCase()}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Messages;
}

/** Every leaf key, dot-joined. */
function keysOf(value: Messages, prefix = ""): Set<string> {
  const out = new Set<string>();
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      for (const nested of keysOf(child as Messages, full)) out.add(nested);
    } else {
      out.add(full);
    }
  }
  return out;
}

function entriesOf(value: Messages, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      out.push(...entriesOf(child as Messages, full));
    } else {
      out.push([full, String(child)]);
    }
  }
  return out;
}

/** `{name}` placeholders, which must survive translation exactly. */
function placeholders(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/\{(\w+)[^}]*\}/g)].map((match) => match[1]),
  );
}

console.log("\n--- every language has a catalogue ---");
const catalogues = new Map<string, Messages>();
for (const language of LANGUAGE_ORDER) {
  const file = path.join("messages", `${language.toLowerCase()}.json`);
  const exists = fs.existsSync(file);
  check(`${language}: ${file} exists`, exists);
  if (exists) catalogues.set(language, load(language));
}

const base = catalogues.get("EN");
if (!base) {
  console.log("\nNo English catalogue — nothing further can be checked.\n");
  process.exit(1);
}
const baseKeys = keysOf(base);
console.log(`\n  (${baseKeys.size} keys in the English catalogue)`);

console.log("\n--- key parity ---");
for (const [language, messages] of catalogues) {
  if (language === "EN") continue;
  const theirs = keysOf(messages);
  const missing = [...baseKeys].filter((key) => !theirs.has(key));
  const extra = [...theirs].filter((key) => !baseKeys.has(key));

  // Missing keys are the real bug: the UI falls back to the key itself.
  check(`${language}: no missing keys`, missing.length === 0, missing);
  // Extra keys are dead weight — usually a rename that only landed on one side.
  check(`${language}: no orphaned keys`, extra.length === 0, extra);
}

console.log("\n--- placeholders survive translation ---");
for (const [language, messages] of catalogues) {
  if (language === "EN") continue;
  const theirs = new Map(entriesOf(messages));
  const broken: string[] = [];

  for (const [key, english] of entriesOf(base)) {
    const translated = theirs.get(key);
    if (translated === undefined) continue;

    const want = placeholders(english);
    const got = placeholders(translated);
    const same =
      want.size === got.size && [...want].every((name) => got.has(name));
    if (!same) {
      broken.push(`${key}: expected {${[...want]}} but found {${[...got]}}`);
    }
  }

  // A dropped placeholder renders as literal text to the customer; a renamed
  // one throws at render time.
  check(`${language}: placeholders intact`, broken.length === 0, broken);
}

console.log("\n--- nothing left untranslated ---");
for (const [language, messages] of catalogues) {
  if (language === "EN") continue;
  const english = new Map(entriesOf(base));
  const identical: string[] = [];

  for (const [key, translated] of entriesOf(messages)) {
    const source = english.get(key);
    if (source === undefined) continue;
    // Placeholders and punctuation are legitimately identical across languages,
    // so compare only the prose around them.
    const strip = (text: string) =>
      text.replace(/\{[^}]*\}/g, "").replace(/[^\p{L}]/gu, "");
    const a = strip(source);
    const b = strip(translated);
    if (a.length > 2 && a === b) identical.push(key);
  }

  check(
    `${language}: no strings copied verbatim from English`,
    identical.length === 0,
    identical,
  );
}

console.log("\n--- translations actually resolve ---");
for (const [language, messages] of catalogues) {
  const t = createTranslator({
    locale: localeFor(language as keyof typeof LANGUAGES),
    messages: messages as never,
  });
  // A representative key from a nested namespace, to prove the shape is right.
  const resolved = t("nav.jobPosts" as never) as string;
  check(
    `${language}: nav.jobPosts resolves`,
    typeof resolved === "string" &&
      resolved.length > 0 &&
      !resolved.startsWith("nav."),
    resolved,
  );
}

console.log("\n--- date formatting per locale ---");
{
  const iso = "2026-09-02T00:00:00.000Z";
  const format = (locale: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(iso));

  check(
    "EN renders Latin script",
    /Sep/i.test(format(localeFor("EN"))),
    format(localeFor("EN")),
  );
  check(
    "TH renders Thai script",
    /[฀-๿]/.test(format(localeFor("TH"))),
    format(localeFor("TH")),
  );

  // Guards the calendar decision in languages.ts: Thai months, GREGORIAN years,
  // so app dates match Stripe's invoices. Dropping the -u-ca-gregory extension
  // would silently render 2569 here and 2026 on the invoice.
  check(
    "TH uses Gregorian years (2026, not the Buddhist 2569)",
    format(localeFor("TH")).includes("2026") &&
      !format(localeFor("TH")).includes("2569"),
    format(localeFor("TH")),
  );
}

console.log(
  failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
