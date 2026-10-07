import { describe, expect, it } from "vitest"

import { getBody } from "@/data"
import { createI18n, type Locale, type ReadingLevel } from "@/i18n"
import { bodyName } from "@/i18n/bodies"
import { SCALE_PRESETS, type ScalePresetId } from "@/sim"

import { roundFactor, scaleSentences, statementSubject } from "./scaleStatement"

const say = (
	bodyId: string,
	preset: ScalePresetId,
	locale: Locale = "en",
	readingLevel: ReadingLevel = "standard",
): string[] => {
	const i18n = createI18n({ locale, readingLevel })
	const { size, distance } = scaleSentences(
		getBody(bodyId),
		SCALE_PRESETS[preset],
		(id) => bodyName(id, i18n.chain),
		i18n,
	)
	return [size, distance].flatMap((s) =>
		s === null ? [] : [i18n.t(s.key, s.values)],
	)
}

describe("statementSubject", () => {
	it("talks about the body in view, and about Earth in the overview or at the Sun", () => {
		expect(statementSubject("io", "jupiter").id).toBe("io")
		expect(statementSubject(null, "mars").id).toBe("mars")
		expect(statementSubject(null, "sun").id).toBe("earth")
		expect(statementSubject("sun", "sun").id).toBe("earth")
		expect(statementSubject("vulcan", null).id).toBe("earth")
	})
})

describe("roundFactor", () => {
	it("rounds the way people say factors", () => {
		expect(roundFactor(10.45)).toBe(10)
		expect(roundFactor(67.5)).toBe(68)
		expect(roundFactor(3.15)).toBe(3.2)
		expect(roundFactor(1.37)).toBe(1.4)
		expect(roundFactor(Number.NaN)).toBe(1)
		expect(roundFactor(0)).toBe(1)
	})
})

describe("scaleSentences", () => {
	it("says how far from true the default draws Earth, at every reading level", () => {
		expect(say("earth", "everythingVisible")).toEqual([
			"Earth is drawn 10× too big.",
			"Earth is drawn 13× too close to the Sun.",
		])
		expect(say("earth", "everythingVisible", "en", "simple")).toEqual([
			"Earth looks 10 times bigger than it really is!",
			"Earth is shown 13 times closer to the Sun than it really is!",
		])
		expect(say("earth", "everythingVisible", "en", "advanced")).toEqual([
			"Earth: radius drawn at 10× its true value.",
			"Earth: distance from the Sun drawn at 1/13 of its true value.",
		])
	})

	it("never shows a factor above 100 at the simple level (#51)", () => {
		expect(say("phobos", "everythingVisible")[0]).toMatch(
			/^Phobos is drawn \d{3,}/,
		)
		expect(say("phobos", "everythingVisible", "en", "simple")[0]).toBe(
			"Phobos looks more than 100 times bigger than it really is!",
		)
		expect(say("phobos", "everythingVisible", "de", "simple")[0]).toBe(
			"Phobos ist hier mehr als 100-mal größer als in Wirklichkeit!",
		)
	})

	it("says it in German, with the right article and case", () => {
		expect(say("earth", "everythingVisible", "de")).toEqual([
			"Die Erde ist 10-mal zu groß gezeichnet.",
			"Die Erde ist 13-mal zu nah an der Sonne gezeichnet.",
		])
		expect(say("moon", "everythingVisible", "de")).toEqual([
			"Der Mond ist 20-mal zu groß gezeichnet.",
			"Der Mond ist 1,4-mal zu weit von der Erde entfernt gezeichnet.",
		])
		expect(say("io", "everythingVisible", "de", "simple")).toEqual([
			"Io ist hier 20-mal größer als in Wirklichkeit!",
			"Io ist hier 2-mal weiter vom Jupiter weg als in Wirklichkeit!",
		])
		expect(say("mars", "trueScale", "de", "advanced")).toEqual([
			"Mars: Radius maßstabsgetreu.",
			"Mars: Abstand zur Sonne maßstabsgetreu.",
		])
	})

	it("calls the truth the truth: true scale, and each lie on its own", () => {
		expect(say("earth", "trueScale")).toEqual([
			"Earth is drawn at its real size.",
			"Earth is drawn at its real distance from the Sun.",
		])
		expect(say("jupiter", "textbook")).toEqual([
			"Jupiter is drawn at its real size.",
			"Jupiter is drawn 192× too close to the Sun.",
		])
		expect(say("jupiter", "bigPlanets")).toEqual([
			"Jupiter is drawn 3.2× too big.",
			"Jupiter is drawn at its real distance from the Sun.",
		])
		expect(say("moon", "trueScale", "en", "simple")).toEqual([
			"The Moon is shown as big as it really is.",
			"The Moon is just as far from Earth as in real life.",
		])
	})
})
