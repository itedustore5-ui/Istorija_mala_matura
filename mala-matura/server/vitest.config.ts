import { defineConfig } from "vitest/config";

// Подизање PGlite базе у меморији и упис 120 задатака са сликама траје
// неколико секунди, дуже од подразумеваних 10 s за `beforeAll`.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
