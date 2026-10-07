/**
 * Every level-dependent quantity the dictionary shows goes through
 * `levelQuantity` (#53): words and Earth-sized comparisons at the simple
 * level, °C at the standard level, kelvin only at the advanced level.
 * Temperatures and scientific notation are the app's own (`@/i18n`
 * quantities, #51: one rule and one word ladder everywhere); what is left
 * here is the dictionary's: a mass against Earth with the Sun and Earth
 * themselves as special cases, a density against water, a layer's thickness.
 */
import {
	capitalized,
	formatScientific,
	formatTemperature,
	type I18n,
} from "@/i18n"
import type { Degrees } from "@/data/worlds"

export type DictionaryQuantity =
	/** A temperature as its source gives it. */
	| { kind: "temperature"; degrees: Degrees }
	/** A mass; `star` for the Sun, which outweighs every planet together. */
	| { kind: "mass"; kg: number; earthKg: number; star?: boolean }
	/** Mean density in g/cm³ (water is 1). */
	| { kind: "density"; gramsPerCm3: number }
	/** A length in km (a layer's thickness); not shown at the simple level. */
	| { kind: "length"; km: number }

/** `value` to `digits` significant digits, as a number: 2,074 -> 2,100. */
const roundSignificant = (value: number, digits: number): number => {
	if (value === 0) return 0
	const step = 10 ** (Math.floor(Math.log10(Math.abs(value))) - digits + 1)
	return Math.round(value / step) * step
}

function mass(
	{ kg, earthKg, star }: Extract<DictionaryQuantity, { kind: "mass" }>,
	i18n: I18n,
): string {
	const earths = kg / earthKg
	const band = star
		? "star"
		: Math.abs(earths - 1) < 1e-6
			? "earth"
			: earths > 100
				? "huge"
				: earths >= 1.5
					? "heavier"
					: earths >= 0.6
						? "similar"
						: "lighter"
	return i18n.t("dictionary.quantity.mass", {
		band,
		// the Sun's 333,000 Earths, not 333,034
		count:
			band === "lighter"
				? Math.round(1 / earths)
				: earths >= 1000
					? roundSignificant(earths, 3)
					: Math.round(earths),
		percent: earths,
		earths: i18n.significant(earths, 3),
		kg: formatScientific(kg, i18n),
	})
}

function density(gramsPerCm3: number, i18n: I18n): string {
	return i18n.t("dictionary.quantity.density", {
		band: gramsPerCm3 < 1 ? "floats" : gramsPerCm3 < 2 ? "sinks" : "rock",
		value: i18n.significant(gramsPerCm3, 3),
		ratio: Math.round(gramsPerCm3 * 10) / 10,
		buckets: Math.round(gramsPerCm3),
	})
}

/**
 * A quantity in the words of the active reading level, or null where that
 * level does not show it (lengths at the simple level).
 */
export function levelQuantity(
	quantity: DictionaryQuantity,
	i18n: I18n,
): string | null {
	switch (quantity.kind) {
		case "temperature":
			// a value of its own in the dictionary: "Colder than any freezer"
			return capitalized(formatTemperature(quantity.degrees, i18n), i18n)
		case "mass":
			return mass(quantity, i18n)
		case "density":
			return density(quantity.gramsPerCm3, i18n)
		case "length":
			return i18n.readingLevel === "simple"
				? null
				: i18n.quantity(roundSignificant(quantity.km, 2), "kilometer")
	}
}
