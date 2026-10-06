import { describe, expect, it } from "vitest"

import { localizeManifest } from "./document"

const template = {
	name: "Orbitalia - Our Solar System",
	short_name: "Orbitalia",
	icons: [{ src: "icons/icon-512x512.png", sizes: "512x512" }],
	theme_color: "#1A1B1E",
	start_url: ".",
	display: "standalone",
}

describe("localizeManifest", () => {
	const manifest = localizeManifest(template, {
		lang: "de",
		name: "Orbitalia – Unser Sonnensystem",
		shortName: "Orbitalia",
		description: "Visuelles Lexikon",
		manifestUrl: "https://example.org/solr/manifest.json",
	})

	it("carries the localized texts and the language", () => {
		expect(manifest).toMatchObject({
			lang: "de",
			name: "Orbitalia – Unser Sonnensystem",
			short_name: "Orbitalia",
			description: "Visuelles Lexikon",
			theme_color: "#1A1B1E",
			display: "standalone",
		})
	})

	it("makes every URL absolute against the template, since a data: URL has no base", () => {
		expect(manifest.icons).toEqual([
			{
				src: "https://example.org/solr/icons/icon-512x512.png",
				sizes: "512x512",
			},
		])
		expect(manifest.scope).toBe("https://example.org/solr/")
	})

	it("starts the installed app in its language but keeps one identity", () => {
		expect(manifest.start_url).toBe("https://example.org/solr/?lang=de")
		expect(manifest.id).toBe("https://example.org/solr/")
	})
})
