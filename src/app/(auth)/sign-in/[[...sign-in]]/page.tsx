import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";

import { SignIn } from "@clerk/nextjs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("signIn") };
}

/**
 * Optional catch-all so Clerk can own its own sub-routes (factor-one,
 * factor-two, SSO callback) under /sign-in without extra route files.
 */
export default function SignInPage() {
  return <SignIn />;
}
