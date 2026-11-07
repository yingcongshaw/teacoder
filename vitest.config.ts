import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["src/stores/__tests__/setup.ts"],
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
