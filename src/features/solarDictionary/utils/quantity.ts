/**
 * Every level-dependent quantity the dictionary shows goes through
 * `levelQuantity` (#51's rule, #53): words and Earth-sized comparisons at the
 * simple level, °C at the standard level, kelvin only at the advanced level.
 * One place, so the dictionary can switch to the app-wide level-aware
 * formatters when they exist without touching the components.
 */
import type { I18n } from "@/i18n"
import { celsiusOf, kelvinOf, type Degrees } from "@/data/worlds"

export type DictionaryQuantity =
	/** A temperature as its source gives it. */
	| { kind: "temperature"; degrees: Degrees }
	/** A mass; `star` for the Sun, which outweighs every planet together. */
	| { kind: "mass"; kg: number; earthKg: number; star?: boolean }
	/** Mean density in g/cm³ (water is 1). */
	| { kind: "density"; gramsPerCm3: number }
	/** A length in km (a layer's thickness); not shown at the simple level. */
	| { kind: "length"; km: number }

/** Words for a temperature, warmest first, by their lower bound in °C. */
const FEEL_BANDS: readonly [band: string, fromC: number][] = [
	["hotterThanSun", 6000],
	["fire", 1000],
	["oven", 250],
	["boiling", 100],
	["desert", 40],
	["warm", 25],
	["mild", 5],
	["chilly", -20],
	["freezer", -90],
	["coldest", -210],
]

/** The words for `celsius` at the simple level ("oven": hotter than an oven). */
export const feelBand = (celsius: number): string =>
	FEEL_BANDS.find(([, from]) => celsius >= from)?.[0] ?? "airFreezes"

/** `value` to `digits` significant digits, as a number: 2,074 -> 2,100. */
const roundSignificant = (value: number, digits: number): number => {
	if (value === 0) return 0
	const step = 10 ** (Math.floor(Math.log10(Math.abs(value))) - digits + 1)
	return Math.round(value / step) * step
}

/**
 * A converted temperature: to the whole degree, but for the huge ones to the
 * step their source was stated in (15 million °C is 15 million K, not
 * 15,000,273 K).
 */
function converted(value: number, stated: number): number {
	if (Math.abs(stated) < 10_000) return Math.round(value)
	const whole = String(Math.abs(Math.round(stated)))
	const step = 10 ** (whole.length - whole.replace(/0+$/, "").length)
	return Math.round(value / step) * step
}

/** Up to a million with grouping ("5,499"), beyond it in words ("15 million"). */
function count(value: number, i18n: I18n): string {
	if (Math.abs(value) < 1e6) return i18n.number(value)
	return new Intl.NumberFormat(i18n.formatLocale, {
		notation: "compact",
		compactDisplay: "long",
		maximumSignificantDigits: 2,
	}).format(value)
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹"

/** "1.9 × 10²⁷" in the locale's decimal style. */
export function scientific(value: number, i18n: I18n): string {
	const exponent = Math.floor(Math.log10(Math.abs(value)))
	const power = String(Math.abs(exponent)).replace(
		/\d/g,
		(digit) => SUPERSCRIPT[Number(digit)]!,
	)
	return `${i18n.significant(value / 10 ** exponent, 3)} × 10${exponent < 0 ? "⁻" : ""}${power}`
}

function temperature(degrees: Degrees, i18n: I18n): string {
	const celsius = celsiusOf(degrees)
	if (i18n.readingLevel === "simple") {
		return i18n.t("dictionary.quantity.feel", { band: feelBand(celsius) })
	}
	const c = "c" in degrees ? degrees.c : converted(celsius, degrees.k)
	// "15 millones de °C": Spanish and French join a number in words to its unit
	const big = Math.abs(c) >= 1e6 ? "yes" : "no"
	if (i18n.readingLevel !== "advanced") {
		return i18n.t("dictionary.quantity.celsius", { value: count(c, i18n), big })
	}
	const k = "k" in degrees ? degrees.k : converted(kelvinOf(degrees), degrees.c)
	return i18n.t("dictionary.quantity.kelvin", {
		kelvin: count(k, i18n),
		celsius: count(c, i18n),
		big,
	})
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
		kg: scientific(kg, i18n),
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
			return temperature(quantity.degrees, i18n)
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
