/**
 * Texts name the control, never the screen corner (#58). Phones arrange the
 * controls differently from a laptop (#59, #60), so "the house button at the
 * top left" or "Press Layers at the bottom right" is wrong on one of them. A
 * help step, a hint or a quick-look step says "the house button", "Press
 * Layers", "the name box": one text for every arrangement. Positions relative
 * to another control ("next to Help", "on the card", "in the time bar") are
 * fine; they move with it.
 *
 * Checks every string of every resource (`src/locales/<locale>/*.json`) of
 * every locale against that locale's words for a screen corner. A real-world
 * corner (a corner of the school field) is listed in `REAL_CORNERS`.
 */
import { describe, expect, it } from "vitest"

import { LOCALES } from "./catalog"

/** A whole-word, case-insensitive pattern: no letter or digit on either side. */
const words = (...alternatives: string[]): RegExp =>
	new RegExp(
		`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`,
		"iu",
	)

/**
 * The words that place something on the screen, per locale. A new locale adds
 * its own (the test below asks for them).
 */
const CORNER_WORDS: Readonly<Record<string, RegExp>> = {
	en: words(
		"(?:top|bottom|upper|lower)[\\s-]+(?:left|right)",
		"corners?",
		"(?:top|bottom|edge|side)\\s+of\\s+the\\s+screen",
	),
	de: words(
		"(?:oben|unten)\\s+(?:rechts|links)",
		"(?:rechts|links)\\s+(?:oben|unten)",
		"(?:obere[nmrs]?|untere[nmrs]?)\\s+(?:rechte[nmrs]?|linke[nmrs]?)",
		"ecken?",
		"bildschirm(?:ecken?|rand)",
		"(?:oberen|unteren)\\s+rand",
	),
	fr: words(
		"(?:en\\s+)?(?:haut|bas)[\\s-]+(?:à\\s+)?(?:droite|gauche)",
		"coins?",
		"(?:haut|bas|bord)\\s+de\\s+l[’']écran",
	),
	es: words(
		"(?:arriba|abajo)\\s+a\\s+la\\s+(?:derecha|izquierda)",
		"(?:superior|inferior)\\s+(?:derech[oa]|izquierd[oa])",
		"esquinas?",
		"(?:parte\\s+(?:superior|inferior)|borde)\\s+de\\s+la\\s+pantalla",
	),
	cs: words(
		"(?:vpravo|vlevo)\\s+(?:nahoře|dole)",
		"(?:nahoře|dole)\\s+(?:vpravo|vlevo)",
		"(?:pravém|levém)\\s+(?:horním|dolním)",
		"(?:horním|dolním)\\s+(?:pravém|levém)",
		"roh(?:u|y|ů|em|ům|ech|ích)?",
		"okraj[iu]?\\s+obrazovky",
	),
}

/**
 * Corners that are not on the screen, by file and key path (in every locale):
 * where the walk puts the Sun, and a patch of the evening sky.
 */
const REAL_CORNERS: Readonly<Record<string, readonly string[]>> = {
	"ui.json": ["solarWalk.sunStop", "solarWalk.sunStop@advanced"],
	"events.json": ["gathering2040.look.simple"],
}

const resources: Readonly<Record<string, unknown>> = import.meta.glob(
	"../locales/*/*.json",
	{ eager: true, import: "default" },
)

/** Every string of a resource with its key path ("entries.goBack.how.simple[1]"). */
function* strings(value: unknown, path = ""): Generator<[string, string]> {
	if (typeof value === "string") {
		yield [path, value]
	} else if (Array.isArray(value)) {
		for (const [i, item] of value.entries())
			yield* strings(item, `${path}[${i}]`)
	} else if (value !== null && typeof value === "object") {
		for (const [key, item] of Object.entries(value))
			yield* strings(item, path === "" ? key : `${path}.${key}`)
	}
}

interface Finding {
	locale: string
	file: string
	path: string
	words: string
}

/** Every string that names a screen corner, real-world ones included. */
const findings: Finding[] = Object.entries(resources).flatMap(
	([module, json]) => {
		const [, locale, file] = /\/locales\/([^/]+)\/([^/]+)$/.exec(module)!
		const pattern = CORNER_WORDS[locale]
		if (pattern === undefined) return []
		return [...strings(json)].flatMap(([path, text]) => {
			const match = pattern.exec(text)
			return match ? [{ locale, file, path, words: match[0] }] : []
		})
	},
)

const isReal = ({ file, path }: Finding) =>
	(REAL_CORNERS[file] ?? []).includes(path)

describe("texts name the control, not the screen corner (#58)", () => {
	it("knows the corner words of every shipped locale", () => {
		const missing = LOCALES.filter((locale) => !(locale in CORNER_WORDS))
		expect(
			missing,
			"add the locale's words for a screen corner to CORNER_WORDS",
		).toEqual([])
	})

	it("reads every resource of every locale", () => {
		const locales = new Set(
			Object.keys(resources).map((module) => module.split("/").at(-2)),
		)
		expect([...locales].sort()).toEqual([...LOCALES].sort())
	})

	it.each(LOCALES)("%s: no text places a control in a corner", (locale) => {
		const found = findings
			.filter((finding) => finding.locale === locale && !isReal(finding))
			.map(
				({ file, path, words }) =>
					`${locale}/${file} ${path}: “${words}” (name the control instead)`,
			)
		expect(found).toEqual([])
	})

	it("lists only real-world corners that are still there", () => {
		const stale = Object.entries(REAL_CORNERS).flatMap(([file, paths]) =>
			paths
				.filter(
					(path) => !findings.some((f) => f.file === file && f.path === path),
				)
				.map((path) => `${file} ${path}`),
		)
		expect(
			stale,
			"no locale names a corner here: remove it from REAL_CORNERS",
		).toEqual([])
	})

	it.each([
		["en", "Press Layers at the bottom right", true],
		["en", "the house button, top-left", true],
		["en", "in the corner", true],
		["en", "Press Layers", false],
		["en", "the bottom of its panel", false],
		["de", "Drück unten rechts auf „Ebenen“", true],
		["de", "in der Ecke", true],
		["de", "eine Strecke entdecken, unter der Decke", false],
		["fr", "le bouton maison en haut à gauche", true],
		["fr", "dans le coin", true],
		["fr", "passe de la vue d’en haut à la vue depuis la Terre", false],
		["es", "Pulsa Capas abajo a la derecha", true],
		["es", "en la esquina", true],
		["es", "coincide con la luz de la derecha", false],
		["cs", "Stiskni vpravo dole Vrstvy", true],
		["cs", "v pravém horním rohu", true],
		["cs", "Světlo doletí k Zemi; tlačítka dole", false],
	])("%s: %j names a corner: %s", (locale, text, corner) => {
		expect(CORNER_WORDS[locale]!.test(text)).toBe(corner)
	})
})
