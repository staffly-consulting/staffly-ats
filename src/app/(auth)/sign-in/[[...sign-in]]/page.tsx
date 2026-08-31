import type { Metadata } from "next";

import { SignIn } from "@clerk/nextjs";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Optional catch-all so Clerk can own its own sub-routes (factor-one,
 * factor-two, SSO callback) under /sign-in without extra route files.
 */
export default function SignInPage() {
  return <SignIn />;
}
