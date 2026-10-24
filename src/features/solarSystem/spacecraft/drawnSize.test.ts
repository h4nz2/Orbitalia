/**
 * The card's honest statement (#73) in every locale and reading level: how
 * much bigger than it is the craft is drawn, or that it is a marker; simple
 * texts keep to the simple level's rules (#51), and the scene's number
 * reaches the card only when what it says changes.
 */
import { afterEach, describe, expect, it } from "vitest"

import { createI18n, type ReadingLevel } from "@/i18n"
import { simpleProblems } from "@/i18n/simpleRules"
import config from "@/locales/config.json"

import {
	DRAWN_UPDATE_MS,
	drawnSentence,
	formatDrawnFactor,
	publishCraftDrawn,
	useCraftDrawnStore,
} from "./drawnSize"

const locales = ["en", "de", "cs", "es", "fr"] as const
const levels = config.readingLevels as ReadingLevel[]

const say = (
	as: Parameters<typeof drawnSentence>[0],
	factor: number,
	locale: string,
	readingLevel: ReadingLevel,
) => {
	const i18n = createI18n({ locale, readingLevel })
	const sentence = drawnSentence(as, factor, i18n)
	// Intl's narrow no-break spaces read as spaces here
	return sentence === null
		? null
		: i18n.t(sentence.key, sentence.values).replace(/[\u00a0\u202f]/g, " ")
}

describe("drawnSentence", () => {
	it("says how much bigger, in words from a million, at the exact levels", () => {
		expect(say("model", 512_345, "en", "standard")).toBe(
			"Drawn about 510,000 times bigger than it is. At its real size it would be far smaller than a pixel.",
		)
		expect(say("model", 2_140_000, "en", "advanced")).toBe(
			"Drawn about 2.1 million times bigger than it is. At its real size it would be far smaller than a pixel.",
		)
		expect(say("model", 36_800_000_000, "de", "standard")).toContain(
			"etwa 37 Milliarden Mal größer",
		)
		expect(say("model", 2_000_000, "fr", "standard")).toContain(
			"environ 2 millions de fois plus grande",
		)
		expect(say("model", 510_000, "fr", "standard")).toContain(
			"environ 510 000 fois plus grande",
		)
		expect(say("model", 37e9, "es", "standard")).toContain(
			"unos 37 mil millones de veces",
		)
		expect(say("model", 510_000, "es", "standard")).toContain(
			"unas 510.000 veces",
		)
		expect(say("model", 510_000, "cs", "standard")).toContain("510 000× větší")
	})

	it("keeps to the simple level's rules: no big numbers, too small to see", () => {
		expect(say("model", 510_000, "en", "simple")).toBe(
			"Drawn more than 100 times bigger than it really is. At its real size it would be far too small to see.",
		)
		for (const locale of locales) {
			for (const as of ["model", "marker"] as const) {
				const text = say(as, 37e9, locale, "simple")!
				expect(
					simpleProblems(text, locale),
					`${locale} ${as}: ${text}`,
				).toEqual([])
			}
		}
	})

	it("explains the marker, and says nothing for a craft not drawn", () => {
		expect(say("marker", 0, "en", "standard")).toBe(
			"Shown as a marker: at its real size it would be far too small to see.",
		)
		expect(say("none", 0, "en", "standard")).toBeNull()
	})

	it("is written in every locale at every reading level, never in English elsewhere", () => {
		for (const level of levels) {
			const english = say("model", 2e6, "en", level)
			for (const locale of locales) {
				const text = say("model", 2e6, locale, level)!
				expect(text, `${locale} ${level}`).not.toMatch(/[{}]/)
				if (locale !== "en") expect(text).not.toBe(english)
				expect(say("marker", 0, locale, level)).not.toMatch(/[{}]/)
			}
		}
	})

	it("formats the factor for the level", () => {
		const en = createI18n({ locale: "en", readingLevel: "standard" })
		expect(formatDrawnFactor(512_345, en)).toEqual({
			n: "510,000",
			form: "digits",
		})
		expect(formatDrawnFactor(999_499, en)).toEqual({
			n: "1 million",
			form: "words",
		})
		expect(formatDrawnFactor(1.26e8, en)).toEqual({
			n: "130 million",
			form: "words",
		})
	})
})

describe("publishCraftDrawn", () => {
	afterEach(() =>
		useCraftDrawnStore.setState({ craftId: null, as: "none", factor: 0 }),
	)

	it("hands a new craft or way of drawing over at once, a new number at most every DRAWN_UPDATE_MS", () => {
		publishCraftDrawn("voyager1", "model", 512_345, 0)
		expect(useCraftDrawnStore.getState()).toMatchObject({
			craftId: "voyager1",
			as: "model",
			factor: 510_000,
		})
		const state = useCraftDrawnStore.getState()
		// the same rounded number: nothing changes, not even the object
		publishCraftDrawn("voyager1", "model", 508_000, 10)
		expect(useCraftDrawnStore.getState()).toBe(state)
		// a new number, too soon after the last change, then later
		publishCraftDrawn("voyager1", "model", 600_000, DRAWN_UPDATE_MS / 2)
		expect(useCraftDrawnStore.getState().factor).toBe(510_000)
		publishCraftDrawn("voyager1", "model", 600_000, DRAWN_UPDATE_MS)
		expect(useCraftDrawnStore.getState().factor).toBe(600_000)
		// a marker at once
		publishCraftDrawn("voyager1", "marker", 0, DRAWN_UPDATE_MS + 1)
		expect(useCraftDrawnStore.getState()).toMatchObject({
			as: "marker",
			factor: 0,
		})
	})
})
