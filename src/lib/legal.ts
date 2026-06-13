import { createServerFn } from "@tanstack/react-start";

export const getPublicLegalConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { getServerConfig } = await import("./config.server");
  return { contactEmail: getServerConfig().legalContactEmail };
});
