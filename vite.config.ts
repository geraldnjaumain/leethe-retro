import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { fileURLToPath } from "node:url";
import browserslist from "browserslist";
import { browserslistToTargets } from "lightningcss";
export default defineConfig({
  build: {
    cssMinify: "lightningcss",
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      server: { entry: "server.ts" },
    }),
    react(),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
