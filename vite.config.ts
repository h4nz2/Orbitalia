import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { tanstackRouter } from "@tanstack/router-plugin/vite"

/** "0.2.0+abc1234": the package version and the commit it was built from, for bug reports. */
function appVersion(): string {
	const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
		version: string
	}
	try {
		const commit = execSync("git rev-parse --short HEAD", {
			stdio: ["ignore", "pipe", "ignore"],
		})
		return `${version}+${commit.toString().trim()}`
	} catch {
		return version
	}
}

export default defineConfig({
	define: { __APP_VERSION__: JSON.stringify(appVersion()) },
	// VITE_BASE serves the site from a sub path; default is the site root.
	base: process.env.VITE_BASE ?? "/",
	plugins: [
		// must run before the react plugin
		tanstackRouter({
			target: "react",
			autoCodeSplitting: true,
			quoteStyle: "double",
			semicolons: false,
		}),
		react(),
	],
	resolve: {
		// honours the "@/*" alias from tsconfig.json
		tsconfigPaths: true,
	},
	test: {
		environment: "node",
		passWithNoTests: true,
		include: [
			"src/**/*.test.ts",
			"scripts/**/*.test.ts",
			"worker/**/*.test.ts",
		],
	},
})
