import { describe, expect, it } from "vitest"

import { bodies, getBody, planets } from "@/data"
import { READING_LEVELS, createI18n, type I18n } from "@/i18n"
import { AU_KM, dateToJD } from "@/sim"

import {
	distanceKm,
	distanceRangeKm,
	formatLightTime,
	formatMass,
	formatSpan,
	formatTimes,
	pairFacts,
	solarDay,
	type PairFact,
} from "./compareFacts"

const en = createI18n({ locale: "en" })
const de = createI18n({ locale: "de" })
const enSimple = createI18n({ locale: "en", readingLevel: "simple" })
const enAdvanced = createI18n({ locale: "en", readingLevel: "advanced" })

const JD = dateToJD(new Date("2026-09-25T12:00:00Z"))

const factsOf = (a: string, b: string, i18n = en, live = true) =>
	Object.fromEntries(
		pairFacts(getBody(a), getBody(b), i18n, { jd: JD, live }).map((fact) => [
			fact.id,
			fact,
		]),
	) as Record<string, PairFact>

describe("formatting", () => {
	it("says ratios the way people say them", () => {
		expect(formatTimes(1.87, en)).toBe("1.9")
		expect(formatTimes(10.97, en)).toBe("11")
		expect(formatTimes(1321.3, en)).toBe("1,321")
		expect(formatTimes(332_946, en)).toBe("333,000")
		expect(formatTimes(1_301_000, en)).toBe("1.3 million")
		expect(formatTimes(1_301_000, de)).toBe("1,3 Millionen")
	})

	it("picks hours, days or years for a span", () => {
		expect(formatSpan(1, en)).toBe("24 hours")
		expect(formatSpan(87.97, en)).toBe("88 days")
		expect(formatSpan(60_190, en)).toBe("165 years")
	})

	it("gives light time in seconds, minutes or hours", () => {
		expect(formatLightTime(384_400, en)).toBe("1.3 seconds")
		expect(formatLightTime(AU_KM, en)).toBe("8.3 minutes")
		expect(formatLightTime(30 * AU_KM, en)).toBe("4.2 hours")
	})

	it("writes masses in scientific notation", () => {
		expect(formatMass(5.97237e24, en)).toBe("5.97 × 10²⁴ kg")
		expect(formatMass(1.989e30, de)).toBe("1,99 × 10³⁰ kg")
	})
})

describe("physics", () => {
	it("measures true distances between any two bodies", () => {
		const earthMoon = distanceKm(getBody("earth"), getBody("moon"), JD)
		expect(earthMoon).toBeGreaterThan(356_000)
		expect(earthMoon).toBeLessThan(407_000)
		const sunEarth = distanceKm(getBody("sun"), getBody("earth"), JD)
		expect(sunEarth / AU_KM).toBeCloseTo(1, 1)
		// a moon of Jupiter from Earth: about Jupiter's distance
		const io = distanceKm(getBody("earth"), getBody("io"), JD)
		const jupiter = distanceKm(getBody("earth"), getBody("jupiter"), JD)
		expect(Math.abs(io - jupiter)).toBeLessThan(500_000)
		expect(distanceKm(getBody("io"), getBody("earth"), JD)).toBeCloseTo(io, 3)
	})

	it("knows how close and how far two bodies can get", () => {
		const [min, max] = distanceRangeKm(getBody("earth"), getBody("mars"))!
		// the classroom numbers: about 3 to 22 light-minutes
		expect(min / AU_KM).toBeCloseTo(0.37, 1)
		expect(max / AU_KM).toBeCloseTo(2.68, 1)
		const [perigee, apogee] = distanceRangeKm(
			getBody("moon"),
			getBody("earth"),
		)!
		expect(perigee).toBeGreaterThan(360_000)
		expect(apogee).toBeLessThan(410_000)
		expect(distanceRangeKm(getBody("moon"), getBody("io"))).toBeNull()
	})

	it("gives a moon its day under its planet's Sun", () => {
		expect(solarDay(getBody("moon"))).toBeCloseTo(29.53, 1)
		expect(solarDay(getBody("earth"))).toBeCloseTo(1, 2)
		expect(solarDay(getBody("mercury"))).toBeCloseTo(175.9, 0)
		expect(solarDay(getBody("sun"))).toBeNull()
	})
})

describe("pairFacts", () => {
	it("compares Earth and Jupiter in plain words", () => {
		const facts = factsOf("earth", "jupiter")
		expect(facts.size.comparison).toBe("Jupiter is 11 times as wide as Earth.")
		expect(facts.size.values.map((value) => value.name)).toEqual([
			"Earth",
			"Jupiter",
		])
		expect(facts.volume.comparison).toBe(
			"About 1,321 Earths would fit inside Jupiter.",
		)
		expect(facts.mass.comparison).toBe(
			"Jupiter has 318 times as much mass as Earth.",
		)
		expect(facts.weight.comparison).toBe(
			"On Jupiter you would weigh 2.5 times as much as on Earth.",
		)
		expect(facts.weight.notes).toEqual([
			"Jupiter has no solid ground: this is the pull at its cloud tops.",
		])
		expect(facts.year.comparison).toBe(
			"One year on Jupiter lasts as long as 12 years on Earth.",
		)
		expect(facts.day.comparison).toBe(
			"A day on Earth lasts as long as 2.4 days on Jupiter.",
		)
		expect(facts.distance.label).toBe("Distance right now")
		expect(facts.distance.comparison).toMatch(
			/^Light needs \d+ minutes to get from Earth to Jupiter\.$/,
		)
		expect(facts.distance.notes[0]).toMatch(/between \d+ minutes and/)
	})

	it("puts Earth beside the Sun", () => {
		const facts = factsOf("earth", "sun")
		expect(facts.size.comparison).toBe("The Sun is 109 times as wide as Earth.")
		expect(facts.volume.comparison).toBe(
			"About 1.3 million Earths would fit inside the Sun.",
		)
		expect(facts.mass.comparison).toBe(
			"The Sun has 333,000 times as much mass as Earth.",
		)
		expect(facts.weight.comparison).toBe(
			"On the Sun you would weigh 28 times as much as on Earth.",
		)
		expect(facts.distance.comparison).toBe(
			"Light needs 8.3 minutes to get from Earth to the Sun.",
		)
		expect(facts.year).toBeUndefined()
		expect(facts.day).toBeUndefined()
	})

	it("says a year on Neptune lasts 165 of ours", () => {
		expect(factsOf("neptune", "earth").year.comparison).toBe(
			"One year on Neptune lasts as long as 165 years on Earth.",
		)
		expect(factsOf("mercury", "earth").year.comparison).toBe(
			"One year on Earth lasts as long as 4.2 years on Mercury.",
		)
	})

	it("finds the strange calendars of Mercury and Venus", () => {
		expect(factsOf("mercury", "earth")["dayYear-mercury"].comparison).toBe(
			"On Mercury, one day from sunrise to sunrise lasts longer than a whole year there: 176 days against 88 days.",
		)
		expect(factsOf("earth", "venus")["dayYear-venus"].comparison).toBe(
			"Venus turns so slowly that one turn takes longer than its whole year: 243 days against 225 days.",
		)
		expect(factsOf("earth", "mars")["dayYear-mars"]).toBeUndefined()
	})

	it("calls near-equal sizes the same", () => {
		const facts = factsOf("earth", "venus")
		expect(facts.size.comparison).toBe(
			"Earth and Venus are almost the same width.",
		)
		expect(facts.volume).toBeUndefined()
		expect(factsOf("earth", "mars").day.comparison).toBe(
			"A day on Earth is about as long as a day on Mars.",
		)
	})

	it("weighs you on Earth when Earth is one of the two, else on the first", () => {
		expect(factsOf("earth", "moon").weight.comparison).toBe(
			"On the Moon you would weigh only 17% of what you weigh on Earth.",
		)
		expect(factsOf("moon", "mars").weight.comparison).toBe(
			"On Mars you would weigh 2.3 times as much as on the Moon.",
		)
		expect(factsOf("moon", "mars", enSimple).weight.comparison).toBe(
			"Someone who weighs 30 kg on Earth would weigh 5 kg on the Moon and 11 kg on Mars.",
		)
	})

	it("compares two moons of one planet by their laps", () => {
		expect(factsOf("io", "europa").orbit.comparison).toBe(
			"While Europa goes once around Jupiter, Io goes around 2 times.",
		)
		expect(factsOf("io", "europa").year).toBeUndefined()
		expect(factsOf("moon", "earth").day.comparison).toBe(
			"A day on the Moon lasts as long as 30 days on Earth.",
		)
	})

	it("changes the sentence with the reading level", () => {
		expect(factsOf("earth", "jupiter", enSimple).weight.comparison).toBe(
			"Someone who weighs 30 kg on Earth would weigh 76 kg on Jupiter.",
		)
		expect(factsOf("earth", "jupiter", enSimple).distance.comparison).toMatch(
			/A car driving non-stop at 100 km\/h would need \d+ long human lives\.$/,
		)
		expect(factsOf("earth", "sun", enAdvanced).size.comparison).toBe(
			"The Sun’s diameter is 109 times Earth’s.",
		)
		expect(factsOf("earth", "jupiter", enSimple).size.label).toBe("How big")
	})

	it("speaks German with the right articles", () => {
		const facts = factsOf("earth", "jupiter", de)
		expect(facts.size.comparison).toBe(
			"Jupiter ist 11-mal so breit wie die Erde.",
		)
		expect(facts.volume.comparison).toBe(
			"Etwa 1.321 Erden würden in den Jupiter passen.",
		)
		expect(facts.weight.comparison).toBe(
			"Auf dem Jupiter würdest du 2,5-mal so viel wiegen wie auf der Erde.",
		)
		expect(facts.year.comparison).toBe(
			"Ein Jahr auf dem Jupiter dauert so lange wie 12 Jahre auf der Erde.",
		)
		expect(factsOf("sun", "earth", de).distance.comparison).toBe(
			"Licht braucht 8,3 Minuten von der Sonne zur Erde.",
		)
		expect(factsOf("earth", "venus", de).size.comparison).toBe(
			"Die Erde und die Venus sind fast gleich breit.",
		)
	})

	it("dates the distance when it is not the present", () => {
		expect(factsOf("earth", "mars", en, false).distance.label).toBe(
			"Distance on Sep 25, 2026, 12:00 UTC",
		)
	})

	it("says something sensible for every pair, in every locale and reading level", () => {
		const sample = [
			"sun",
			...planets.map((planet) => planet.id),
			"moon",
			"io",
			"titan",
			"phobos",
			bodies[bodies.length - 1].id,
		]
		const i18ns: I18n[] = ["en", "de"].flatMap((locale) =>
			READING_LEVELS.map((readingLevel) =>
				createI18n({ locale, readingLevel }),
			),
		)
		for (const i18n of i18ns) {
			for (const a of sample) {
				for (const b of sample) {
					if (a === b) continue
					const facts = pairFacts(getBody(a), getBody(b), i18n, {
						jd: JD,
						live: true,
					})
					expect(facts.length).toBeGreaterThanOrEqual(3)
					for (const fact of facts) {
						for (const text of [
							fact.label,
							fact.comparison,
							...fact.notes,
							...fact.values.map((value) => value.text),
						]) {
							expect(text, `${a}/${b} ${fact.id}`).not.toMatch(
								/[{}]|compare\.|NaN|Infinity|undefined/,
							)
						}
					}
				}
			}
		}
	})
})
