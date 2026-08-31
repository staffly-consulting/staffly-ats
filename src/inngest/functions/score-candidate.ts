import { inngest, type StafflyEvents } from "@/inngest/client";
import { readMandatoryCriteria, readOptionalCriteria } from "@/lib/criteria";
import { prisma } from "@/lib/prisma";
import { computeScore } from "@/lib/scoring";
import { judgeCandidate } from "@/lib/scoring-ai";
import { parseExtractedData } from "@/lib/validations/resume";
import { buildScoreBreakdown } from "@/lib/validations/scoring";

/**
 * `candidate/ready-for-scoring` → a `CandidateScore` row.
 *
 * Fired from two places, because a candidate becomes scoreable when *either*
 * half lands last:
 *   - extraction finishes and the candidate is already assigned to a job post
 *   - a recruiter assigns an already-extracted candidate to a job post
 *
 * Both point here. Re-firing is safe: an existing score is overwritten only
 * when `force` is set (the Re-score button), and otherwise the run exits early.
 */

type ReadyForScoring = StafflyEvents["candidate/ready-for-scoring"];

export const scoreCandidateFunction = inngest.createFunction(
  {
    id: "score-candidate",
    name: "Score candidate against job criteria",
    retries: 3,
    concurrency: { key: "event.data.orgId", limit: 3 },
    triggers: [{ event: "candidate/ready-for-scoring" }],
  },
  async ({ event, step, logger }) => {
    const { orgId, candidateId, force } = event.data as ReadyForScoring;

    // -------------------------------------------------------------------
    // 1. Gather everything, org-scoped, and decide whether to proceed.
    // -------------------------------------------------------------------
    const context = await step.run("load-context", async () => {
      const candidate = await prisma.candidate.findFirst({
        where: { id: candidateId, orgId },
        select: {
          id: true,
          jobPostId: true,
          extractedData: true,
          referral: { select: { id: true } },
          jobPost: {
            select: {
              id: true,
              orgId: true,
              mandatoryCriteria: true,
              optionalCriteria: true,
              referralPriorityEnabled: true,
              referralBonusWeight: true,
            },
          },
          scores: { select: { id: true, jobPostId: true } },
        },
      });

      if (!candidate) return { skip: "candidate-not-found" as const };
      if (!candidate.jobPostId || !candidate.jobPost) {
        return { skip: "not-assigned-to-a-job-post" as const };
      }

      // Extraction has not produced anything to judge. Leave the status alone —
      // the candidate is not broken, just not ready.
      const profile = parseExtractedData(candidate.extractedData);
      if (!profile) return { skip: "no-extracted-data" as const };

      // The unique constraint on [candidateId, jobPostId] means a second run
      // would collide. Treat that as "already scored" rather than an error.
      const alreadyScored = candidate.scores.some(
        (score) => score.jobPostId === candidate.jobPostId,
      );
      if (alreadyScored && !force) {
        return { skip: "already-scored" as const };
      }

      const optional = readOptionalCriteria(candidate.jobPost.optionalCriteria);

      // Resolve preferred universities to names for the bonus check. Scoped by
      // org: the ids live in the job post's JSON and are otherwise unvalidated.
      const preferredUniversities =
        optional.preferredUniversityIds.length > 0
          ? await prisma.universityPreference.findMany({
              where: { orgId, id: { in: optional.preferredUniversityIds } },
              select: { name: true },
            })
          : [];

      return {
        jobPostId: candidate.jobPost.id,
        profile,
        mandatoryCriteria: readMandatoryCriteria(
          candidate.jobPost.mandatoryCriteria,
        ),
        optionalCriteria: optional.criteria,
        // A referral only counts when a Referral row exists. The candidate's own
        // claim in `extractedData.referralMentioned` is not evidence.
        hasVerifiedReferral: candidate.referral !== null,
        referralBonusWeight: candidate.jobPost.referralPriorityEnabled
          ? candidate.jobPost.referralBonusWeight
          : 0,
        preferredUniversityNames: preferredUniversities.map((u) => u.name),
      };
    });

    if ("skip" in context) {
      logger.info(
        `[score-candidate] ${candidateId}: skipped (${context.skip})`,
      );
      return { skipped: context.skip };
    }

    if (
      context.mandatoryCriteria.length === 0 &&
      context.optionalCriteria.length === 0
    ) {
      logger.warn(
        `[score-candidate] job post ${context.jobPostId} has no criteria; nothing to score against`,
      );
      return { skipped: "job-post-has-no-criteria" };
    }

    await step.run("mark-processing", () =>
      prisma.candidate.updateMany({
        where: { id: candidateId, orgId },
        data: { status: "PROCESSING" },
      }),
    );

    // -------------------------------------------------------------------
    // 2. Per-criterion verdicts from the model. No numbers involved.
    // -------------------------------------------------------------------
    const outcome = await step.run("judge-criteria", () =>
      judgeCandidate({
        profile: context.profile,
        mandatoryCriteria: context.mandatoryCriteria,
        optionalCriteria: context.optionalCriteria,
      }),
    );

    if (outcome.usage) {
      logger.info("[score-candidate] usage", {
        candidateId,
        orgId,
        model: outcome.usage.model,
        attempts: outcome.usage.attempts,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
        criteriaCount:
          context.mandatoryCriteria.length + context.optionalCriteria.length,
        estimatedCostUsd: Number(outcome.usage.estimatedCostUsd.toFixed(5)),
      });
    }

    if (!outcome.ok) {
      await step.run("mark-error", () =>
        prisma.candidate.updateMany({
          where: { id: candidateId, orgId },
          data: { status: "ERROR" },
        }),
      );
      await step.sendEvent("notify-scoring-failed", {
        name: "candidate/processing-failed",
        data: { orgId, candidateId, stage: "scoring" },
      });
      logger.error(
        `[score-candidate] judgement failed for ${candidateId}: ${outcome.error}`,
      );
      return { status: "ERROR", reason: outcome.error };
    }

    // -------------------------------------------------------------------
    // 3. The arithmetic. Pure, in our code, from the model's verdicts.
    // -------------------------------------------------------------------
    const result = computeScore({
      mandatoryCriteria: context.mandatoryCriteria,
      optionalCriteria: context.optionalCriteria,
      judgements: outcome.data.criteria,
      overallRationale: outcome.data.overallRationale,
      referralBonusWeight: context.referralBonusWeight,
      hasVerifiedReferral: context.hasVerifiedReferral,
      candidateUniversity: context.profile.university,
      preferredUniversityNames: context.preferredUniversityNames,
    });

    // -------------------------------------------------------------------
    // 4. Persist.
    // -------------------------------------------------------------------
    await step.run("save-score", async () => {
      await prisma.candidateScore.upsert({
        where: {
          candidateId_jobPostId: {
            candidateId,
            jobPostId: context.jobPostId,
          },
        },
        create: {
          candidateId,
          jobPostId: context.jobPostId,
          overallScore: result.overallScore,
          breakdown: buildScoreBreakdown(result),
          rationale: result.overallRationale,
          flagged: result.flagged,
          flagReason: result.flagReason,
        },
        update: {
          overallScore: result.overallScore,
          breakdown: buildScoreBreakdown(result),
          rationale: result.overallRationale,
          flagged: result.flagged,
          flagReason: result.flagReason,
          scoredAt: new Date(),
        },
      });

      await prisma.candidate.updateMany({
        where: { id: candidateId, orgId },
        data: { status: "SCORED" },
      });
    });

    logger.info(
      `[score-candidate] ${candidateId} scored ${result.overallScore}/100 (mandatory ${result.mandatoryPassed ? "passed" : "failed"}${result.flagged ? ", flagged" : ""})`,
    );

    return {
      status: "SCORED",
      overallScore: result.overallScore,
      mandatoryPassed: result.mandatoryPassed,
      flagged: result.flagged,
      estimatedCostUsd: outcome.usage?.estimatedCostUsd ?? null,
    };
  },
);
