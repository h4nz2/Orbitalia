/**
 * The contract of the dictionary's stories (#53): every world has what it is
 * made of (with the layers of its picture), a temperature range, a nickname
 * with its story, where its name comes from and how it was found, each fact
 * with a public source, at every reading level in every locale.
 */
import { describe, expect, it } from "vitest"

import { bodyById } from "@/data"
import { solarDictionary } from "@/data/solarDictionary"
import {
	WORLDS,
	WorldsFile,
	celsiusOf,
	worldsFile,
	type World,
} from "@/data/worlds"
import { DEFAULT_LOCALE, LOCALES, READING_LEVELS, createI18n } from "@/i18n"

import { dictionaryEntry } from "../solarSystem/ui/dictionaryEntry"
import { dictionaryBodyId } from "./utils/bodyId"
import { densityOf } from "./utils/heft"
import { levelQuantity } from "./utils/quantity"
import {
	WorldTextFile,
	gasName,
	layerName,
	localNameStory,
	nicknameStory,
	worldStory,
	worldText,
} from "./worldText"

/** The reading levels a plain-or-leveled value spells out. */
const levelsOf = (value: unknown): string[] =>
	typeof value === "string" || Array.isArray(value)
		? ["*"]
		: Object.keys(value as object).sort()

const ALL_LEVELS = [...READING_LEVELS].sort()

/** Every fact a world records, with its sources. */
const sourcesOf = (world: World): [string, readonly string[]][] => [
	["madeOf", world.madeOf.sources],
	["air", world.air.sources],
	["temperature", world.temperature.sources],
	...world.nicknames.map((nickname): [string, readonly string[]] => [
		`nickname ${nickname.id}`,
		nickname.sources,
	]),
	["name", world.name.sources],
	...Object.entries(world.localNames ?? {}).map(
		([locale, urls]): [string, readonly string[]] => [
			`localName ${locale}`,
			urls,
		],
	),
	["discovery", world.discovery.sources],
	["heft", world.heft.sources],
]

describe("the facts (src/data/worlds.json)", () => {
	it("matches the schema", () => {
		const result = WorldsFile.safeParse(worldsFile)
		expect(result.success ? [] : result.error.issues).toEqual([])
	})

	it("covers the Sun and the eight planets, in the dictionary's order", () => {
		expect(WORLDS.map((world) => world.id)).toEqual(
			solarDictionary.map(dictionaryBodyId),
		)
		for (const world of WORLDS) expect(bodyById.has(world.id)).toBe(true)
	})

	it("is where a world card's “Read more in the dictionary” leads", () => {
		WORLDS.forEach((world, index) =>
			expect(dictionaryEntry(world.id), world.id).toBe(index),
		)
	})

	it.each(WORLDS.map((world) => [world.id, world] as const))(
		"%s: layers for its picture, its air, a range, a nickname, a name and a discovery",
		(_, world) => {
			expect(world.madeOf.layers.length).toBeGreaterThanOrEqual(2)
			expect(world.madeOf.layers.at(-1)!.outer).toBe(1)
			expect(world.air.gases.length).toBeGreaterThanOrEqual(1)
			if (world.temperature.range !== "steady") {
				expect(celsiusOf(world.temperature.high)).toBeGreaterThan(
					celsiusOf(world.temperature.low!),
				)
			}
			expect(world.nicknames.length).toBeGreaterThanOrEqual(1)
			// the shares are of one whole
			const total = world.air.gases.reduce(
				(sum, gas) => sum + (gas.percent ?? 0),
				0,
			)
			expect(total).toBeLessThanOrEqual(100.5)
		},
	)

	it("records a public source for every fact", () => {
		for (const world of WORLDS) {
			for (const [fact, urls] of sourcesOf(world)) {
				expect(urls.length, `${world.id} ${fact}`).toBeGreaterThan(0)
				for (const url of urls) {
					expect(url, `${world.id} ${fact}`).toMatch(/^https:\/\/[a-z0-9.-]+\//)
				}
			}
			for (const locale of Object.keys(world.localNames ?? {})) {
				expect(LOCALES, `${world.id} localNames`).toContain(locale)
			}
		}
	})

	it("has a mass and a size in the body model for the heft", () => {
		for (const world of WORLDS) {
			const body = bodyById.get(world.id)!
			expect(densityOf(body), world.id).toBeGreaterThan(0.5)
		}
		// Saturn is the one that floats
		expect(densityOf(bodyById.get("saturn")!)).toBeCloseTo(0.687, 2)
		expect(
			WORLDS.filter((world) => densityOf(bodyById.get(world.id)!)! < 1).map(
				(world) => world.id,
			),
		).toEqual(["saturn"])
	})
})

describe("the words (src/locales/<locale>/worlds.json)", () => {
	const layerIds = [
		...new Set(
			WORLDS.flatMap((world) => world.madeOf.layers.map((layer) => layer.id)),
		),
	].sort()
	const gasIds = [
		...new Set(WORLDS.flatMap((world) => world.air.gases.map((gas) => gas.id))),
	].sort()

	it("exist for every locale", () => {
		expect([...worldText.keys()].sort()).toEqual([...LOCALES].sort())
	})

	describe.each(LOCALES)("%s", (locale) => {
		const file = worldText.get(locale)!

		it("matches the schema", () => {
			const result = WorldTextFile.safeParse(file)
			expect(result.success ? [] : result.error.issues).toEqual([])
		})

		it("names exactly the layers, gases, worlds and nicknames of the facts", () => {
			expect(Object.keys(file.layers).sort()).toEqual(layerIds)
			expect(Object.keys(file.gases).sort()).toEqual(gasIds)
			expect(Object.keys(file.worlds)).toEqual(WORLDS.map((world) => world.id))
			for (const world of WORLDS) {
				expect(Object.keys(file.worlds[world.id]!.nicknames), world.id).toEqual(
					world.nicknames.map((nickname) => nickname.id),
				)
			}
		})

		it("writes every story for every reading level", () => {
			for (const world of WORLDS) {
				const words = file.worlds[world.id]!
				for (const field of [
					"madeOf",
					"air",
					"weather",
					"name",
					"discovery",
				] as const) {
					expect(levelsOf(words[field]), `${world.id}.${field}`).toEqual(
						ALL_LEVELS,
					)
				}
				for (const [id, nickname] of Object.entries(words.nicknames)) {
					expect(levelsOf(nickname.story), `${world.id}.${id}`).toEqual(
						ALL_LEVELS,
					)
				}
				if (words.localName !== undefined) {
					expect(levelsOf(words.localName), `${world.id}.localName`).toEqual(
						ALL_LEVELS,
					)
				}
			}
		})

		it("tells its own name's story exactly where the facts record one", () => {
			for (const world of WORLDS) {
				expect(
					file.worlds[world.id]!.localName !== undefined,
					`${world.id}.localName`,
				).toBe(world.localNames?.[locale] !== undefined)
			}
		})

		it("keeps the simple level free of big numbers and units (#51)", () => {
			const i18n = createI18n({ locale, readingLevel: "simple" })
			const texts = WORLDS.flatMap((world) => [
				...(["madeOf", "air", "weather", "name", "discovery"] as const).map(
					(field) => worldStory(world.id, field, i18n),
				),
				...world.nicknames.flatMap((nickname) =>
					Object.values(nicknameStory(world.id, nickname.id, i18n)),
				),
				localNameStory(world.id, i18n) ?? "",
				...world.madeOf.layers.map((layer) => layerName(layer.id, i18n)),
			])
			for (const text of texts) {
				for (const number of text.match(/\d[\d.,\s’']*\d|\d/g) ?? []) {
					expect(
						Number(number.replace(/[^\d]/g, "")),
						`"${number}" in: ${text}`,
					).toBeLessThanOrEqual(100)
				}
				// unit symbols are case-sensitive, and the u flag keeps "könnte" or "au" from counting
				expect(text, text).not.toMatch(
					/°|(?<![\p{L}\d])(?:km|AU|K)(?![\p{L}\d])|m\/s|×\s*10/u,
				)
				expect(text, text).not.toMatch(
					/million|millon|milion|milliard|billion|thousand|tausend|tisíc|(?<!\p{L})(?:mil|mille)(?!\p{L})/iu,
				)
			}
		})

		it("names the year of every discovery that has one", () => {
			const i18n = createI18n({ locale, readingLevel: "standard" })
			for (const world of WORLDS) {
				if (world.discovery.year === undefined) continue
				expect(worldStory(world.id, "discovery", i18n), world.id).toContain(
					String(world.discovery.year),
				)
			}
		})
	})
})

describe("every world's sections, at every level in every locale", () => {
	const earthKg = bodyById.get("earth")!.massKg!

	it.each(
		LOCALES.flatMap((locale) =>
			READING_LEVELS.map((level) => [locale, level] as const),
		),
	)("%s %s", (locale, readingLevel) => {
		const i18n = createI18n({ locale, readingLevel })
		for (const world of WORLDS) {
			const body = bodyById.get(world.id)!
			const shown = [
				// Made of
				...world.madeOf.layers.map((layer) => layerName(layer.id, i18n)),
				worldStory(world.id, "madeOf", i18n),
				worldStory(world.id, "air", i18n),
				...world.air.gases.map((gas) => gasName(gas.id, i18n)),
				levelQuantity(
					{
						kind: "mass",
						kg: body.massKg!,
						earthKg,
						star: body.kind === "star",
					},
					i18n,
				),
				levelQuantity({ kind: "density", gramsPerCm3: densityOf(body)! }, i18n),
				// Weather
				levelQuantity(
					{ kind: "temperature", degrees: world.temperature.high },
					i18n,
				),
				...(world.temperature.low
					? [
							levelQuantity(
								{ kind: "temperature", degrees: world.temperature.low },
								i18n,
							),
						]
					: []),
				worldStory(world.id, "weather", i18n),
				// Names
				...world.nicknames.flatMap((nickname) =>
					Object.values(nicknameStory(world.id, nickname.id, i18n)),
				),
				worldStory(world.id, "name", i18n),
				worldStory(world.id, "discovery", i18n),
			]
			for (const text of shown) {
				expect(text, `${world.id}`).toBeTruthy()
				// a missing translation shows its key or id instead
				expect(text, `${world.id}`).not.toMatch(
					/^dictionary\.|^[a-z]+[A-Z]\w*$/,
				)
			}
		}
	})

	it("tells Erde, Země, Tierra and Terre in their own languages", () => {
		for (const locale of LOCALES) {
			expect(
				localNameStory("earth", createI18n({ locale })),
				locale,
			).toBeTruthy()
		}
		// never borrowed from English
		expect(localNameStory("earth", createI18n({ locale: "de" }))).toContain(
			"Erde",
		)
		expect(
			localNameStory("earth", createI18n({ locale: DEFAULT_LOCALE })),
		).toContain("Earth")
	})
})
