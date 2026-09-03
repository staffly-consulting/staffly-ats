import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";

import { SignUp } from "@clerk/nextjs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("signUp") };
}

export default function SignUpPage() {
  return <SignUp />;
}
