/**
 * Tests for the plan's job post limit. Run: npm run test:job-post-limit
 *
 * Pure — no network, no database. Two halves:
 *
 *   1. The RULE, through `jobPostOpeningDecision`, which is the exact function
 *      the server calls with the counts it fetched.
 *   2. The WIRING: every path that can make a post OPEN must ask that rule
 *      first. A limit checked on create but not on reopen is no limit at all —
 *      close a post, reopen it, repeat — and nothing else would notice the
 *      missing call, because the app keeps working perfectly.
 */
import fs from "node:fs";
import path from "node:path";

import {
  PLANS,
  canOpenJobPost,
  jobPostLimitMessage,
  jobPostOpeningDecision,
} from "../src/lib/plans";
import type { JobPostStatus, PlanTier } from "@prisma/client";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, detail ?? "");
  }
}

function decide(
  tier: PlanTier,
  currentStatus: JobPostStatus | null,
  openCount: number,
) {
  return jobPostOpeningDecision({ tier, currentStatus, openCount });
}

console.log("\n--- the limits themselves ---");
check(
  "open job post limits are 3 / 15 / unlimited / unlimited",
  PLANS.SHORTLIST.jobPostLimit === 3 &&
    PLANS.PIPELINE.jobPostLimit === 15 &&
    PLANS.TALENT_POOL.jobPostLimit === null &&
    PLANS.ENTERPRISE.jobPostLimit === null,
);

console.log("\n--- creating a post as OPEN ---");
check(
  "Shortlist with 0 open may open one",
  decide("SHORTLIST", null, 0).allowed,
);
check(
  "Shortlist with 2 open may open a 3rd",
  decide("SHORTLIST", null, 2).allowed,
);
check(
  "Shortlist with 3 open may NOT open a 4th",
  !decide("SHORTLIST", null, 3).allowed,
);
check(
  "Pipeline with 14 open may open a 15th",
  decide("PIPELINE", null, 14).allowed,
);
check(
  "Pipeline with 15 open may NOT open a 16th",
  !decide("PIPELINE", null, 15).allowed,
);
check(
  "Talent Pool is never limited",
  decide("TALENT_POOL", null, 100_000).allowed,
);
check(
  "Enterprise is never limited",
  decide("ENTERPRISE", null, 100_000).allowed,
);

console.log("\n--- publishing a draft, reopening a closed post ---");
check(
  "publishing a DRAFT at the limit is refused",
  !decide("SHORTLIST", "DRAFT", 3).allowed,
);
check(
  "publishing a DRAFT under the limit is allowed",
  decide("SHORTLIST", "DRAFT", 2).allowed,
);
check(
  "reopening a CLOSED post at the limit is refused",
  !decide("SHORTLIST", "CLOSED", 3).allowed,
);
check(
  "reopening a CLOSED post under the limit is allowed",
  decide("SHORTLIST", "CLOSED", 2).allowed,
);

console.log("\n--- editing a post that is already open ---");
check(
  "saving an OPEN post at the limit is allowed — it is not a new opening",
  decide("SHORTLIST", "OPEN", 3).allowed,
);
check(
  "saving an OPEN post while OVER the limit (after a downgrade) is allowed",
  decide("SHORTLIST", "OPEN", 9).allowed,
);
check(
  "but an org over the limit cannot open another",
  !decide("SHORTLIST", "DRAFT", 9).allowed && !canOpenJobPost("SHORTLIST", 9),
);

console.log("\n--- the refusal explains the way out ---");
const refusal = decide("SHORTLIST", null, 3);
check(
  "a refusal carries the message",
  !refusal.allowed && refusal.error === jobPostLimitMessage("SHORTLIST"),
  refusal,
);
check(
  "Shortlist is pointed at Pipeline and its limit",
  jobPostLimitMessage("SHORTLIST").includes("Pipeline for 15"),
  jobPostLimitMessage("SHORTLIST"),
);
check(
  "Pipeline is pointed at Talent Pool, which is unlimited",
  jobPostLimitMessage("PIPELINE").includes("Talent Pool for unlimited"),
  jobPostLimitMessage("PIPELINE"),
);
check(
  "the message says drafts do not count",
  jobPostLimitMessage("SHORTLIST").includes("Drafts do not count"),
);

console.log("\n--- every path that can make a post OPEN checks the limit ---");
/**
 * The three ways a post becomes OPEN, and what each must contain. Reading the
 * source is crude, but it is the only check that fails when someone adds a
 * fourth path, or refactors one of these, and forgets the limit.
 */
const GUARDED_PATHS = [
  { file: "src/app/api/job-posts/route.ts", why: "creating a post as OPEN" },
  {
    file: "src/app/api/job-posts/[id]/route.ts",
    why: "publishing a draft from the edit form",
  },
  {
    file: "src/app/(dashboard)/dashboard/jobs/lifecycle.actions.ts",
    why: "reopening a closed post",
  },
];
for (const { file, why } of GUARDED_PATHS) {
  const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
  check(`${why} (${file})`, source.includes("checkCanOpenJobPost("));
}

/**
 * The other side of the same guarantee: any new code that writes OPEN to a job
 * post must be one of the guarded paths above. Restore is excluded on purpose —
 * it never lands on OPEN (see `statusAfterRestore`).
 */
const LIFECYCLE = fs.readFileSync(
  path.join(process.cwd(), "src/lib/job-posts.ts"),
  "utf8",
);
check(
  "restore never returns a post to OPEN",
  !/function statusAfterRestore[\s\S]*?return[^;]*"OPEN"/.test(LIFECYCLE),
);

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
