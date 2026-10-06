import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Node stays the default so the 317 existing tests are untouched.
    // `tests/ui.test.tsx` opts into jsdom with a `@vitest-environment` docblock.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    reporters: ['default'],
  },
})