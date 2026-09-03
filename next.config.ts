import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Points the plugin at our request config. Language comes from the signed-in
// account rather than a URL segment, so there is no locale middleware and no
// `[locale]` route group — see src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {/* config options here */};

export default withNextIntl(nextConfig);
