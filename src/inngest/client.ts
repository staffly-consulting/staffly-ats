import { Inngest } from "inngest";

import type { InboundAttachment } from "@/lib/inbound-email";

/**
 * Event catalogue for the screening pipeline.
 *
 * Inngest v4 types events per-trigger rather than on the client, so this map is
 * the shared reference that senders and function triggers both point at.
 */
export interface StafflyEvents {
  /**
   * An email arrived at an org's forwarding alias and passed signature
   * verification. Carries the whole message: the webhook does no work beyond
   * resolving the alias to an org, so everything the processing function needs
   * has to travel in the payload.
   */
  "resume/received": {
    orgId: string;
    emailInboxId: string;
    messageId: string;
    fromEmail: string | null;
    fromName: string | null;
    subject: string | null;
    text: string | null;
    receivedAt: string;
    attachments: InboundAttachment[];
  };
  /**
   * A `Candidate` row exists with a resume in Storage. Fired by the ingestion
   * function, and re-fired by the manual retry action.
   */
  "candidate/created": {
    orgId: string;
    candidateId: string;
    /** Distinguishes a recruiter-triggered retry from first-time ingestion. */
    retry?: boolean;
  };
  /**
   * A candidate has both `extractedData` and a `jobPostId`. Fired from
   * extraction (when already assigned) and from assignment (when already
   * extracted) — whichever half lands last.
   */
  /**
   * A candidate ended up in `ERROR`. Consumed by the batched notification
   * function so a burst of failures becomes one email, not twenty.
   */
  "candidate/processing-failed": {
    orgId: string;
    candidateId: string;
    stage: "extraction" | "scoring";
  };
  /**
   * One application counted past an org's included pool. Consumed by the
   * Stripe meter reporter — kept async so ingestion never waits on billing.
   */
  "billing/overage-recorded": {
    orgId: string;
    candidateId: string;
    /** The `UsageLedgerEntry` this event bills for; also the Stripe idempotency key. */
    ledgerEntryId: string;
    stripeCustomerId: string | null;
  };
  "candidate/ready-for-scoring": {
    orgId: string;
    candidateId: string;
    /** Set by the Re-score action; overwrites an existing CandidateScore. */
    force?: boolean;
  };
}

export const inngest = new Inngest({
  id: "staffly-ats",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
