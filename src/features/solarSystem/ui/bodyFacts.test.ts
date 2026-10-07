import { describe, expect, it } from "vitest"

import { bodies, getBody } from "@/data"
import { solarDictionary } from "@/data/solarDictionary"
import { createI18n } from "@/i18n"
import { dictionaryBodyId } from "@/features/solarDictionary/utils/bodyId"

import { headlineFacts, roughly, surfaceGravity } from "./bodyFacts"
import { dictionaryEntry, nearestDictionaryEntry } from "./dictionaryEntry"

const en = createI18n({ locale: "en" })
const de = createI18n({ locale: "de" })
const enSimple = createI18n({ locale: "en", readingLevel: "simple" })

const factsOf = (id: string, i18n = en) =>
	Object.fromEntries(
		headlineFacts(getBody(id), i18n).map((fact) => [fact.key, fact]),
	)

describe("roughly", () => {
	it("keeps one decimal below 10 and whole numbers above", () => {
		expect(roughly(1.8765)).toBe(1.9)
		expect(roughly(11.21)).toBe(11)
		expect(roughly(109.2)).toBe(109)
	})
})

describe("headlineFacts", () => {
	it("compares sizes with Earth, comparatively first", () => {
		const jupiter = factsOf("jupiter")
		expect(jupiter.size.comparison).toBe("11 Earths wide")
		expect(jupiter.size.value).toMatch(/km across$/)
		expect(factsOf("sun").size.comparison).toBe("109 Earths wide")
		expect(factsOf("venus").size.comparison).toBe("About as wide as Earth")
		expect(factsOf("mars").size.comparison).toBe("Earth is 1.9 times as wide")
	})

	it("compares Earth and the moons with our Moon, and the Moon with Earth", () => {
		expect(factsOf("earth").size.comparison).toBe("3.7 Moons wide")
		expect(factsOf("moon").size.comparison).toBe("Earth is 3.7 times as wide")
		expect(factsOf("ganymede").size.comparison).toBe("1.5 Moons wide")
		expect(factsOf("io").size.comparison).toBe("About as wide as our Moon")
		expect(factsOf("phobos").size.comparison).toMatch(
			/^Our Moon is \d+ times as wide$/,
		)
	})

	it("measures a planet's distance in sunlight travel time", () => {
		const earth = factsOf("earth")
		expect(earth.distance.comparison).toBe(
			"Sunlight takes 8.3 minutes to get here",
		)
		expect(earth.distance.value).toBe("1 AU · 150 million km")
		expect(factsOf("neptune").distance.comparison).toBe(
			"Sunlight takes 4.2 hours to get here",
		)
		expect(factsOf("sun").distance).toBeUndefined()
	})

	it("measures a moon's distance in widths of its planet", () => {
		const moon = factsOf("moon")
		expect(moon.distance.comparison).toBe(
			"Earth would fit into the gap 30 times",
		)
		expect(moon.distance.value).toMatch(/^384,\d{3} km from Earth$/)
		expect(factsOf("moon", de).distance.comparison).toBe(
			"Die Erde würde 30-mal in die Lücke passen",
		)
	})

	it("tells the year in Earth years or laps per Earth year", () => {
		expect(factsOf("jupiter").year.comparison).toBe(
			"One lap around the Sun takes 12 Earth years",
		)
		expect(factsOf("mercury").year.comparison).toBe(
			"Goes around the Sun 4.2 times in one Earth year",
		)
		expect(factsOf("earth").year.comparison).toBe(
			"One lap around the Sun: that is what a year is",
		)
		expect(factsOf("io").orbit.comparison).toMatch(
			/^Goes once around Jupiter in 1\.\d+ days$/,
		)
	})

	it("compares weight with Earth's, and in kilograms for young readers", () => {
		expect(factsOf("jupiter").weight.comparison).toBe(
			"You would weigh 2.5 times as much as on Earth",
		)
		expect(factsOf("mars").weight.comparison).toBe(
			"You would weigh 38% of your weight on Earth",
		)
		expect(factsOf("mars", enSimple).weight.comparison).toBe(
			"30 kg on Earth would be only 11 kg here",
		)
		expect(factsOf("mars", de).weight.comparison).toBe(
			"Du würdest nur 38 % deines Gewichts auf der Erde wiegen",
		)
		expect(factsOf("earth").weight).toBeUndefined()
	})

	it("gives every body at least its size, with no unformatted message", () => {
		for (const body of bodies) {
			for (const i18n of [en, de, enSimple]) {
				const facts = headlineFacts(body, i18n)
				expect(facts[0]?.key).toBe("size")
				for (const fact of facts) {
					expect(fact.comparison).not.toMatch(
						/[{}]|NaN|undefined|solarSystem\./,
					)
					expect(fact.value ?? "").not.toMatch(/[{}]|NaN|undefined/)
				}
			}
		}
	})
})

describe("the spin fact", () => {
	it("keeps the rotation period, its direction and the tidal lock", () => {
		expect(factsOf("jupiter").spin.comparison).toMatch(/hours$/)
		expect(factsOf("venus").spin.comparison).toMatch(/days, retrograde$/)
		expect(factsOf("moon").spin.value).toBe("always the same face toward Earth")
	})
})

describe("surfaceGravity", () => {
	it("is Earth's 9.8 m/s² from the model", () => {
		expect(surfaceGravity(getBody("earth"))).toBeCloseTo(9.8, 1)
		expect(surfaceGravity({ massKg: null, radiusKm: 1 })).toBeNull()
	})
})

describe("dictionaryEntry", () => {
	it("matches the dictionary's own entry order", () => {
		solarDictionary.forEach((item, i) => {
			expect(dictionaryEntry(dictionaryBodyId(item))).toBe(i)
		})
		expect(dictionaryEntry("io")).toBeNull()
	})

	it("opens the world a moon circles, and the Sun for anything else", () => {
		expect(nearestDictionaryEntry("mars")).toBe(4)
		expect(nearestDictionaryEntry("io")).toBe(5)
		expect(nearestDictionaryEntry("ceres")).toBe(0)
		expect(nearestDictionaryEntry("voyager1")).toBe(0)
		expect(nearestDictionaryEntry(null)).toBe(0)
	})
})
