import { describe, expect, it } from "vitest"

import {
	createI18n,
	formatScientific,
	temperatureWord,
	type ReadingLevel,
} from "@/i18n"

import { levelQuantity } from "./quantity"

const at = (readingLevel: ReadingLevel, locale = "en") =>
	createI18n({ locale, readingLevel })

const EARTH_KG = 5.97237e24

describe("levelQuantity: temperatures (#51's rule)", () => {
	it("gives words at simple, °C at standard and kelvin at advanced", () => {
		const day = { kind: "temperature", degrees: { c: 430 } } as const
		expect(levelQuantity(day, at("simple"))).toBe("Hotter than an oven")
		expect(levelQuantity(day, at("standard"))).toBe("430 °C")
		expect(levelQuantity(day, at("advanced"))).toBe("703 K (430 °C)")
	})

	it("converts what the source gave in kelvin, to the whole degree", () => {
		const mars = { kind: "temperature", degrees: { k: 210 } } as const
		expect(levelQuantity(mars, at("standard"))).toBe("-63 °C")
		expect(levelQuantity(mars, at("advanced"))).toBe("210 K (-63 °C)")
		expect(levelQuantity(mars, at("standard", "de"))).toBe("-63 °C")
	})

	it("says the huge ones in words and keeps their rounding", () => {
		const core = { kind: "temperature", degrees: { c: 15_000_000 } } as const
		expect(levelQuantity(core, at("standard"))).toBe("15 million °C")
		expect(levelQuantity(core, at("advanced"))).toBe(
			"15 million K (15 million °C)",
		)
		expect(levelQuantity(core, at("standard", "de"))).toBe("15 Millionen °C")
		expect(levelQuantity(core, at("simple"))).toBe(
			"Hotter than the surface of the Sun",
		)
	})

	it("has a word for every temperature in the solar system (the app's one ladder)", () => {
		expect(temperatureWord({ c: 5500 })).toBe("fire")
		expect(temperatureWord({ c: 464 })).toBe("oven")
		expect(temperatureWord({ c: 56.7 })).toBe("desert")
		expect(temperatureWord({ c: 15 })).toBe("mild")
		expect(temperatureWord({ c: -63 })).toBe("freezer")
		expect(temperatureWord({ c: -89.2 })).toBe("freezer")
		expect(temperatureWord({ c: -153 })).toBe("colderThanEarth")
		expect(temperatureWord({ c: -224 })).toBe("airFreezes")
		expect(
			levelQuantity(
				{ kind: "temperature", degrees: { c: -224 } },
				at("simple"),
			),
		).toBe("So cold that air would freeze")
	})
})

describe("levelQuantity: mass and density", () => {
	const mass = (kg: number, star = false) =>
		({ kind: "mass", kg, earthKg: EARTH_KG, star }) as const

	it("weighs worlds in Earths, never above 100 at the simple level", () => {
		const jupiter = mass(1.89819e27)
		expect(levelQuantity(jupiter, at("standard"))).toBe(
			"As heavy as 318 Earths",
		)
		expect(levelQuantity(jupiter, at("simple"))).toBe(
			"Heavier than 100 Earths put together",
		)
		expect(levelQuantity(jupiter, at("advanced"))).toBe(
			"318 Earth masses (1.9 × 10²⁷ kg)",
		)
		expect(levelQuantity(mass(1.989e30, true), at("simple"))).toBe(
			"Heavier than all the planets put together",
		)
		expect(levelQuantity(mass(1.989e30, true), at("standard"))).toBe(
			"As heavy as 333,000 Earths",
		)
	})

	it("turns small worlds round: how many of them weigh one Earth", () => {
		expect(levelQuantity(mass(3.30114e23), at("simple"))).toBe(
			"It would take 18 of them to weigh as much as Earth",
		)
		expect(levelQuantity(mass(4.86747e24), at("standard"))).toBe(
			"81% of Earth’s mass",
		)
		expect(levelQuantity(mass(4.86747e24), at("simple"))).toBe(
			"Almost as heavy as Earth",
		)
	})

	it("floats Saturn in a bathtub", () => {
		const saturn = { kind: "density", gramsPerCm3: 0.687 } as const
		expect(levelQuantity(saturn, at("simple"))).toBe(
			"Lighter than water: in a giant bathtub, it would float!",
		)
		expect(levelQuantity(saturn, at("standard"))).toMatch(
			/^0\.687 g\/cm³: lighter than water/,
		)
		expect(
			levelQuantity({ kind: "density", gramsPerCm3: 5.51 }, at("simple")),
		).toBe("A bucket full of it would weigh as much as 6 buckets of water")
	})

	it("writes powers of ten for the advanced level", () => {
		expect(formatScientific(5.97237e24, at("advanced"))).toBe("5.97 × 10²⁴")
		expect(formatScientific(5.97237e24, at("advanced", "de"))).toBe(
			"5,97 × 10²⁴",
		)
	})
})

describe("levelQuantity: lengths", () => {
	it("gives km to two digits, and nothing at the simple level", () => {
		const crust = { kind: "length", km: 2074 } as const
		expect(levelQuantity(crust, at("standard"))).toBe("2,100 km")
		expect(levelQuantity(crust, at("simple"))).toBeNull()
	})
})
