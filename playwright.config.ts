import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.E2E_PORT) || 4173
const baseURL = `http://localhost:${port}`

export default defineConfig({
	testDir: "e2e",
	fullyParallel: true,
	// Every test drives a software-WebGL scene (swiftshader), which is CPU-hungry:
	// more browsers than this at once only slow each other down past their timeouts,
	// and agents and developers often share the machine. `--workers` overrides it.
	workers: process.env.CI ? undefined : 4,
	// Every test first loads a software-rendered scene, which alone can take 20-30 s
	// on a busy machine (measured with the suite pinned to 3 cores); test.slow()
	// triples this for the inherently heavy ones (pixel counts, long waits).
	timeout: 60_000,
	// software rendering on a busy machine can hold a frame for a second or more
	expect: { timeout: 10_000 },
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL,
		// every test is a returning visitor: the opening (#30) plays only on a first
		// visit, so it never runs over another test's scene; e2e/intro.spec.ts
		// clears this to be a first-time visitor
		storageState: {
			cookies: [],
			origins: [
				{
					origin: baseURL,
					localStorage: [{ name: "orbitalia.introSeen", value: "1" }],
				},
			],
		},
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				launchOptions: {
					// software WebGL so the three.js canvases render on headless CI machines
					args: [
						"--use-gl=angle",
						"--use-angle=swiftshader",
						"--enable-unsafe-swiftshader",
					],
				},
			},
		},
	],
	webServer: {
		// Serves dist/: run `pnpm build` first. Vite is started directly, not through
		// `pnpm preview`: pnpm runs scripts in their own process group, so Playwright's
		// process-group kill misses the server and the run hangs forever at teardown.
		command: `node node_modules/vite/bin/vite.js preview --port ${port} --strictPort`,
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
	},
})
