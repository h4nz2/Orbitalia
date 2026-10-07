import { describe, expect, it } from "vitest"

import { solarDictionary } from "@/data/solarDictionary"
import { createI18n, type ReadingLevel } from "@/i18n"

import { getSidebarFacts, type FactKey } from "./getSidebarLabels"

const byName = (name: string) =>
	solarDictionary.find((item) => item.name === name)!
const earth = byName("Earth")

const ALL: FactKey[] = [
	"name",
	"diameter",
	"lengthOfDay",
	"orbitalPeriod",
	"gravity",
	"avgTemp",
]

const facts = (
	name: string,
	locale = "en",
	readingLevel: ReadingLevel = "standard",
	volumes?: { body: number; earth: number },
) =>
	Object.fromEntries(
		getSidebarFacts(
			byName(name),
			ALL,
			earth,
			createI18n({ locale, readingLevel }),
			name,
			volumes,
		).map((fact) => [fact.key, fact]),
	)

describe("getSidebarFacts", () => {
	it("labels, formats and compares in English", () => {
		const mars = facts("Mars")
		expect(mars.diameter.label).toBe("Diameter")
		expect(mars.diameter.value).toBe("6,792 km")
		expect(mars.orbitalPeriod.value).toBe("687 days")
		expect(mars.gravity.value).toBe("3.71 m/s²")
		expect(mars.avgTemp.value).toBe("-63 °C")
		expect(mars.avgTemp.extra).toBeNull()
		expect(mars.orbitalPeriod.extra).toBe(
			"You would wait 322 days longer for your birthday.",
		)
	})

	it("formats everything for German, including plurals", () => {
		const jupiter = facts("Jupiter", "de")
		expect(jupiter.diameter.label).toBe("Durchmesser")
		expect(jupiter.diameter.value).toBe("142.984 km")
		expect(jupiter.lengthOfDay.value).toBe("9,9 Stunden")
		expect(jupiter.lengthOfDay.extra).toBe(
			"Ein Tag dort dauert nur 9,9 Stunden.",
		)
		expect(jupiter.orbitalPeriod.value).toBe("4.331 Tage")
		expect(jupiter.gravity.extra).toBe(
			"Du würdest 2,5-mal so viel wiegen wie auf der Erde!",
		)
	})

	it("never says '1 days' (the old concatenation bug)", () => {
		// Mars's day is 24.7 h: "similar" rather than "1 days"
		expect(facts("Mars").lengthOfDay.extra).toBe(
			"One day there is about as long as on Earth.",
		)
		const venus = facts("Venus", "en", "simple")
		expect(venus.lengthOfDay.extra).toBe(
			"A day there lasts as long as more than 100 days at home",
		)
		expect(facts("Venus", "en", "standard").lengthOfDay.extra).toBe(
			"One day there lasts 117 Earth days.",
		)
	})

	it("changes the sentences with the reading level", () => {
		expect(facts("Mars", "en", "simple").gravity.extra).toBe(
			"If you weigh 30 kg on Earth, you would weigh only 11 kg there!",
		)
		expect(facts("Mars", "en", "standard").gravity.extra).toBe(
			"You would weigh only 38% of your weight on Earth.",
		)
		expect(facts("Mars", "de", "standard").gravity.extra).toBe(
			"Du würdest nur 38\u00a0% deines Gewichts auf der Erde wiegen.",
		)
		expect(facts("Mars", "en", "advanced").gravity.extra).toMatch(
			/mass would stay the same/,
		)
	})

	it("uses real volumes when given, so flattened giants are not overstated", () => {
		expect(facts("Jupiter").diameter.extra).toBe(
			"Earth would fit inside it 1,408 times.",
		)
		expect(
			facts("Jupiter", "en", "standard", {
				body: 1.43128e15,
				earth: 1.08321e12,
			}).diameter.extra,
		).toBe("Earth would fit inside it 1,321 times.")
	})

	it("counts birthdays on fast planets and years on slow ones", () => {
		expect(facts("Mercury", "en", "standard").orbitalPeriod.extra).toBe(
			"A year there lasts only 88 days – that is 4.1 birthdays per Earth year!",
		)
		expect(facts("Neptune", "de", "standard").orbitalPeriod.extra).toBe(
			"Ein Jahr dort dauert 164 Erdjahre – eine lange Wartezeit auf den nächsten Geburtstag!",
		)
		// the simple level: the year at home is the yardstick, no number above 100 (#51)
		expect(facts("Mercury", "en", "simple").orbitalPeriod.extra).toBe(
			"In one year at home, 4 years go by there",
		)
		expect(facts("Neptune", "de", "simple").orbitalPeriod.extra).toBe(
			"Ein Jahr dort dauert so lange wie mehr als 100 Jahre zu Hause",
		)
	})

	it("does not compare Earth with itself", () => {
		const own = facts("Earth")
		expect(own.diameter.extra).toBeNull()
		expect(own.gravity.extra).toBeNull()
		expect(own.avgTemp.value).toBe("15 °C")
	})

	it("gives the temperature in words, °C or kelvin by reading level (#51)", () => {
		expect(facts("Mars", "en", "simple").avgTemp.value).toBe(
			"Colder than any freezer",
		)
		expect(facts("Mars", "en", "standard").avgTemp.value).toBe("-63 °C")
		expect(facts("Mars", "en", "advanced").avgTemp.value).toBe("210 K (-63 °C)")
		expect(facts("Venus", "de", "simple").avgTemp.value).toBe(
			"Heißer als ein Backofen",
		)
	})

	it("leaves out facts without a value", () => {
		const sun = facts("Sun")
		expect(sun.lengthOfDay).toBeUndefined()
		expect(sun.orbitalPeriod).toBeUndefined()
		expect(sun.name.value).toBe("Sun")
	})
})
