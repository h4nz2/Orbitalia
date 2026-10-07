import { describe, expect, it } from "vitest"
import type { z } from "zod"

import { bodyById } from "@/data"
import { spacecraftById } from "@/data/spacecraft"
import { eventOfTourId } from "@/data/skyEvents"
import { tourById } from "@/data/tours"
import { DEFAULT_LOCALE, LOCALES, READING_LEVELS, createI18n } from "@/i18n"
import { isScalePresetId } from "@/sim"
import { parseOffset, parseShot } from "@/store/navigation"
import { simSearchSchema } from "@/store/simSearch"

import { compareSearchSchema } from "../compare/search"
import { parseBodies } from "../compare/selection"
import { resolveHunt } from "../solarSystem/hunt/hunts"
import { dictionarySearchSchema } from "../solarDictionary/search"
import { solarWalkSearchSchema } from "../solarWalk/search"
import {
	HELP_CONTROLS,
	HELP_CREDITS,
	HELP_ENTRIES,
	HELP_GROUP_IDS,
	HelpFile,
	HelpTextFile,
	IMAGE_CREDITS,
	IMAGE_LICENCE_IDS,
	STANDARD_ONLY_GROUPS,
	controlText,
	creditRows,
	entryText,
	foldText,
	groupText,
	helpFile,
	helpText,
	searchEntries,
} from "./content"
import { parseTryLink, type TryRoute } from "./links"
import { helpSearchSchema } from "./search"

const english = helpText.get(DEFAULT_LOCALE)!

describe("the help page's structure (src/data/help.json)", () => {
	it("matches the schema", () => {
		const result = HelpFile.safeParse(helpFile)
		expect(result.success ? [] : result.error.issues).toEqual([])
	})

	it("lists every group once, and every group has entries", () => {
		expect([...helpFile.groups].sort()).toEqual([...HELP_GROUP_IDS].sort())
		for (const group of helpFile.groups) {
			expect(
				HELP_ENTRIES.some((entry) => entry.group === group),
				group,
			).toBe(true)
		}
	})

	it("has unique ids", () => {
		for (const ids of [
			HELP_ENTRIES.map((entry) => entry.id),
			HELP_CONTROLS,
			HELP_CREDITS.map((credit) => credit.id),
		]) {
			expect(new Set(ids).size).toBe(ids.length)
		}
	})
})

describe("the help page's words (src/locales/<locale>/help.json)", () => {
	it("exists for every shipped locale and matches the schema", () => {
		expect([...helpText.keys()].sort()).toEqual([...LOCALES].sort())
		for (const [locale, file] of helpText) {
			const result = HelpTextFile.safeParse(file)
			expect(result.success ? [] : result.error.issues, locale).toEqual([])
		}
	})

	it("has English words for everything the structure lists, and nothing else", () => {
		expect(Object.keys(english.entries).sort()).toEqual(
			HELP_ENTRIES.map((entry) => entry.id).sort(),
		)
		expect(Object.keys(english.groups).sort()).toEqual(
			[...HELP_GROUP_IDS].sort(),
		)
		expect(Object.keys(english.controls).sort()).toEqual(
			[...HELP_CONTROLS].sort(),
		)
		expect(Object.keys(english.credits).sort()).toEqual(
			HELP_CREDITS.map((credit) => credit.id).sort(),
		)
		expect(Object.keys(english.creditNames).sort()).toEqual(
			HELP_CREDITS.filter((credit) => credit.name === undefined)
				.map((credit) => credit.id)
				.sort(),
		)
		expect(Object.keys(english.licences).sort()).toEqual(
			[
				...new Set([
					...HELP_CREDITS.map((credit) => credit.licence),
					...Object.values(IMAGE_LICENCE_IDS),
				]),
			].sort(),
		)
		// the image sources of src/data/credits.json are listed under "maps"
		expect(Object.keys(english.creditSections).sort()).toEqual(
			[
				...new Set([...HELP_CREDITS.map((credit) => credit.section), "maps"]),
			].sort(),
		)
	})

	// the shape of a value: which levels it has, and for lists that it is a list
	const shape = (value: unknown): unknown => {
		if (typeof value === "string") return "text"
		if (Array.isArray(value)) return "list"
		if (value !== null && typeof value === "object") {
			return Object.fromEntries(
				Object.entries(value)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([key, inner]) => [key, shape(inner)]),
			)
		}
		return typeof value
	}

	it("mirrors English in every locale: the same keys and reading levels", () => {
		for (const [locale, file] of helpText) {
			expect(shape(file), locale).toEqual(shape(english))
		}
	})

	it("writes every entry for a nine-year-old too (the simple level), except the teachers' section", () => {
		for (const [locale, file] of helpText) {
			for (const entry of HELP_ENTRIES) {
				if (STANDARD_ONLY_GROUPS.includes(entry.group)) continue
				const text = file.entries[entry.id]
				for (const field of ["what", "why", "how"] as const) {
					const value = text[field] as unknown
					expect(
						typeof value === "object" &&
							value !== null &&
							!Array.isArray(value) &&
							"simple" in value &&
							"standard" in value,
						`${locale} ${entry.id}.${field}`,
					).toBe(true)
				}
			}
		}
	})

	it("reads every entry, group and control in every locale and reading level", () => {
		for (const locale of LOCALES) {
			for (const readingLevel of READING_LEVELS) {
				const i18n = createI18n({ locale, readingLevel })
				for (const entry of HELP_ENTRIES) {
					const text = entryText(entry.id, i18n)
					const where = `${locale}/${readingLevel} ${entry.id}`
					expect(text.title, where).not.toBe(entry.id)
					expect(text.what, where).not.toBe("")
					expect(text.why, where).not.toBe("")
					expect(text.how.length, where).toBeGreaterThan(0)
				}
				for (const group of HELP_GROUP_IDS) {
					expect(groupText(group, i18n).intro, group).not.toBe("")
				}
				for (const control of HELP_CONTROLS) {
					const text = controlText(control, i18n)
					expect(text.action, control).not.toBe(control)
					// every row names at least one way to do it
					expect(
						[text.mouse, text.touch, text.keys].some(Boolean),
						control,
					).toBe(true)
				}
			}
		}
	})

	it("reads the simple level where one is written, and the standard one otherwise", () => {
		const simple = createI18n({ locale: "en", readingLevel: "simple" })
		const standard = createI18n({ locale: "en", readingLevel: "standard" })
		const advanced = createI18n({ locale: "en", readingLevel: "advanced" })
		expect(entryText("scale", simple).what).not.toBe(
			entryText("scale", standard).what,
		)
		expect(entryText("scale", advanced)).toEqual(entryText("scale", standard))
		// the teachers' section is standard at every level
		expect(entryText("present", simple)).toEqual(entryText("present", standard))
	})
})

/** The schema of each page a "try it" link may open. */
const SCHEMAS: Record<TryRoute, z.ZodType> = {
	"/solar_system": simSearchSchema,
	"/solar_dictionary": dictionarySearchSchema,
	"/solar_walk": solarWalkSearchSchema,
	"/compare": compareSearchSchema,
	"/help": helpSearchSchema,
}

/** Why a link would open something other than what it says; empty when it is sound. */
function linkProblems(path: string): string[] {
	const link = parseTryLink(path)
	if (link === null) return ["not a page of the app"]
	const problems: string[] = []
	const { search } = link
	if ("lang" in search || "reading" in search) {
		problems.push("carries lang or reading (the viewer's own are kept)")
	}
	// every param survives the page's own validation unchanged: nothing is dropped as invalid
	const parsed = SCHEMAS[link.to].parse(search) as Record<string, unknown>
	for (const [key, value] of Object.entries(search)) {
		if (parsed[key] !== value)
			problems.push(`${key}=${String(value)} is invalid`)
	}
	// and every param means something real
	const body = (key: string) => {
		const id = search[key]
		if (id !== undefined && !bodyById.has(String(id))) {
			problems.push(`${key}: no body "${String(id)}"`)
		}
	}
	if (link.to === "/solar_system") {
		body("focus")
		body("sel")
		body("frame")
		if (search.scale !== undefined && !isScalePresetId(search.scale)) {
			problems.push(`scale: no preset "${String(search.scale)}"`)
		}
		if (search.cam !== undefined && parseShot(String(search.cam)) === null) {
			problems.push("cam does not parse")
		}
		if (search.at !== undefined) {
			const anchor = bodyById.get(String(search.focus))
			if (
				anchor === undefined ||
				parseOffset(String(search.at), anchor.radiusKm) === null
			) {
				problems.push("at does not parse, or has no focus")
			}
		}
		if (
			search.tour !== undefined &&
			!tourById.has(String(search.tour)) &&
			eventOfTourId(String(search.tour)) === null
		) {
			problems.push(`tour: no tour "${String(search.tour)}"`)
		}
		if (
			search.craft !== undefined &&
			!spacecraftById.has(String(search.craft))
		) {
			problems.push(`craft: no spacecraft "${String(search.craft)}"`)
		}
		if (
			typeof search.hunt === "string" &&
			resolveHunt(search.hunt)?.key !== search.hunt
		) {
			problems.push(`hunt "${search.hunt}" does not resolve`)
		}
	}
	if (link.to === "/compare" && search.bodies !== undefined) {
		const listed = String(search.bodies).split(",")
		if (parseBodies(String(search.bodies)).length !== listed.length) {
			problems.push("bodies lists an unknown or repeated body")
		}
	}
	return problems
}

describe("credits", () => {
	it("names every image licence of src/data/credits.json in every language", () => {
		const unnamed = IMAGE_CREDITS.filter(
			(credit) => IMAGE_LICENCE_IDS[credit.licence] === undefined,
		).map((credit) => `${credit.id}: ${credit.licence}`)
		expect(unnamed).toEqual([])
	})

	it("lists every image source under the surface maps, with its licence", () => {
		const rows = creditRows("maps", createI18n({ locale: "de" }))
		expect(rows.length).toBe(
			HELP_CREDITS.filter((credit) => credit.section === "maps").length +
				IMAGE_CREDITS.length,
		)
		expect(rows.find((row) => row.id === "image-svs-moon")?.licence).toBe(
			"gemeinfrei",
		)
		// the Sun's and the planets' maps too: nothing is of unknown origin any more
		expect(
			rows.find((row) => row.id === "image-nasa-blue-marble")?.licence,
		).toBe("gemeinfrei")
		expect(rows.find((row) => row.id === "image-sdo-aia304")).toBeDefined()
		expect(rows.every((row) => row.licence !== "Quelle unbekannt")).toBe(true)
	})
})

describe("try it links", () => {
	it("every entry's link opens a real page with only valid, meaningful params", () => {
		const problems = Object.fromEntries(
			HELP_ENTRIES.map((entry) => [entry.id, linkProblems(entry.try)]).filter(
				([, list]) => list.length > 0,
			),
		)
		expect(problems).toEqual({})
	})

	it("catches a link that has rotted", () => {
		expect(linkProblems("/solar_system?focus=vulcan")).toEqual([
			'focus: no body "vulcan"',
		])
		expect(linkProblems("/solar_system?scale=huge")).toEqual([
			'scale: no preset "huge"',
		])
		expect(linkProblems("/solar_system?warp=0")).toEqual(["warp=0 is invalid"])
		expect(linkProblems("/solar_system?light=laser")).toEqual([
			"light=laser is invalid",
		])
		expect(linkProblems("/solar_system?hunt=noSuchClue")).toEqual([
			'hunt "noSuchClue" does not resolve',
		])
		expect(linkProblems("/compare?bodies=earth,vulcan")).toEqual([
			"bodies lists an unknown or repeated body",
		])
		expect(linkProblems("/planetarium")).toEqual(["not a page of the app"])
		expect(linkProblems("/solar_dictionary?entity=12")).toEqual([
			"entity=12 is invalid",
		])
		expect(linkProblems("/solar_system?lang=de")).toContain(
			"carries lang or reading (the viewer's own are kept)",
		)
	})

	it("parses links the way the router parses an address", () => {
		expect(
			parseTryLink("/solar_system?focus=earth&t=2451545&paused=true"),
		).toEqual({
			to: "/solar_system",
			search: { focus: "earth", t: 2451545, paused: true },
		})
		expect(parseTryLink("/solar_walk")).toEqual({
			to: "/solar_walk",
			search: {},
		})
	})
})

describe("search", () => {
	const en = createI18n({ locale: "en" })

	it("folds case and accents", () => {
		expect(foldText("Éclipse ZEMĚ")).toBe("eclipse zeme")
	})

	it("finds entries by any words in their text, in page order", () => {
		expect(searchEntries("", en).length).toBe(HELP_ENTRIES.length)
		expect(searchEntries("eclipse", en).map((entry) => entry.id)).toContain(
			"eclipses",
		)
		expect(searchEntries("QR code", en).map((entry) => entry.id)).toContain(
			"share",
		)
		expect(searchEntries("zzzz", en)).toEqual([])
	})

	it("searches in the reader's language", () => {
		const cs = createI18n({ locale: "cs" })
		expect(searchEntries("zatmeni", cs).map((entry) => entry.id)).toContain(
			"eclipses",
		)
	})
})
