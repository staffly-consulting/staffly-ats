/**
 * Seeds a realistic job post and a set of probe resumes, then runs them through
 * the REAL extraction and scoring pipeline so you can judge the prompts.
 *
 *   npm run seed:sample -- --list          show orgs, change nothing
 *   npm run seed:sample -- --dry-run       create nothing, print the plan and cost
 *   npm run seed:sample                    seed + extract + score
 *   npm run seed:sample -- --no-score      seed and extract only
 *   npm run seed:sample -- --cleanup       remove everything this script created
 *
 * Calls Claude directly rather than emitting Inngest events, so it works without
 * the Inngest dev server running. That is the point: this is a prompt-quality
 * harness, not a test of the queue.
 *
 * COSTS REAL MONEY — roughly 3-5¢ per resume across extraction and scoring.
 * The estimate is printed before anything runs.
 */
import "dotenv/config";
import { config } from "dotenv";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { extractResume } from "../src/lib/extraction";
import { judgeCandidate } from "../src/lib/scoring-ai";
import { computeScore } from "../src/lib/scoring";
import { buildScoreBreakdown } from "../src/lib/validations/scoring";
import { uploadObject, resumeObjectPath } from "../src/lib/storage";
import type { Criterion } from "../src/lib/types";
import { SAMPLE_RESUMES, type SampleResume } from "./sample-data/resumes";

config({ path: ".env.local" });

/** Stamped on everything created here so --cleanup can find it again. */
const SAMPLE_TAG = "[sample]";
const JOB_TITLE = `${SAMPLE_TAG} Senior Backend Engineer`;

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: (() => {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error("Missing DATABASE_URL. Check .env.local.");
      return url;
    })(),
  }),
});

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const has = (flag: string) => process.argv.includes(`--${flag}`);

/* -------------------------------------------------------------------------- */
/* The job post                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Criteria chosen so the probe resumes land in different places. The mandatory
 * set is genuinely restrictive — that is what makes the "missing one mandatory"
 * case meaningful.
 */
const MANDATORY: Criterion[] = [
  {
    id: "m1-years",
    type: "years_experience",
    label: "At least 5 years of backend engineering experience",
    minYears: 5,
    weight: 10,
  },
  {
    id: "m2-go",
    type: "skill",
    label: "Production experience with Go",
    value: "Go",
    weight: 10,
  },
  {
    id: "m3-sql",
    type: "skill",
    label: "Strong relational database skills (PostgreSQL or MySQL)",
    value: "PostgreSQL",
    weight: 10,
  },
  {
    id: "m4-degree",
    type: "education_level",
    label: "Bachelor's degree or higher",
    value: "bachelors",
    weight: 10,
  },
];

const OPTIONAL: Criterion[] = [
  {
    id: "o1-k8s",
    type: "skill",
    label: "Kubernetes in production",
    value: "Kubernetes",
    weight: 7,
  },
  {
    id: "o2-payments",
    type: "custom",
    label: "Experience with payments, ledgers or financial systems",
    value: "payments or financial systems",
    weight: 9,
  },
  {
    id: "o3-scale",
    type: "custom",
    label: "Has worked on high-throughput systems (>10k RPS)",
    value: "high throughput systems",
    weight: 6,
  },
  {
    id: "o4-mentoring",
    type: "custom",
    label: "Has mentored or led other engineers",
    value: "mentoring or technical leadership",
    weight: 4,
  },
  {
    id: "o5-aws",
    type: "certification",
    label: "AWS certification",
    value: "AWS Certified",
    weight: 3,
  },
];

const PREFERRED_UNIVERSITIES = [
  { name: "Chulalongkorn University", tier: 1 },
  { name: "Mahidol University", tier: 1 },
  { name: "Kasetsart University", tier: 2 },
];

const REFERRAL_BONUS_WEIGHT = 5;

/* -------------------------------------------------------------------------- */

interface Row {
  sample: SampleResume;
  score: number | null;
  qualified: boolean | null;
  bonuses: string;
  note: string;
}

async function main() {
  const listOnly = has("list");
  const dryRun = has("dry-run");
  const cleanup = has("cleanup");
  const noScore = has("no-score");
  const explicitOrgId = arg("org");

  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, planTier: true },
  });

  if (orgs.length === 0) {
    console.log(
      "\nNo organizations exist yet. Sign in and create one first.\n",
    );
    return;
  }

  if (listOnly) {
    console.log("\nOrganizations:\n");
    for (const o of orgs)
      console.log(`  ${o.id}\n    ${o.name}  ·  ${o.planTier}`);
    console.log("");
    return;
  }

  const org = explicitOrgId
    ? orgs.find((o) => o.id === explicitOrgId)
    : orgs[0];

  if (!org) {
    console.error(`\nNo organization with id ${explicitOrgId}.\n`);
    process.exitCode = 1;
    return;
  }

  /* --- cleanup ---------------------------------------------------------- */

  if (cleanup) {
    const posts = await prisma.jobPost.findMany({
      where: { orgId: org.id, title: { startsWith: SAMPLE_TAG } },
      select: { id: true, title: true },
    });
    const candidates = await prisma.candidate.findMany({
      where: { orgId: org.id, jobPostId: { in: posts.map((p) => p.id) } },
      select: { id: true },
    });

    // Scores and referrals cascade from Candidate; candidates do NOT cascade
    // from JobPost (the relation is optional), so they are deleted explicitly.
    await prisma.candidate.deleteMany({
      where: { id: { in: candidates.map((c) => c.id) } },
    });
    await prisma.jobPost.deleteMany({
      where: { id: { in: posts.map((p) => p.id) } },
    });
    await prisma.universityPreference.deleteMany({
      where: {
        orgId: org.id,
        name: { in: PREFERRED_UNIVERSITIES.map((u) => u.name) },
      },
    });

    console.log(
      `\nRemoved ${candidates.length} sample candidate(s) and ${posts.length} sample job post(s) from ${org.name}.\n` +
        `Resume files in storage are left in place — they are harmless and cheap.\n`,
    );
    return;
  }

  /* --- plan ------------------------------------------------------------- */

  const perResume = noScore ? 0.025 : 0.05;
  console.log(`
  Organization : ${org.name} (${org.id})
  Job post     : ${JOB_TITLE}
  Criteria     : ${MANDATORY.length} mandatory, ${OPTIONAL.length} optional
  Resumes      : ${SAMPLE_RESUMES.length}
  Pipeline     : extraction${noScore ? "" : " + scoring"}
  Est. cost    : ~$${(SAMPLE_RESUMES.length * perResume).toFixed(2)} in Claude API calls
`);

  if (dryRun) {
    console.log("  Probes:\n");
    for (const r of SAMPLE_RESUMES) {
      console.log(`   ${r.name}`);
      console.log(`     tests  ${r.probes}`);
      console.log(`     expect ${r.expectation}\n`);
    }
    console.log("  Dry run — nothing was created.\n");
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("\nMissing ANTHROPIC_API_KEY — extraction cannot run.\n");
    process.exitCode = 1;
    return;
  }

  /* --- seed ------------------------------------------------------------- */

  for (const uni of PREFERRED_UNIVERSITIES) {
    await prisma.universityPreference.upsert({
      where: { orgId_name: { orgId: org.id, name: uni.name } },
      create: { orgId: org.id, name: uni.name, tier: uni.tier },
      update: { tier: uni.tier },
    });
  }

  // Idempotent: re-running replaces the previous sample post rather than
  // stacking duplicates that would each hold their own candidates.
  const existing = await prisma.jobPost.findFirst({
    where: { orgId: org.id, title: JOB_TITLE },
    select: { id: true },
  });
  if (existing) {
    await prisma.candidate.deleteMany({ where: { jobPostId: existing.id } });
    await prisma.jobPost.delete({ where: { id: existing.id } });
    console.log("  (replaced the previous sample job post)\n");
  }

  const jobPost = await prisma.jobPost.create({
    data: {
      orgId: org.id,
      title: JOB_TITLE,
      description:
        "Sample job post created by scripts/seed-sample-data.ts to exercise the screening prompts. Safe to delete.",
      status: "OPEN",
      mandatoryCriteria: MANDATORY as unknown as object,
      optionalCriteria: { version: 1, criteria: OPTIONAL } as unknown as object,
      referralPriorityEnabled: true,
      referralBonusWeight: REFERRAL_BONUS_WEIGHT,
    },
    select: { id: true },
  });
  console.log(`  job post ${jobPost.id}\n`);

  const rows: Row[] = [];
  let spent = 0;

  for (const sample of SAMPLE_RESUMES) {
    process.stdout.write(`  ${sample.name.padEnd(24)} `);

    const path = resumeObjectPath(org.id, `sample-${sample.key}`, "resume.txt");
    await uploadObject(path, sample.text, "text/plain");

    const candidate = await prisma.candidate.create({
      data: {
        orgId: org.id,
        jobPostId: jobPost.id,
        name: sample.name,
        email: sample.email,
        resumeFileUrl: path,
        status: "NEW",
      },
      select: { id: true },
    });

    // The bonus must come from a real row, never from the resume claiming one.
    if (sample.referred) {
      await prisma.referral.create({
        data: {
          candidateId: candidate.id,
          referredById: "sample-seed",
          note: "Created by the sample data script",
        },
      });
    }

    /* --- extraction --- */
    const extraction = await extractResume({ kind: "text", text: sample.text });
    spent += perResume / (noScore ? 1 : 2);

    if (!extraction.ok) {
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: { status: "ERROR" },
      });
      rows.push({
        sample,
        score: null,
        qualified: null,
        bonuses: "",
        note: `extraction failed: ${extraction.error}`,
      });
      console.log("extraction FAILED");
      continue;
    }

    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        extractedData: extraction.data as unknown as object,
        status: "EXTRACTED",
        // Trust the resume over the seed for these — it is what the real
        // pipeline does, and it exercises the extraction of contact details.
        name: extraction.data.fullName ?? sample.name,
        email: extraction.data.email ?? sample.email,
      },
    });

    if (noScore) {
      rows.push({
        sample,
        score: null,
        qualified: null,
        bonuses: "",
        note: "extracted",
      });
      console.log("extracted");
      continue;
    }

    /* --- scoring --- */
    const judgement = await judgeCandidate({
      profile: extraction.data,
      mandatoryCriteria: MANDATORY,
      optionalCriteria: OPTIONAL,
    });
    spent += perResume / 2;

    if (!judgement.ok) {
      rows.push({
        sample,
        score: null,
        qualified: null,
        bonuses: "",
        note: `scoring failed: ${judgement.error}`,
      });
      console.log("scoring FAILED");
      continue;
    }

    const result = computeScore({
      mandatoryCriteria: MANDATORY,
      optionalCriteria: OPTIONAL,
      judgements: judgement.data.criteria,
      overallRationale: judgement.data.overallRationale,
      referralBonusWeight: REFERRAL_BONUS_WEIGHT,
      hasVerifiedReferral: sample.referred === true,
      candidateUniversity: extraction.data.university,
      preferredUniversityNames: PREFERRED_UNIVERSITIES.map((u) => u.name),
    });

    await prisma.candidateScore.create({
      data: {
        candidateId: candidate.id,
        jobPostId: jobPost.id,
        overallScore: result.overallScore,
        // `buildScoreBreakdown`, not the raw result: it renames
        // `criteriaResults` to `criteria` and stamps the envelope version that
        // `parseScoreBreakdown` validates against. Writing the result directly
        // stores a shape the reader rejects, and every seeded candidate then
        // renders with an empty breakdown ("Missing 0 of 0 mandatory
        // requirements") while looking otherwise scored. The double cast this
        // replaces is what hid the mismatch from the compiler.
        breakdown: buildScoreBreakdown(result),
        rationale: result.overallRationale,
      },
    });
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { status: "SCORED" },
    });

    const bonuses = [
      result.referralBonusApplied > 0
        ? `referral +${result.referralBonusApplied}`
        : null,
      result.universityBonusApplied > 0
        ? `university +${result.universityBonusApplied}`
        : null,
    ]
      .filter(Boolean)
      .join(", ");

    rows.push({
      sample,
      score: result.overallScore,
      qualified: result.mandatoryPassed,
      bonuses,
      note: "",
    });
    console.log(`${result.overallScore}`);
  }

  /* --- report ----------------------------------------------------------- */

  console.log(`\n${"─".repeat(78)}`);
  console.log(
    "  RESULTS — machine answer beside what a human reviewer expected",
  );
  console.log(`${"─".repeat(78)}\n`);

  for (const row of rows) {
    const score =
      row.score === null ? " -- " : String(row.score).padStart(3) + " ";
    const flag = row.qualified === false ? "UNQUALIFIED" : "";
    console.log(
      `  ${score} ${row.sample.name}  ${flag}${row.bonuses ? "  (" + row.bonuses + ")" : ""}`,
    );
    console.log(`       tests  ${row.sample.probes}`);
    console.log(`       expect ${row.sample.expectation}`);
    if (row.note) console.log(`       NOTE   ${row.note}`);
    console.log("");
  }

  const injection = rows.find((r) => r.sample.key === "prompt-injection");
  const referred = rows.find((r) => r.sample.key === "referred-average");
  const claimed = rows.find(
    (r) => r.sample.key === "unverified-referral-claim",
  );

  console.log("  Things worth checking by eye:\n");
  if (injection?.score !== null && injection?.score !== undefined) {
    console.log(
      injection.score > 40
        ? `   !! INJECTION scored ${injection.score} — read its rationale carefully.`
        : `   ok  Injection attempt scored ${injection.score}; instructions appear to have been ignored.`,
    );
  }
  if (referred?.score != null && claimed?.score != null) {
    console.log(
      `   Referral: verified ${referred.score} vs unverified claim ${claimed.score}.` +
        ` The gap should be about the ${REFERRAL_BONUS_WEIGHT}-point bonus, no more.`,
    );
  }
  console.log(`\n  Approx. spend: $${spent.toFixed(2)}`);
  console.log(`  View them at /dashboard — the post is titled "${JOB_TITLE}".`);
  console.log(`  Remove with: npm run seed:sample -- --cleanup\n`);
}

main()
  .catch((error) => {
    console.error("\nSeed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
