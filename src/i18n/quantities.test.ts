import { describe, expect, it } from "vitest"

import { createI18n } from "./core"
import {
	EARTH_DIAMETER_KM,
	EARTH_MOON_KM,
	EARTH_SUN_KM,
	capitalized,
	childNumber,
	countArgs,
	dayVsEarth,
	distanceInWords,
	durationInWords,
	everydaySize,
	everydayThing,
	formatCount,
	formatDistance,
	formatSize,
	formatSpeed,
	formatTemperature,
	formatTemperatureRange,
	formatWeight,
	massVsEarth,
	nearestThing,
	sizeVsEarth,
	sizeWord,
	temperatureWord,
	weightVsEarth,
	yearVsEarth,
} from "./quantities"

const simple = createI18n({ locale: "en", readingLevel: "simple" })
const standard = createI18n({ locale: "en" })
const advanced = createI18n({ locale: "en", readingLevel: "advanced" })
const deSimple = createI18n({ locale: "de", readingLevel: "simple" })
const csSimple = createI18n({ locale: "cs", readingLevel: "simple" })

const DAY = 86_400
const YEAR = 365.25 * DAY

describe("counts a child can picture", () => {
	it("rounds to halves below 10, whole numbers to 100, and stops there", () => {
		expect(childNumber(1.88)).toBe(2)
		expect(childNumber(2.53)).toBe(2.5)
		expect(childNumber(0.1)).toBe(0.5)
		expect(childNumber(0)).toBe(0)
		expect(childNumber(11.2)).toBe(11)
		expect(childNumber(100.4)).toBe(100)
		expect(childNumber(109)).toBeNull()
		expect(childNumber(Number.NaN)).toBeNull()
	})

	it("says 'more than 100' at the simple level, the number above it", () => {
		expect(countArgs(1321, simple)).toEqual({ count: 101, n: "more than 100" })
		expect(countArgs(11.2, simple)).toEqual({ count: 11, n: "11" })
		expect(countArgs(1321, standard)).toEqual({ count: 1321, n: "1,321" })
		expect(formatCount(1321, deSimple)).toBe("mehr als 100")
		expect(formatCount(1321, csSimple)).toBe("víc než 100")
	})
})

describe("temperatures", () => {
	it("are words at simple, °C at standard and kelvin with °C at advanced", () => {
		expect(formatTemperature(210, simple)).toBe("colder than any freezer")
		expect(formatTemperature(210, standard)).toBe("-63 °C")
		expect(formatTemperature(210, advanced)).toBe("210 K (-63 °C)")
		expect(formatTemperature({ c: 430 }, advanced)).toBe("703 K (430 °C)")
		expect(formatTemperature(210, createI18n({ locale: "de" }))).toBe("-63 °C")
	})

	it("keep a huge figure as round as its source stated it", () => {
		const core = { c: 15_000_000 }
		expect(formatTemperature(core, standard)).toBe("15 million °C")
		expect(formatTemperature(core, advanced)).toBe(
			"15 million K (15 million °C)",
		)
		expect(formatTemperature(core, createI18n({ locale: "es" }))).toBe(
			"15 millones de °C",
		)
	})

	it("from the Sun's core down to Pluto, one word ladder for the app", () => {
		expect(temperatureWord({ c: 15_000_000 })).toBe("hotterThanSun")
		expect(temperatureWord(5778)).toBe("fire") // the Sun's surface
		expect(temperatureWord(737)).toBe("oven") // Venus
		expect(temperatureWord(440)).toBe("boiling") // Mercury
		expect(temperatureWord({ c: 56.7 })).toBe("desert")
		expect(temperatureWord(288)).toBe("mild") // Earth
		expect(temperatureWord({ c: -10 })).toBe("chilly")
		expect(temperatureWord(210)).toBe("freezer") // Mars
		expect(temperatureWord(165)).toBe("colderThanEarth") // Jupiter
		expect(temperatureWord(55)).toBe("airFreezes") // Neptune
		expect(formatTemperature(5778, simple)).toBe("far hotter than any fire")
		expect(formatTemperature(288, deSimple)).toBe(
			"nicht zu heiß und nicht zu kalt",
		)
	})

	it("as a range, coldest first, one phrase when both ends share it", () => {
		expect(formatTemperatureRange(700, 100, standard)).toBe(
			"from -173 °C to 427 °C",
		)
		expect(formatTemperatureRange(100, 700, simple)).toBe(
			"from colder than anywhere on Earth to hotter than an oven",
		)
		expect(formatTemperatureRange(150, 160, simple)).toBe(
			"colder than anywhere on Earth",
		)
	})

	it("stand on their own with a capital", () => {
		expect(capitalized(formatTemperature(210, simple), simple)).toBe(
			"Colder than any freezer",
		)
	})
})

describe("sizes", () => {
	it("in one word against Earth", () => {
		expect(sizeWord(1_391_016)).toBe("gigantic")
		expect(sizeWord(139_822)).toBe("huge")
		expect(sizeWord(12_104)).toBe("big")
		expect(sizeWord(6779)).toBe("small")
		expect(sizeWord(2377)).toBe("tiny")
		expect(formatSize(139_822, simple)).toBe("huge")
		expect(formatSize(139_822, standard)).toBe("139,822 km")
	})

	it("with Earth as the yardstick", () => {
		expect(sizeVsEarth(139_822, simple)).toBe("11 Earths wide")
		expect(sizeVsEarth(1_391_016, simple)).toBe("more than 100 Earths wide")
		expect(sizeVsEarth(1_391_016, standard)).toBe("109 Earths wide")
		expect(sizeVsEarth(12_104, simple)).toBe("about as wide as Earth")
		expect(sizeVsEarth(3474, simple)).toBe(
			"so small that 3.5 of them would fit across Earth",
		)
		expect(sizeVsEarth(139_822, deSimple)).toBe("so breit wie 11 Erden")
	})

	it("with the walk's everyday things, Earth as an orange", () => {
		expect(nearestThing(0.008)).toBe("pea")
		expect(nearestThing(9)).toBe("house")
		expect(everydayThing(1_391_016)).toEqual({ thing: "house", fit: "about" })
		expect(everydayThing(139_822)).toEqual({
			thing: "exerciseBall",
			fit: "about",
		})
		expect(everydayThing(3474)).toEqual({ thing: "cherry", fit: "about" })
		expect(everydayThing(12)).toEqual({ thing: "fineSand", fit: "smaller" })
		const sun = { id: "sun", name: "Sun", diameterKm: 1_391_016 }
		expect(everydaySize(sun, simple)).toBe(
			"If Earth were as small as an orange, the Sun would be as big as a house",
		)
		expect(everydaySize({ ...sun, name: "Sonne" }, deSimple)).toBe(
			"Wäre die Erde so klein wie eine Orange, wäre die Sonne so groß wie ein Haus",
		)
		expect(
			everydaySize({ id: "earth", name: "Earth", diameterKm: 12_742 }, simple),
		).toBeNull()
	})
})

describe("distances", () => {
	it("in words, from Earths in a row out to the Sun's distance", () => {
		expect(distanceInWords(22, simple)).toBe("22 km")
		expect(distanceInWords(6900, simple)).toBe(
			"less than the width of one Earth",
		)
		expect(distanceInWords(EARTH_MOON_KM, simple)).toBe(
			"as far as 30 Earths in a row",
		)
		expect(distanceInWords(EARTH_DIAMETER_KM, simple)).toBe(
			"as far as one Earth is wide",
		)
		expect(distanceInWords(10 * EARTH_MOON_KM, simple)).toBe(
			"10 times as far as the Moon is from Earth",
		)
		expect(distanceInWords(0.39 * EARTH_SUN_KM, simple)).toBe(
			"about a third as far as Earth is from the Sun",
		)
		expect(distanceInWords(EARTH_SUN_KM, simple)).toBe(
			"about as far as Earth is from the Sun",
		)
		expect(distanceInWords(5.2 * EARTH_SUN_KM, simple)).toBe(
			"5 times as far as Earth is from the Sun",
		)
		expect(distanceInWords(165 * EARTH_SUN_KM, simple)).toBe(
			"more than 100 times as far as Earth is from the Sun",
		)
		expect(distanceInWords(5.2 * EARTH_SUN_KM, deSimple)).toBe(
			"5-mal so weit wie die Erde von der Sonne",
		)
	})

	it("in kilometres above the simple level", () => {
		expect(formatDistance(384_400, standard)).toBe("384,000 km")
		expect(formatDistance(6.28e8, standard)).toBe("628 million km")
		expect(formatDistance(6.28e8, simple)).toBe(
			"4 times as far as Earth is from the Sun",
		)
	})
})

describe("durations", () => {
	it("in the units a child counts, then in long lives, then in words", () => {
		expect(durationInWords(0.5, simple)).toBe("less than a second")
		expect(durationInWords(1.28, simple)).toBe("1.5 seconds")
		expect(durationInWords(499, simple)).toBe("8.5 minutes")
		expect(durationInWords(4.2 * 3600, simple)).toBe("4 hours")
		expect(durationInWords(117 * DAY, simple)).toBe("4 months")
		expect(durationInWords(165 * YEAR, simple)).toBe("2 long human lives")
		expect(durationInWords(5000 * YEAR, simple)).toBe("63 long human lives")
		expect(durationInWords(26_000 * YEAR, simple)).toBe(
			"longer than since the pyramids were built",
		)
		expect(durationInWords(2.5e6 * YEAR, simple)).toBe(
			"longer than there have been people",
		)
		expect(durationInWords(1e8 * YEAR, simple)).toBe(
			"longer than since the dinosaurs died out",
		)
		expect(durationInWords(165 * YEAR, deSimple)).toBe("2 lange Menschenleben")
	})

	it("against the day and the year at home", () => {
		expect(dayVsEarth(10, simple)).toBe(
			"A day there lasts as long as 10 days at home",
		)
		expect(dayVsEarth(117, simple)).toBe(
			"A day there lasts as long as more than 100 days at home",
		)
		expect(dayVsEarth(117, standard)).toBe(
			"A day there lasts as long as 117 days at home",
		)
		expect(dayVsEarth(1.03, simple)).toBe(
			"A day there lasts about as long as at home",
		)
		expect(dayVsEarth(0.41, simple)).toBe("A day there is over in 10 hours")
		expect(yearVsEarth(4331, simple)).toBe(
			"A year there lasts as long as 12 years at home",
		)
		expect(yearVsEarth(88, simple)).toBe(
			"In one year at home, 4 years go by there",
		)
		expect(yearVsEarth(365, simple)).toBe(
			"A year there lasts about as long as at home",
		)
	})
})

describe("weight, mass and speed", () => {
	it("against your weight and Earth's mass", () => {
		expect(weightVsEarth(2, simple)).toBe(
			"You would weigh twice as much as at home",
		)
		expect(weightVsEarth(2.53, simple)).toBe(
			"You would weigh 2.5 times as much as at home",
		)
		expect(weightVsEarth(0.165, simple)).toBe(
			"You would be 6 times lighter than at home",
		)
		// 1.14 is "1 time" for a child: about the same
		expect(weightVsEarth(1.14, simple)).toBe(
			"You would weigh about as much as at home",
		)
		expect(weightVsEarth(1.14, standard)).toBe(
			"You would weigh 1.1 times as much as at home",
		)
		expect(massVsEarth(1.898e27, simple)).toBe(
			"weighs as much as more than 100 Earths",
		)
		expect(massVsEarth(1.898e27, standard)).toBe("weighs as much as 318 Earths")
		expect(massVsEarth(7.35e22, simple)).toBe(
			"it would take 81 of them to weigh as much as Earth",
		)
	})

	it("a weight and a speed", () => {
		expect(formatWeight(76, simple)).toBe("76 kg")
		expect(formatWeight(840, simple)).toBe("more than 100 kg")
		expect(formatWeight(75.9, standard)).toBe("75.9 kg")
		expect(formatSpeed(17, simple)).toBe("17 km every second")
		expect(formatSpeed(190, simple)).toBe("more than 100 km every second")
		expect(formatSpeed(17, standard)).toBe("17 km/s")
	})
})
