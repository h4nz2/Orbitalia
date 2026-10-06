import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { tanstackRouter } from "@tanstack/router-plugin/vite"

export default defineConfig({
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
		include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
	},
})
