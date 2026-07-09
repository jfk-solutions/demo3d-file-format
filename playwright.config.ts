import { defineConfig } from "@playwright/test";

export default defineConfig({
  testMatch: "test/**/*.browser.test.ts",
  timeout: 180_000,
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 800 }
  }
});
