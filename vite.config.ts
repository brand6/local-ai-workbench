import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const setupFile = fileURLToPath(new URL("./src/client/test/setup.ts", import.meta.url));

export default defineConfig(({ command }) => {
  if (command === "build") {
    // Outer dev shells can leak NODE_ENV into Vite build and select React dev output.
    process.env.NODE_ENV = "production";
  }

  return {
    plugins: [react()],
    build: {
      outDir: "dist/client",
      emptyOutDir: true
    },
    server: {
      host: "127.0.0.1",
      port: 3987
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: [setupFile],
      testTimeout: 10000,
      include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]
    }
  };
});
