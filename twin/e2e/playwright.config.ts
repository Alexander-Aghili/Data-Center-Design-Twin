import { defineConfig, devices } from '@playwright/test'

// Each spec starts its own server and Vite dev server on free ports with a throwaway data directory
// (see harness.ts), so runs never touch twin/.data or collide with `npm run dev`.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: '../test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 2,
  use: {
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // WebGL for the 3D hall in headless Chromium.
        launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] },
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
})
