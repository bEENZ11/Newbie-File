import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Some tests play whole games on the full-size map, which takes a while.
    testTimeout: 120000,
  },
});
