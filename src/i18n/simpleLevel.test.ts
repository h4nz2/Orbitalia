/**
 * The guard of the simple reading level (#51): ages 6–11 read no number
 * above 100, no thousands, millions or billions and no scientific units
 * (`simpleRules.ts`). It checks
 *
 * 1. every text a simple-level reader sees, in every locale and resource:
 *    the `@simple` variant, else the text every level shares (a `ui.json`
 *    key without `@simple`, a plain value in bodies.json, the standard text
 *    a level falls back to);
 * 2. what the code formats at the simple level: the quantity helpers over
 *    their whole range and every feature that shows a number.
 *
 * The prose resources are being rewritten for #51, locale by locale. Until a
 * resource is clean it is listed in `PENDING`; the list can only shrink: a
 * listed resource that is already clean fails too, so whoever finishes one
 * removes it here. `ui.json` is never pending.
 */
import { describe, expect, it } from "vitest"

import { bodies, bodyById, getBody, planets, type Body } from "@/data"
import { solarDictionary } from "@/data/solarDictionary"
import { WORLDS, type World } from "@/data/worlds"
import { SKY_EVENTS } from "@/data/skyEvents"
import { SCALE_PRESETS, SCALE_PRESET_IDS, dateToJD } from "@/sim"

import { pairFacts } from "@/features/compare/compareFacts"
import { getSidebarFacts } from "@/features/solarDictionary/utils/getSidebarLabels"
import { densityOf } from "@/features/solarDictionary/utils/heft"
import { levelQuantity } from "@/features/solarDictionary/utils/quantity"
import { birthdayFacts } from "@/features/solarSystem/birthday/birthday"
import { cardText, lapsArgs } from "@/features/solarSystem/birthday/card"
import { shownOffset } from "@/features/solarSystem/events/EventCard"
import { introCaption } from "@/features/solarSystem/intro/captions"
import { formatDuration } from "@/features/solarSystem/light/lightTravel"
import {
	beltSentences,
	cometSentences,
} from "@/features/solarSystem/smallBodies/smallBodyText"
import { headlineFacts } from "@/features/solarSystem/ui/bodyFacts"
import {
	crossedLine,
	distanceLine,
	travelTimes,
} from "@/features/solarSystem/ui/flightFacts"
import { scaleSentences } from "@/features/solarSystem/ui/scaleStatement"
import { SUN_OBJECT_IDS, buildWalk } from "@/features/solarWalk/walk"
import {
	leadText,
	starText,
	stopText,
	summaryText,
	sunStopText,
} from "@/features/solarWalk/walkText"
import { belts } from "@/data"

import { getBodyText, bodyName } from "./bodies"
import {
	catalog,
	DEFAULT_READING_LEVEL,
	LOCALES,
	READING_LEVELS,
} from "./catalog"
import { createI18n, type I18n } from "./core"
import { compileMessage, splitLevel } from "./messages"
import {
	dayVsEarth,
	distanceInWords,
	durationInWords,
	everydaySize,
	formatCount,
	formatDistance,
	formatSize,
	formatSpeed,
	formatTemperature,
	formatTemperatureRange,
	formatWeight,
	massVsEarth,
	sizeVsEarth,
	weightVsEarth,
	yearVsEarth,
} from "./quantities"
import { simpleProblems } from "./simpleRules"

type Resource =
	| "ui"
	| "bodies"
	| "hunts"
	| "tours"
	| "help"
	| "events"
	| "spacecraft"
	| "worlds"

/**
 * Resources whose simple texts still break the rule, per locale: the prose
 * rewrite for #51 removes its entry when the resource is clean (the test
 * fails if a listed one already is).
 */
const PENDING: Readonly<Record<string, readonly Resource[]>> = {}

/**
 * `ui.json` keys the code never shows at the simple level (it formats or
 * words the value differently there), so their shared text may keep units.
 * The formatted-value checks below prove that the simple level does without.
 */
const NEVER_AT_SIMPLE: ReadonlySet<string> = new Set([
	// the exact units: the simple level uses `@/i18n`'s quantities instead
	"units.au",
	"units.gravity",
	"units.millionKm",
	"units.billionKm",
	"quantity.celsius",
	"quantity.kelvin",
])

/**
 * Fields that are not text for the reader to understand: catalogue names
 * ("S/2015 (136472) 1") and the help page's credits and licences, written
 * once for the adults who check them.
 */
const NOT_PROSE: Readonly<Partial<Record<Resource, readonly string[]>>> = {
	bodies: ["name"],
	spacecraft: ["name"],
	help: ["credits", "creditNames", "licences"],
}

// ------------------------------------------------------------ the texts

const ARGUMENT_TYPES = new Set([1, 2, 3, 4, 5, 6])
type AstNode = {
	type: number
	value?: string
	options?: Record<string, { value: AstNode[] }>
	children?: AstNode[]
}

/** The literal words of an ICU message, every branch of every plural and select. */
function literals(text: string, locale: string): string {
	const parts: string[] = []
	const walk = (nodes: AstNode[]) => {
		for (const node of nodes) {
			if (node.type === 0 && node.value) parts.push(node.value)
			if (ARGUMENT_TYPES.has(node.type) && node.options) {
				for (const option of Object.values(node.options)) walk(option.value)
			}
			if (node.children) walk(node.children)
		}
	}
	walk(compileMessage(text, locale).getAst() as unknown as AstNode[])
	return parts.join("\n")
}

/** "key: problem, problem" for every ui.json message the simple level shows that breaks the rule. */
function uiProblems(locale: string): string[] {
	const messages = catalog.get(locale)!
	const keys = new Set([...messages.keys()].map((key) => splitLevel(key)[0]))
	const problems: string[] = []
	for (const key of keys) {
		if (NEVER_AT_SIMPLE.has(key)) continue
		const text = messages.get(`${key}@simple`) ?? messages.get(key)
		if (text === undefined) continue
		const found = simpleProblems(literals(text, locale), locale)
		if (found.length > 0) problems.push(`${key}: ${found.join(", ")}`)
	}
	return problems
}

const isLeveled = (value: object): value is Record<string, unknown> => {
	const keys = Object.keys(value)
	return (
		keys.length > 0 &&
		keys.includes(DEFAULT_READING_LEVEL) &&
		keys.every((key) => (READING_LEVELS as readonly string[]).includes(key))
	)
}

/** Every text a simple-level reader sees in a plain-text resource, with its path. */
function* simpleTexts(
	value: unknown,
	skip: readonly string[],
	path = "",
): Generator<[string, string]> {
	if (typeof value === "string") {
		yield [path, value]
	} else if (Array.isArray(value)) {
		for (const [i, item] of value.entries())
			yield* simpleTexts(item, skip, `${path}[${i}]`)
	} else if (value !== null && typeof value === "object") {
		if (isLeveled(value)) {
			yield* simpleTexts(
				value.simple ?? value[DEFAULT_READING_LEVEL],
				skip,
				path,
			)
			return
		}
		for (const [key, item] of Object.entries(value)) {
			if (skip.includes(key)) continue
			yield* simpleTexts(item, skip, path === "" ? key : `${path}.${key}`)
		}
	}
}

const resourceFiles: Readonly<Record<string, unknown>> = import.meta.glob(
	"../locales/*/{bodies,hunts,tours,help,events,spacecraft,worlds}.json",
	{ eager: true, import: "default" },
)

function resourceProblems(locale: string, resource: Resource): string[] {
	if (resource === "ui") return uiProblems(locale)
	const file = resourceFiles[`../locales/${locale}/${resource}.json`]
	if (file === undefined) return []
	const problems: string[] = []
	for (const [path, text] of simpleTexts(file, NOT_PROSE[resource] ?? [])) {
		const found = simpleProblems(text, locale)
		if (found.length > 0) problems.push(`${path}: ${found.join(", ")}`)
	}
	return problems
}

const RESOURCES: readonly Resource[] = [
	"ui",
	"bodies",
	"hunts",
	"tours",
	"help",
	"events",
	"spacecraft",
	"worlds",
]

describe("the simple level's texts (#51)", () => {
	it("lists only shipped locales and never ui.json as pending", () => {
		for (const [locale, pending] of Object.entries(PENDING)) {
			expect(LOCALES).toContain(locale)
			expect(pending).not.toContain("ui")
		}
	})

	describe.each(LOCALES)("%s", (locale) => {
		it.each(RESOURCES)("%s.json", (resource) => {
			const problems = resourceProblems(locale, resource)
			if ((PENDING[locale] ?? []).includes(resource)) {
				// done? then take it off PENDING in this file
				expect(
					problems.length,
					`${locale}/${resource}.json is clean: remove it from PENDING`,
				).toBeGreaterThan(0)
			} else {
				expect(problems).toEqual([])
			}
		})
	})
})

// ------------------------------------------------- the formatted values

/** 10^from … 10^to in steps of a third of a decade (1, 2.15, 4.64, 10, …). */
const range = (from: number, to: number): number[] =>
	Array.from({ length: (to - from) * 3 + 1 }, (_, i) => 10 ** (from + i / 3))

/** Catalogue names with digits ("S/2004 S 37"), longest first: names, not numbers. */
const designations = (locale: string): string[] =>
	bodies
		.map((body) => bodyName(body.id, createI18n({ locale }).chain))
		.filter((name) => /\d/.test(name))
		.sort((a, b) => b.length - a.length)

/** Fails with every value that breaks the rule (body names aside). */
function expectClean(values: Iterable<string | null>, locale: string) {
	const names = designations(locale)
	const withoutNames = (value: string) =>
		names.reduce((text, name) => text.split(name).join(""), value)
	const problems = [...values]
		.filter((value): value is string => value !== null)
		.map(
			(value) => [value, simpleProblems(withoutNames(value), locale)] as const,
		)
		.filter(([, found]) => found.length > 0)
		.map(([value, found]) => `${value} (${found.join(", ")})`)
	expect(problems).toEqual([])
}

/** The bodies the pair comparisons are checked for: every kind, the extremes of size and distance. */
const PAIR_IDS = [
	"sun",
	...planets.map((planet) => planet.id),
	"moon",
	"phobos",
	"ganymede",
	"titan",
	"pluto",
	"ceres",
	"halley",
	"halebopp",
]

describe.each(LOCALES)("the simple level's numbers in %s (#51)", (locale) => {
	const i18n: I18n = createI18n({ locale, readingLevel: "simple" })
	const name = (id: string) => bodyName(id, i18n.chain)
	const jd = dateToJD(new Date(Date.UTC(2026, 9, 7, 12)))

	it("quantity helpers, over their whole range", () => {
		expectClean(
			[
				...range(-1, 14).flatMap((km) => [
					distanceInWords(km, i18n),
					formatDistance(km, i18n),
					formatSize(km, i18n),
					sizeVsEarth(km, i18n),
				]),
				...range(-2, 17).map((seconds) => durationInWords(seconds, i18n)),
				...range(-3, 6).flatMap((value) => [
					dayVsEarth(value, i18n),
					yearVsEarth(value * 365, i18n),
					weightVsEarth(value, i18n),
					formatSpeed(value, i18n),
					formatWeight(value, i18n),
					formatCount(value, i18n),
				]),
				...range(15, 31).map((kg) => massVsEarth(kg, i18n)),
				...Array.from({ length: 101 }, (_, i) => i * 100).flatMap((kelvin) => [
					formatTemperature(kelvin, i18n),
					formatTemperatureRange(kelvin, kelvin + 400, i18n),
				]),
				...bodies.map((body) =>
					everydaySize(
						{ id: body.id, name: name(body.id), diameterKm: 2 * body.radiusKm },
						i18n,
					),
				),
			],
			locale,
		)
	})

	it("the world card and the moons' generated descriptions", () => {
		expectClean(
			bodies.flatMap((body) => [
				...headlineFacts(body, i18n).flatMap((fact) => [
					fact.label,
					fact.comparison,
					fact.value,
				]),
				getBodyText(body.id, i18n).authored
					? null
					: getBodyText(body.id, i18n).description,
			]),
			locale,
		)
	})

	it("the dictionary's numbers", () => {
		const earth = solarDictionary.find((item) => item.name === "Earth")
		const earthKg = getBody("earth").massKg!
		const temperature = (degrees: World["temperature"]["high"] | undefined) =>
			degrees === undefined
				? null
				: levelQuantity({ kind: "temperature", degrees }, i18n)
		expectClean(
			[
				...solarDictionary.flatMap((item) =>
					getSidebarFacts(
						item,
						["diameter", "lengthOfDay", "orbitalPeriod", "gravity", "avgTemp"],
						earth,
						i18n,
						item.name,
					).flatMap((fact) => [fact.value, fact.extra]),
				),
				...WORLDS.flatMap((world) => {
					const body = getBody(world.id)
					return [
						levelQuantity(
							{
								kind: "mass",
								kg: body.massKg!,
								earthKg,
								star: body.kind === "star",
							},
							i18n,
						),
						levelQuantity(
							{ kind: "density", gramsPerCm3: densityOf(body)! },
							i18n,
						),
						temperature(world.temperature.high),
						temperature(world.temperature.low),
						...world.madeOf.layers.map((layer, i, layers) =>
							levelQuantity(
								{
									kind: "length",
									km:
										(layer.outer - (layers[i - 1]?.outer ?? 0)) * body.radiusKm,
								},
								i18n,
							),
						),
					]
				}),
			],
			locale,
		)
	})

	it("the comparison page", () => {
		const values: (string | null)[] = []
		for (const [i, a] of PAIR_IDS.entries()) {
			for (const b of PAIR_IDS.slice(i + 1)) {
				for (const fact of pairFacts(getBody(a), getBody(b), i18n, {
					jd,
					live: true,
				})) {
					values.push(
						fact.comparison,
						...fact.values.map((value) => value.text),
						...fact.notes,
					)
				}
			}
		}
		expectClean(values, locale)
	})

	it("flights, light travel and the spacecraft", () => {
		expectClean(
			range(2, 11).flatMap((km) => [
				distanceLine(km, i18n),
				crossedLine(km, i18n),
				...travelTimes(km, i18n).map((time) => time.time),
				formatDuration(km / 299_792.458, i18n),
				formatDuration(km / 299_792.458, i18n, true),
			]),
			locale,
		)
		expectClean(
			[4.2465, 26_000, 2_500_000].map((years) =>
				formatDuration(years * 365.25 * 86_400, i18n),
			),
			locale,
		)
	})

	it("the birthday", () => {
		for (const born of ["2018-03-12", "1990-07-01", "2026-10-01"]) {
			const facts = birthdayFacts(born, new Date(Date.UTC(2026, 9, 7, 12)))
			const card = cardText(facts, i18n, name, (day) => day, "")
			expectClean(
				[
					i18n.t("solarSystem.birthday.distance", {
						distance: "",
						speed: 0,
						trips: 0,
						...lapsArgs(facts, i18n),
					}),
					card.distance,
					...card.rows.map((row) => row.age),
					...facts.worlds.map((world) =>
						i18n.t("solarSystem.birthday.days.lived", {
							count: world.daysLived ?? 0,
							n: formatCount(world.daysLived ?? 0, i18n),
						}),
					),
					...facts.worlds.map((world) =>
						i18n.t("solarSystem.birthday.years.earthAgeThen", {
							age: world.earthAgeThen,
							n: formatCount(world.earthAgeThen, i18n),
						}),
					),
				],
				locale,
			)
		}
	})

	it("the scale notice, the belts, the comets, the opening and the sky events", () => {
		const values: (string | null)[] = []
		for (const id of SCALE_PRESET_IDS) {
			for (const body of bodies) {
				const { size, distance } = scaleSentences(
					body,
					SCALE_PRESETS[id],
					name,
					i18n,
				)
				values.push(i18n.t(size.key, size.values))
				if (distance) values.push(i18n.t(distance.key, distance.values))
			}
		}
		for (const belt of belts)
			values.push(...Object.values(beltSentences(belt, i18n)))
		for (const comet of bodies.filter((body) => body.kind === "comet")) {
			for (const at of [jd - 20_000, jd, jd + 3000]) {
				const text = cometSentences(comet, at, i18n)
				if (text) values.push(...Object.values(text))
			}
		}
		for (const beat of ["earth", "moon", "inner", "system", "scale"] as const) {
			const caption = introCaption(beat, i18n, name)
			values.push(caption.title, caption.detail)
		}
		for (const event of SKY_EVENTS)
			values.push(shownOffset(event, i18n)?.amount ?? null)
		expectClean(values, locale)
	})

	it("the walk", () => {
		const values: (string | null)[] = []
		for (const object of SUN_OBJECT_IDS) {
			const walk = buildWalk(object)
			values.push(leadText(walk, i18n), summaryText(walk, i18n))
			values.push(sunStopText(walk, i18n), starText(walk, i18n))
			for (const stop of walk.stops) {
				for (const landmark of ["pitch", "track", null] as const) {
					const text = stopText(stop, landmark, i18n, name)
					values.push(text.leg, text.size, text.distance, text.landmark)
					values.push(...text.moons)
				}
			}
		}
		expectClean(values, locale)
	})

	it("covers every body kind", () => {
		const kinds = new Set(bodies.map((body: Body) => body.kind))
		expect(kinds.size).toBeGreaterThan(4)
		expect(bodyById.has("halebopp")).toBe(true)
	})
})
