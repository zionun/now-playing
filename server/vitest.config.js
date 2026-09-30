import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    // Tests run in order within a file (the setup flow depends on it)
    sequence: { concurrent: false },
    env: { LOG_LEVEL: 'silent' }
  }
})
