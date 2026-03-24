import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      // setupFiles: './src/setupTests.ts',
      css: true,
      // TODO - tests coverage not running properly
      // coverage: {
      // 	provider: 'istanbul', // or 'v8',
      // 	include: ['src/**/*.ts', 'src/**/*.tsx'], // Only cover files in src/
      // 	exclude: ['**/tests/**', '**/mocks/**', 'src/styles/*'], // Exclude test/mocks files and styles folder
      // 	reporter: ['text', 'json', 'html'],
      // 	reportsDirectory: './coverage',
      // },
    },
  }),
)
