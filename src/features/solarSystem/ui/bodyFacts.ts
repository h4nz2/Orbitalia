/**
 * A body's headline facts for the focused view (#16), comparative by default:
 * "139,820 km in diameter" means nothing to a twelve-year-old, "11 Earths
 * wide" means everything. Each fact is a comparison with something the class
 * knows (Earth, our Moon, the speed of light, their own weight) with the exact
 * number beside it. Computed from the body model, so every body gets them,
 * translated through the i18n layer (`solarSystem.facts.*`).
 *
 * At the simple reading level (#51) the numbers follow `@/i18n`'s
 * quantities: no number above 100, times in words, and instead of the exact
 * number the size gets an everyday picture ("If Earth were as small as a
 * pea, Jupiter would be as big as an orange"); the other value lines go.
 */
import { bodyById, isSmallBody, type Body } from "@/data"
import {
	countArgs,
	durationInWords,
	everydaySize,
	formatCount,
	isSimple,
	roughly,
	type I18n,
} from "@/i18n"
import { bodyName } from "@/i18n/bodies"
import { kmToAu } from "@/sim"

export { roughly }

export type FactKey = "size" | "distance" | "year" | "orbit" | "spin" | "weight"

export interface HeadlineFact {
	key: FactKey
	/** "Size", "How big" */
	label: string
	/** The comparison, the headline: "11 Earths wide". */
	comparison: string
	/** The exact number: "139,820 km across". */
	value: string | null
}

/** km/s */
const SPEED_OF_LIGHT_KM_S = 299_792.458
/** m³ kg⁻¹ s⁻² */
const GRAVITATIONAL_CONSTANT = 6.674_3e-11
/** The weight the simple reading level compares with, kg. */
const REFERENCE_WEIGHT_KG = 30
/** Ratios within this band of 1 read as "about the same". */
const SIMILAR_LOW = 0.87
const SIMILAR_HIGH = 1.15

const earth = bodyById.get("earth")
const moon = bodyById.get("moon")

/** A ratio as a count: `roughly` for the exact levels, the child's rounding (and "more than 100") at `simple`. */
const counted = (ratio: number, i18n: I18n) =>
	countArgs(isSimple(i18n) ? ratio : roughly(ratio), i18n)

/**
 * Surface gravity, m/s²: the curated value where the source has one (it
 * allows for the giants' flattening and spin), else from the mass and mean
 * radius; null without either.
 */
export const surfaceGravity = (
	body: Pick<Body, "massKg" | "radiusKm"> & { info?: Body["info"] },
): number | null => {
	const curated = body.info?.gravity
	if (typeof curated === "number" && curated > 0) return curated
	return body.massKg === null || !(body.radiusKm > 0)
		? null
		: (GRAVITATIONAL_CONSTANT * body.massKg) / (body.radiusKm * 1000) ** 2
}

/** Our Moon for moons, the small bodies (#23) and Earth itself, Earth for everything else. */
const sizeReference = (body: Body): Body | undefined =>
	body.id === "earth" ||
	(body.kind === "moon" && body.id !== "moon") ||
	isSmallBody(body)
		? moon
		: earth

/** From this eccentricity on (comets, #23) the distance is a range, not one number. */
export const DISTANCE_RANGE_ECCENTRICITY = 0.5

function sizeFact(body: Body, i18n: I18n): HeadlineFact | null {
	const reference = sizeReference(body)
	if (reference === undefined) return null
	const ratio = body.radiusKm / reference.radiusKm
	const ref = reference.id
	const comparison =
		ratio >= SIMILAR_HIGH
			? i18n.t("solarSystem.facts.sizeWider", { ...counted(ratio, i18n), ref })
			: ratio > SIMILAR_LOW
				? i18n.t("solarSystem.facts.sizeSimilar", { ref })
				: i18n.t("solarSystem.facts.sizeNarrower", {
						...counted(1 / ratio, i18n),
						ref,
					})
	if (isSimple(i18n)) {
		return {
			key: "size",
			label: i18n.t("solarSystem.facts.label.size"),
			comparison,
			value: everydaySize(
				{
					id: body.id,
					name: bodyName(body.id, i18n.chain),
					diameterKm: 2 * body.radiusKm,
				},
				i18n,
			),
		}
	}
	const diameter = i18n.quantity(2 * body.radiusKm, "kilometer")
	return {
		key: "size",
		label: i18n.t("solarSystem.facts.label.size"),
		comparison,
		value: i18n.t("solarSystem.facts.across", {
			value: body.radiusEstimated
				? i18n.t("units.approx", { value: diameter })
				: diameter,
		}),
	}
}

/** "8.3 minutes", "4.2 hours": how long light takes for `km`. */
const lightTime = (km: number, i18n: I18n): string => {
	if (isSimple(i18n)) return durationInWords(km / SPEED_OF_LIGHT_KM_S, i18n)
	const minutes = km / SPEED_OF_LIGHT_KM_S / 60
	return minutes < 90
		? i18n.quantity(roughly(minutes), "minute", "long")
		: i18n.quantity(roughly(minutes / 60), "hour", "long")
}

function distanceFact(body: Body, i18n: I18n): HeadlineFact | null {
	const parent =
		body.parentId === null ? undefined : bodyById.get(body.parentId)
	if (body.orbit === null || parent === undefined) return null
	const km = body.orbit.semiMajorAxisKm
	const label = i18n.t("solarSystem.facts.label.distance")
	if (
		parent.parentId === null &&
		body.orbit.eccentricity >= DISTANCE_RANGE_ECCENTRICITY
	) {
		// a comet on a long orbit: from its nearest to its farthest point
		const near = km * (1 - body.orbit.eccentricity)
		const far = km * (1 + body.orbit.eccentricity)
		const au = (x: number) =>
			i18n.t("units.au", { value: i18n.significant(kmToAu(x), 2) })
		return {
			key: "distance",
			label,
			comparison: i18n.t("solarSystem.facts.sunlightRange", {
				near: lightTime(near, i18n),
				far: lightTime(far, i18n),
			}),
			value: isSimple(i18n) ? null : `${au(near)} – ${au(far)}`,
		}
	}
	if (parent.parentId === null) {
		// a planet: how long sunlight takes to get there
		return {
			key: "distance",
			label,
			comparison: i18n.t("solarSystem.facts.sunlight", {
				time: lightTime(km, i18n),
			}),
			value: isSimple(i18n)
				? null
				: `${i18n.t("units.au", { value: i18n.significant(kmToAu(km), 3) })} · ${i18n.t(
						"units.millionKm",
						{ value: i18n.significant(km / 1e6, 3) },
					)}`,
		}
	}
	// a moon: how many of its planet would fit into the gap
	const names = {
		parentId: parent.id,
		parent: bodyName(parent.id, i18n.chain),
	}
	return {
		key: "distance",
		label,
		comparison: i18n.t("solarSystem.facts.gap", {
			...names,
			...counted(km / (2 * parent.radiusKm), i18n),
		}),
		value: isSimple(i18n)
			? null
			: i18n.t("solarSystem.facts.fromParent", {
					...names,
					distance: i18n.quantity(km, "kilometer"),
				}),
	}
}

const duration = (days: number, i18n: I18n): string =>
	isSimple(i18n)
		? durationInWords(days * 86_400, i18n)
		: days < 1
			? i18n.quantity(days * 24, "hour", "long")
			: i18n.quantity(days, "day", "long")

function yearFact(body: Body, i18n: I18n): HeadlineFact | null {
	const parent =
		body.parentId === null ? undefined : bodyById.get(body.parentId)
	if (body.orbit === null || parent === undefined) return null
	const days = body.orbit.periodDays
	if (parent.parentId !== null) {
		// a moon: once round its planet
		return {
			key: "orbit",
			label: i18n.t("solarSystem.facts.label.orbit"),
			comparison: i18n.t("solarSystem.facts.lap", {
				parentId: parent.id,
				parent: bodyName(parent.id, i18n.chain),
				period: duration(days, i18n),
			}),
			value: null,
		}
	}
	const earthYear = earth?.orbit?.periodDays ?? 365.256
	const years = days / earthYear
	const comparison =
		body.id === "earth"
			? i18n.t("solarSystem.facts.yearEarth")
			: years >= 1.5
				? i18n.t("solarSystem.facts.yearLonger", counted(years, i18n))
				: i18n.t("solarSystem.facts.yearShorter", counted(1 / years, i18n))
	return {
		key: "year",
		label: i18n.t("solarSystem.facts.label.year"),
		comparison,
		value: isSimple(i18n) ? null : i18n.quantity(days, "day", "long"),
	}
}

/** Periods from this long on read better in days (Venus: 243 days, not 5,832 hours). */
const ROTATION_DAYS_FROM_HOURS = 72

/** The rotation period with its direction, and for a tidally locked moon a note saying so (#13). */
function spinFact(body: Body, i18n: I18n): HeadlineFact {
	const { periodHours, synchronous } = body.rotation
	const label = i18n.t("solarSystem.info.rotation")
	if (periodHours === null) {
		return {
			key: "spin",
			label,
			comparison: i18n.t("solarSystem.info.rotationUnknown"),
			value: null,
		}
	}
	const hours = Math.abs(periodHours)
	const period = isSimple(i18n)
		? durationInWords(hours * 3600, i18n)
		: hours >= ROTATION_DAYS_FROM_HOURS
			? i18n.quantity(hours / 24, "day", "long")
			: i18n.quantity(hours, "hour", "long")
	return {
		key: "spin",
		label,
		comparison:
			periodHours < 0
				? i18n.t("solarSystem.info.retrograde", { period })
				: period,
		value:
			synchronous === true && body.parentId !== null
				? i18n.t("solarSystem.info.synchronous", {
						parentId: body.parentId,
						parent: bodyName(body.parentId, i18n.chain),
					})
				: null,
	}
}

function weightFact(body: Body, i18n: I18n): HeadlineFact | null {
	const gravity = surfaceGravity(body)
	const earthGravity = earth === undefined ? null : surfaceGravity(earth)
	if (gravity === null || earthGravity === null || body.id === "earth") {
		return null
	}
	const ratio = gravity / earthGravity
	const kg = isSimple(i18n)
		? formatCount(REFERENCE_WEIGHT_KG * ratio, i18n)
		: i18n.significant(REFERENCE_WEIGHT_KG * ratio, 2)
	const comparison =
		ratio >= 1.05
			? i18n.t("solarSystem.facts.weightMore", { count: roughly(ratio), kg })
			: ratio > 0.95
				? i18n.t("solarSystem.facts.weightSimilar", { kg })
				: i18n.t("solarSystem.facts.weightLess", {
						percent: i18n.significant(ratio * 100, 2),
						kg,
					})
	return {
		key: "weight",
		label: i18n.t("solarSystem.facts.label.weight"),
		comparison,
		value: isSimple(i18n)
			? null
			: i18n.t("units.gravity", { value: i18n.significant(gravity, 3) }),
	}
}

/** Size, distance, year (or orbit), spin and weight, the ones that apply to `body`. */
export function headlineFacts(body: Body, i18n: I18n): HeadlineFact[] {
	return [
		sizeFact(body, i18n),
		distanceFact(body, i18n),
		yearFact(body, i18n),
		spinFact(body, i18n),
		weightFact(body, i18n),
	].filter((fact): fact is HeadlineFact => fact !== null)
}
