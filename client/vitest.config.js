import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Separate from vite.config.js: component tests don't need the PWA plugin
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify('test')
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true
  }
})
