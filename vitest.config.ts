import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests only. Playwright specs live under runs/ and tests/ and use
    // @playwright/test's runner — they must not be collected by vitest.
    include: ["src/**/*.test.ts", "remotion/**/*.test.ts"],
    exclude: ["node_modules/**", "runs/**", "tests/**"],
  },
});
