import { envFlag, envValue, isProduction } from "./env.server";

export function getServerConfig() {
  return {
    nodeEnv: isProduction() ? "production" : "development",
    siteUrl: envValue("SITE_URL"),
    legalContactEmail: envValue("LEGAL_CONTACT_EMAIL") ?? "legal@example.com",
    productAnalyticsEnabled: envFlag("ENABLE_PRODUCT_ANALYTICS"),
    externalStreamResolverEnabled:
      !isProduction() ||
      (envFlag("ENABLE_EXTERNAL_STREAM_RESOLVER") && envFlag("STREAMING_RIGHTS_CONFIRMED")),
  };
}
