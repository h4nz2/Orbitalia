import type { SolarDictionaryItem } from "@/data/solarDictionary"
import {
	countArgs,
	dayVsEarth,
	durationInWords,
	capitalized,
	formatSize,
	formatWeight,
	isSimple,
	sizeVsEarth,
	weightVsEarth,
	yearVsEarth,
	type I18n,
} from "@/i18n"

import { levelQuantity } from "./quantity"

/** The facts the sidebar can show, in display order. */
export type FactKey =
	"name" | "diameter" | "lengthOfDay" | "orbitalPeriod" | "gravity" | "avgTemp"

export interface SidebarFact {
	key: FactKey
	/** Translated label ("Diameter" / "Durchmesser"). */
	label: string
	/** The value with its unit, formatted for the active locale. */
	value: string
	/** A comparison with Earth at the active reading level, if there is one. */
	extra: string | null
}

/** Reference weight for the "if you weigh 30 kg on Earth" sentences. */
const REFERENCE_KG = 30

const round1 = (value: number): number => Math.round(value * 10) / 10

const numeric = (value: unknown): number | null => {
	const number = typeof value === "string" ? Number(value) : value
	return typeof number === "number" && Number.isFinite(number) ? number : null
}

/** Volumes in km³ (from the body model); they include the giants' flattening. */
export interface Volumes {
	body: number | null
	earth: number | null
}

function sizeComparison(
	value: number,
	earth: number,
	i18n: I18n,
	volumes?: Volumes,
): string {
	// the diameters are equatorial, so their cube overstates oblate planets
	// (Jupiter 1408 instead of 1321 Earths); the real volumes win when known
	const earths = round1(
		volumes?.body && volumes.earth
			? volumes.body / volumes.earth
			: (value / earth) ** 3,
	)
	if (earths > 1.5) {
		return i18n.t(
			"dictionary.compare.sizeBigger",
			countArgs(Math.round(earths), i18n),
		)
	}
	if (earths < 0.6) {
		return i18n.t(
			"dictionary.compare.sizeSmaller",
			countArgs(Math.round(1 / earths), i18n),
		)
	}
	return i18n.t("dictionary.compare.sizeSimilar")
}

function dayComparison(hours: number, earth: number, i18n: I18n): string {
	const ratio = hours / earth
	// the simple level: the day at home is the yardstick (#51)
	if (isSimple(i18n)) return dayVsEarth(ratio, i18n)
	if (ratio >= 1.5) {
		return i18n.t("dictionary.compare.dayLonger", { days: Math.round(ratio) })
	}
	if (ratio < 0.75) {
		return i18n.t("dictionary.compare.dayShorter", {
			hours: round1(hours),
			fraction: ratio,
		})
	}
	return i18n.t("dictionary.compare.daySimilar", {
		minutes: Math.round(Math.abs(hours - earth) * 60),
	})
}

function yearComparison(days: number, earth: number, i18n: I18n): string {
	const ratio = days / earth
	if (isSimple(i18n)) return yearVsEarth(days, i18n)
	if (ratio >= 2) {
		return i18n.t("dictionary.compare.yearLonger", {
			years: Math.round(ratio),
		})
	}
	if (ratio > 1) {
		return i18n.t("dictionary.compare.yearLongerDays", {
			days: Math.round(days - earth),
		})
	}
	return i18n.t("dictionary.compare.yearShorter", {
		times: round1(earth / days),
		period: i18n.quantity(days, "day", "long"),
	})
}

function gravityComparison(value: number, earth: number, i18n: I18n): string {
	const ratio = value / earth
	const kg = Math.round(REFERENCE_KG * ratio)
	const weight = formatWeight(REFERENCE_KG * ratio, i18n)
	if (ratio >= 1.05) {
		return i18n.t("dictionary.compare.gravityMore", {
			ratio: round1(ratio),
			kg,
			weight,
		})
	}
	if (ratio <= 0.95) {
		return i18n.t("dictionary.compare.gravityLess", {
			percent: ratio,
			kg,
			weight,
		})
	}
	return i18n.t("dictionary.compare.gravitySimilar", { kg, weight })
}

/**
 * The sidebar facts of a dictionary entry, translated, formatted for the
 * active locale and compared with `earth` (no comparisons for Earth itself).
 * The temperature follows the reading level (`levelQuantity`: words, °C, or
 * kelvin with °C). Facts without a value are left out. `volumes` makes the
 * size comparison exact for flattened planets.
 */
export function getSidebarFacts(
	entity: SolarDictionaryItem | undefined,
	keys: readonly FactKey[],
	earth: SolarDictionaryItem | undefined,
	i18n: I18n,
	name: string,
	volumes?: Volumes,
): SidebarFact[] {
	if (entity === undefined) return []
	const compare = earth !== undefined && entity.id !== earth.id
	const earthValue = (key: FactKey): number | null =>
		compare ? numeric(earth[key as keyof SolarDictionaryItem]) : null

	const fact = (key: FactKey): SidebarFact | null => {
		const label = i18n.t(`dictionary.fact.${key}`)
		if (key === "name") return { key, label, value: name, extra: null }
		const value = numeric(entity[key])
		if (value === null) return null
		const reference = earthValue(key)
		switch (key) {
			case "diameter":
				return {
					key,
					label,
					// the simple level: Earth is the yardstick, not the kilometres (#51)
					value: !isSimple(i18n)
						? i18n.quantity(value, "kilometer")
						: reference === null
							? formatSize(value, i18n)
							: sizeVsEarth(value, i18n),
					extra:
						reference === null
							? null
							: sizeComparison(value, reference, i18n, volumes),
				}
			case "lengthOfDay":
				return {
					key,
					label,
					value: isSimple(i18n)
						? durationInWords(value * 3600, i18n)
						: i18n.quantity(value, "hour", "long"),
					extra:
						reference === null ? null : dayComparison(value, reference, i18n),
				}
			case "orbitalPeriod":
				return {
					key,
					label,
					value: isSimple(i18n)
						? durationInWords(value * 86_400, i18n)
						: i18n.quantity(value, "day", "long"),
					extra:
						reference === null ? null : yearComparison(value, reference, i18n),
				}
			case "gravity":
				return {
					key,
					label,
					value: isSimple(i18n)
						? weightVsEarth(value / (reference ?? value), i18n)
						: i18n.t("units.gravity", { value: i18n.number(value) }),
					extra:
						reference === null
							? null
							: gravityComparison(value, reference, i18n),
				}
			case "avgTemp":
				return {
					key,
					label,
					value:
						levelQuantity(
							{ kind: "temperature", degrees: { k: value } },
							i18n,
						) ?? "",
					extra: null,
				}
		}
	}

	return keys
		.map(fact)
		.filter((entry): entry is SidebarFact => entry !== null)
		.map((entry) => ({ ...entry, value: capitalized(entry.value, i18n) }))
}
