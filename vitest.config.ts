import "dotenv/config";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "", UPLOAD_DIR: "./storage/test-uploads" },
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 180000,
  },
});
