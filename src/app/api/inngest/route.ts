import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { extractResumeFunction } from "@/inngest/functions/extract-resume";
import { notifyFailuresFunction } from "@/inngest/functions/notify-failures";
import { reportOverageFunction } from "@/inngest/functions/report-overage";
import { resetUsagePoolsFunction } from "@/inngest/functions/reset-usage-pools";
import { processInboundResume } from "@/inngest/functions/process-resume";
import { scoreCandidateFunction } from "@/inngest/functions/score-candidate";

/**
 * Inngest's serve endpoint. Inngest calls back into this route to execute each
 * step of a function, so it has to be publicly reachable and is authenticated
 * by `INNGEST_SIGNING_KEY` rather than by a Clerk session — which is why
 * `/api/*` is excluded from the auth boundary.
 *
 * Locally, run `npx inngest-cli@latest dev` and point it at
 * http://localhost:3100/api/inngest.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processInboundResume,
    extractResumeFunction,
    scoreCandidateFunction,
    notifyFailuresFunction,
    reportOverageFunction,
    resetUsagePoolsFunction,
  ],
  // The signing key is read from INNGEST_SIGNING_KEY automatically; v4's
  // ServeHandlerOptions no longer accepts it explicitly.
});
