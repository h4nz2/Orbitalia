/**
 * Plain-language comparisons of two bodies (#24), generated from the body
 * model rather than written per pair, so every pair gets them: the Sun and a
 * moon of Neptune as much as Earth and Jupiter. "Jupiter is 11 times as wide
 * as Earth", "About 1,321 Earths would fit inside Jupiter", "On Jupiter you
 * would weigh 2.5 times as much as on Earth", "One year on Neptune lasts as
 * long as 165 years on Earth", "On Mercury a day lasts longer than a year".
 * Each fact has the exact numbers beside it. Every sentence is an ICU message
 * (`compare.facts.*`) with simple and advanced variants, in every locale.
 *
 * Pure: the i18n object and the moment for the distance come in as
 * arguments. The physics reuses #26's helpers (surface gravity, solar day)
 * and #16's rounding, so the card, the birthday panel and this page never
 * disagree about a number.
 */
import { bodyById, type Body } from "@/data"
import {
	MISSING_VALUE,
	countArgs,
	distanceInWords,
	durationInWords,
	formatCount,
	formatScientific,
	formatSize,
	isSimple,
	massVsEarth,
	type I18n,
	type MessageKey,
} from "@/i18n"
import { bodyName } from "@/i18n/bodies"
import { computePositions, jdToDate, kmToAu } from "@/sim"

import {
	formatBigNumber,
	hasNoSurface,
	solarDayDays,
	surfaceGravity,
} from "../solarSystem/birthday/birthday"
import { roughly } from "../solarSystem/ui/bodyFacts"

export type PairFactKey =
	| "size"
	| "volume"
	| "mass"
	| "weight"
	| "year"
	| "orbit"
	| "day"
	| "dayYear"
	| "distance"

export interface FactValue {
	/** The body the number belongs to (its name), or none for a number about the pair. */
	name: string | null
	text: string
}

export interface PairFact {
	key: PairFactKey
	/** Unique within one pair (`dayYear` can occur for both bodies). */
	id: string
	/** "Size", "How big" */
	label: string
	/** The comparison, the headline: "Jupiter is 11 times as wide as Earth." */
	comparison: string
	/** The exact numbers behind it. */
	values: FactValue[]
	/** Small print: "Jupiter has no solid ground: …", how the distance changes. */
	notes: string[]
}

/** km/s */
export const SPEED_OF_LIGHT_KM_S = 299_792.458
/** The weight the simple reading level talks about, kg on Earth (as the focused card, #16). */
export const REFERENCE_WEIGHT_KG = 30
/** The car of the simple reading level, km/h. */
export const CAR_SPEED_KMH = 100
/** Ratios below this read as "about the same". */
export const SIMILAR_RATIO = 1.1
/** Volumes are compared from this ratio on ("2 Moons would fit inside" at the least). */
const VOLUME_FROM_RATIO = 2
/** Weights within 5 % read as "about the same" (as on the card). */
const WEIGHT_SIMILAR = 1.05
const DAYS_PER_YEAR = 365.25

const earth = bodyById.get("earth")

/** Three significant digits: 88 days, 176 days, 11.9 years, 24.7 hours. */
const sig3 = (value: number): number => Number(value.toPrecision(3))

/**
 * A ratio for a sentence: "1.9", "11", "1,321" (as the authored content says
 * it), then three significant digits, "333,000", and words, "1.3 million".
 */
export function formatTimes(ratio: number, i18n: I18n): string {
	// the simple level: whole numbers to 100, then "more than 100" (#51)
	if (isSimple(i18n)) return formatCount(ratio, i18n)
	if (ratio >= 1e6) return formatBigNumber(ratio, i18n.formatLocale)
	if (ratio >= 10_000) return i18n.significant(ratio, 3)
	return i18n.number(roughly(ratio))
}

/** A length of time: hours below two days, days below two years, Earth years above. */
export function formatSpan(days: number, i18n: I18n): string {
	if (isSimple(i18n)) return durationInWords(days * 86_400, i18n)
	if (days < 2) return i18n.quantity(sig3(days * 24), "hour", "long")
	if (days < 2 * DAYS_PER_YEAR) return i18n.quantity(sig3(days), "day", "long")
	return i18n.quantity(sig3(days / DAYS_PER_YEAR), "year", "long")
}

/** How long light takes for `km`: "1.3 seconds", "8.3 minutes", "4.2 hours". */
export function formatLightTime(km: number, i18n: I18n): string {
	const seconds = km / SPEED_OF_LIGHT_KM_S
	if (isSimple(i18n)) return durationInWords(seconds, i18n)
	if (seconds < 60) return i18n.quantity(roughly(seconds), "second", "long")
	const minutes = seconds / 60
	if (minutes < 90) return i18n.quantity(roughly(minutes), "minute", "long")
	return i18n.quantity(roughly(minutes / 60), "hour", "long")
}

/** A distance: "385,000 km" nearby, "5.2 AU · 778 million km" across the system. */
export function formatDistance(km: number, i18n: I18n): string {
	if (isSimple(i18n)) return distanceInWords(km, i18n)
	if (km < 1e6) return i18n.quantity(sig3(km), "kilometer")
	return `${i18n.t("units.au", { value: i18n.significant(kmToAu(km), 2) })} · ${i18n.t(
		"units.millionKm",
		{ value: i18n.significant(km / 1e6, 3) },
	)}`
}

/**
 * A mass in scientific notation: "1.9 × 10²⁷ kg" (nobody reads 27 zeros);
 * at the simple level against Earth ("weighs as much as 318 Earths").
 */
export function formatMass(kg: number, i18n: I18n): string {
	if (!(kg > 0)) return MISSING_VALUE
	if (isSimple(i18n)) return massVsEarth(kg, i18n)
	return `${formatScientific(kg, i18n)} kg`
}

// ------------------------------------------------------------------ physics

/** The body and its ancestors, the Sun first. */
function chainOf(body: Body): Body[] {
	const chain: Body[] = []
	for (
		let at: Body | undefined = body;
		at !== undefined;
		at = at.parentId === null ? undefined : bodyById.get(at.parentId)
	) {
		chain.unshift(at)
	}
	return chain
}

/** The true distance between two bodies' centres at `jd`, km (never the drawn one). */
export function distanceKm(a: Body, b: Body, jd: number): number {
	const list = [...chainOf(a)]
	for (const body of chainOf(b)) if (!list.includes(body)) list.push(body)
	// computePositions needs parents first: the chains are, and so is their union by depth
	list.sort((x, y) => chainOf(x).length - chainOf(y).length)
	const positions = computePositions(list, jd)
	const i = list.indexOf(a) * 3
	const j = list.indexOf(b) * 3
	return Math.hypot(
		positions[i] - positions[j],
		positions[i + 1] - positions[j + 1],
		positions[i + 2] - positions[j + 2],
	)
}

const apsides = (orbit: NonNullable<Body["orbit"]>): [number, number] => [
	orbit.semiMajorAxisKm * (1 - orbit.eccentricity),
	orbit.semiMajorAxisKm * (1 + orbit.eccentricity),
]

/**
 * The closest and farthest the two can be, km: for a body and its own
 * satellite the satellite's peri- and apoapsis; for two bodies going round
 * the same one (two planets, two moons of Jupiter) the gap between their
 * orbits and the two orbits' far ends added up (orbits taken as coplanar, as
 * the classroom numbers are: Mars 0.37 to 2.7 AU from Earth). Null otherwise.
 */
export function distanceRangeKm(a: Body, b: Body): [number, number] | null {
	if (a.parentId === b.id && a.orbit !== null) return apsides(a.orbit)
	if (b.parentId === a.id && b.orbit !== null) return apsides(b.orbit)
	if (
		a.parentId === null ||
		a.parentId !== b.parentId ||
		a.orbit === null ||
		b.orbit === null
	) {
		return null
	}
	const [qa, farA] = apsides(a.orbit)
	const [qb, farB] = apsides(b.orbit)
	return [Math.max(0, qa - farB, qb - farA), farA + farB]
}

/** Goes round the Sun itself (a planet; later a dwarf planet or comet, #23). */
const orbitsTheSun = (body: Body): boolean =>
	body.orbit !== null &&
	body.parentId !== null &&
	bodyById.get(body.parentId)?.parentId === null

/**
 * The solar day, sunrise to sunrise, in Earth days: #26's `solarDayDays`
 * with the year of the body's way round the Sun, which for a moon is its
 * planet's (our Moon: 29.5 days). Null for the Sun and bodies without a spin.
 */
export function solarDay(body: Body): number | null {
	const traveller = chainOf(body).find(orbitsTheSun)
	if (traveller === undefined) return null
	return solarDayDays({ ...body, orbit: traveller.orbit })
}

// ------------------------------------------------------------------ facts

type Names = Record<string, string>

/** `{ <role>Id: id, <role>: name }` for a message. */
const named = (role: string, body: Body, i18n: I18n): Names => ({
	[`${role}Id`]: body.id,
	[role]: bodyName(body.id, i18n.chain),
})

const nameOf = (body: Body, i18n: I18n) => bodyName(body.id, i18n.chain)

const fact = (
	key: PairFactKey,
	i18n: I18n,
	comparison: string,
	values: FactValue[],
	notes: string[] = [],
	id: string = key,
): PairFact => ({
	key,
	id,
	label: i18n.t(`compare.facts.label.${key}` as MessageKey),
	comparison,
	values,
	notes,
})

/** Orders a pair by a measure: the larger first. */
const byMeasure = (a: Body, b: Body, measure: (body: Body) => number) =>
	measure(a) >= measure(b) ? ([a, b] as const) : ([b, a] as const)

function sizeFact(a: Body, b: Body, i18n: I18n): PairFact {
	const [big, small] = byMeasure(a, b, (body) => body.radiusKm)
	const ratio = big.radiusKm / small.radiusKm
	const diameter = (body: Body) => {
		// the simple level: a size word ("huge"), no kilometres (#51)
		if (isSimple(i18n)) return formatSize(2 * body.radiusKm, i18n)
		const text = i18n.quantity(sig3(2 * body.radiusKm), "kilometer")
		return body.radiusEstimated ? i18n.t("units.approx", { value: text }) : text
	}
	const comparison =
		ratio < SIMILAR_RATIO
			? i18n.t("compare.facts.size.similar", {
					...named("a", a, i18n),
					...named("b", b, i18n),
					percent: i18n.significant((ratio - 1) * 100, 1),
				})
			: i18n.t("compare.facts.size.times", {
					...named("big", big, i18n),
					...named("small", small, i18n),
					n: formatTimes(ratio, i18n),
				})
	return fact("size", i18n, comparison, [
		{ name: nameOf(a, i18n), text: diameter(a) },
		{ name: nameOf(b, i18n), text: diameter(b) },
	])
}

function volumeFact(a: Body, b: Body, i18n: I18n): PairFact | null {
	const [big, small] = byMeasure(a, b, (body) => body.radiusKm)
	const ratio = (big.radiusKm / small.radiusKm) ** 3
	if (ratio < VOLUME_FROM_RATIO) return null
	const count = isSimple(i18n)
		? countArgs(ratio, i18n).count
		: ratio >= 1000
			? Math.round(ratio)
			: roughly(ratio)
	return fact(
		"volume",
		i18n,
		i18n.t("compare.facts.volume", {
			...named("big", big, i18n),
			...named("small", small, i18n),
			n: formatTimes(ratio, i18n),
			count,
		}),
		[],
	)
}

function massFact(a: Body, b: Body, i18n: I18n): PairFact | null {
	if (a.massKg === null || b.massKg === null) return null
	const [big, small] = byMeasure(a, b, (body) => body.massKg ?? 0)
	const ratio = (big.massKg ?? 0) / (small.massKg ?? 1)
	if (!Number.isFinite(ratio) || ratio <= 0) return null
	const mass = (body: Body) => formatMass(body.massKg ?? 0, i18n)
	return fact(
		"mass",
		i18n,
		ratio < SIMILAR_RATIO
			? i18n.t("compare.facts.mass.similar", {
					...named("a", a, i18n),
					...named("b", b, i18n),
				})
			: i18n.t("compare.facts.mass.times", {
					...named("big", big, i18n),
					...named("small", small, i18n),
					n: formatTimes(ratio, i18n),
				}),
		[
			{ name: nameOf(a, i18n), text: mass(a) },
			{ name: nameOf(b, i18n), text: mass(b) },
		],
	)
}

function weightFact(a: Body, b: Body, i18n: I18n): PairFact | null {
	const earthGravity = earth === undefined ? null : surfaceGravity(earth)
	const ga = surfaceGravity(a)
	const gb = surfaceGravity(b)
	if (ga === null || gb === null || earthGravity === null) return null
	// you stand on Earth when it is one of the two, else on the first body
	const [home, other] = b.id === "earth" ? [b, a] : [a, b]
	const gHome = home === a ? ga : gb
	const gOther = other === a ? ga : gb
	const ratio = gOther / gHome
	const kg = (g: number) =>
		isSimple(i18n)
			? formatCount((REFERENCE_WEIGHT_KG * g) / earthGravity, i18n)
			: i18n.significant((REFERENCE_WEIGHT_KG * g) / earthGravity, 2)
	const values = {
		...named("home", home, i18n),
		...named("other", other, i18n),
		kgHome: kg(gHome),
		kgOther: kg(gOther),
	}
	const comparison =
		ratio >= WEIGHT_SIMILAR
			? i18n.t("compare.facts.weight.more", {
					...values,
					n: formatTimes(ratio, i18n),
				})
			: ratio > 1 / WEIGHT_SIMILAR
				? i18n.t("compare.facts.weight.similar", values)
				: i18n.t("compare.facts.weight.less", {
						...values,
						percent: i18n.significant(ratio * 100, 2),
					})
	const gravity = (g: number) =>
		i18n.t("units.gravity", { value: i18n.significant(g, 3) })
	const notes = [a, b]
		.filter(hasNoSurface)
		.map((body) =>
			i18n.t("compare.facts.weight.noSurface", named("x", body, i18n)),
		)
	return fact(
		"weight",
		i18n,
		comparison,
		// the simple level says it in kilograms only, no m/s² (#51)
		isSimple(i18n)
			? []
			: [
					{ name: nameOf(a, i18n), text: gravity(ga) },
					{ name: nameOf(b, i18n), text: gravity(gb) },
				],
		notes,
	)
}

/** A year (both go round the Sun) or an orbit (both go round the same planet). */
function periodFact(a: Body, b: Body, i18n: I18n): PairFact | null {
	if (a.orbit === null || b.orbit === null || a.parentId !== b.parentId) {
		return null
	}
	const key = orbitsTheSun(a) ? "year" : "orbit"
	const parent = a.parentId === null ? undefined : bodyById.get(a.parentId)
	if (parent === undefined) return null
	const [slow, fast] = byMeasure(a, b, (body) => body.orbit?.periodDays ?? 0)
	const ratio = (slow.orbit?.periodDays ?? 0) / (fast.orbit?.periodDays ?? 1)
	const comparison =
		ratio < SIMILAR_RATIO
			? i18n.t(`compare.facts.${key}.similar` as MessageKey, {
					...named("a", a, i18n),
					...named("b", b, i18n),
					...named("parent", parent, i18n),
				})
			: i18n.t(`compare.facts.${key}.times` as MessageKey, {
					...named("slow", slow, i18n),
					...named("fast", fast, i18n),
					...named("parent", parent, i18n),
					n: formatTimes(ratio, i18n),
				})
	return fact(key, i18n, comparison, [
		{ name: nameOf(a, i18n), text: formatSpan(a.orbit.periodDays, i18n) },
		{ name: nameOf(b, i18n), text: formatSpan(b.orbit.periodDays, i18n) },
	])
}

function dayFact(a: Body, b: Body, i18n: I18n): PairFact | null {
	const da = solarDay(a)
	const db = solarDay(b)
	if (da === null || db === null) return null
	const [long, short] = byMeasure(a, b, (body) => (body === a ? da : db))
	const ratio = Math.max(da, db) / Math.min(da, db)
	const comparison =
		ratio < SIMILAR_RATIO
			? i18n.t("compare.facts.day.similar", {
					...named("a", a, i18n),
					...named("b", b, i18n),
				})
			: i18n.t("compare.facts.day.times", {
					...named("long", long, i18n),
					...named("short", short, i18n),
					n: formatTimes(ratio, i18n),
				})
	return fact("day", i18n, comparison, [
		{ name: nameOf(a, i18n), text: formatSpan(da, i18n) },
		{ name: nameOf(b, i18n), text: formatSpan(db, i18n) },
	])
}

/**
 * The strange calendars: Mercury, where one day (sunrise to sunrise) lasts
 * two of its years, and Venus, which turns once more slowly than it goes
 * round the Sun. Null for everything with an ordinary day.
 */
function dayYearFact(body: Body, i18n: I18n): PairFact | null {
	if (!orbitsTheSun(body) || body.orbit === null) return null
	const day = solarDay(body)
	const spinHours = body.rotation.periodHours
	if (day === null || spinHours === null) return null
	const year = body.orbit.periodDays
	const turn = Math.abs(spinHours) / 24
	const values = {
		...named("x", body, i18n),
		day: formatSpan(day, i18n),
		year: formatSpan(year, i18n),
		turn: formatSpan(turn, i18n),
	}
	const key =
		day > year
			? "compare.facts.dayYear.day"
			: turn > year
				? "compare.facts.dayYear.turn"
				: null
	if (key === null) return null
	return fact(
		"dayYear",
		i18n,
		i18n.t(key, values),
		[],
		[],
		`dayYear-${body.id}`,
	)
}

function distanceFact(
	a: Body,
	b: Body,
	i18n: I18n,
	jd: number,
	live: boolean,
): PairFact {
	const km = distanceKm(a, b, jd)
	const names = { ...named("a", a, i18n), ...named("b", b, i18n) }
	const range = distanceRangeKm(a, b)
	const notes =
		range === null
			? []
			: [
					i18n.t("compare.facts.distance.range", {
						min: formatLightTime(range[0], i18n),
						max: formatLightTime(range[1], i18n),
						minKm: formatDistance(range[0], i18n),
						maxKm: formatDistance(range[1], i18n),
					}),
				]
	return {
		key: "distance",
		id: "distance",
		label: live
			? i18n.t("compare.facts.label.distanceNow")
			: i18n.t("compare.facts.label.distanceOn", {
					date: i18n.dateTimeUTC(jdToDate(jd)),
				}),
		comparison: i18n.t("compare.facts.distance.light", {
			...names,
			light: formatLightTime(km, i18n),
			drive: formatSpan(km / CAR_SPEED_KMH / 24, i18n),
		}),
		values: [{ name: null, text: formatDistance(km, i18n) }],
		notes,
	}
}

export interface PairFactsOptions {
	/** The moment the distance is measured at (Julian Date). */
	jd: number
	/** The moment is the present (the label says "right now", else the date). */
	live: boolean
	/** A comparison to put first: the one that makes an idea's point (#40). */
	lead?: PairFactKey
}

/**
 * Everything worth saying about `a` beside `b` that applies to them: size,
 * volume, mass, weight, year or orbit, day, the strange calendars, and how
 * far apart they are at `options.jd`. `options.lead` comes first, the rest
 * keep their order.
 */
export function pairFacts(
	a: Body,
	b: Body,
	i18n: I18n,
	options: PairFactsOptions,
): PairFact[] {
	if (a.id === b.id) return []
	const facts = [
		sizeFact(a, b, i18n),
		volumeFact(a, b, i18n),
		massFact(a, b, i18n),
		weightFact(a, b, i18n),
		periodFact(a, b, i18n),
		dayFact(a, b, i18n),
		dayYearFact(a, i18n),
		dayYearFact(b, i18n),
		distanceFact(a, b, i18n, options.jd, options.live),
	].filter((item): item is PairFact => item !== null)
	const lead = options.lead
	if (lead === undefined) return facts
	return [
		...facts.filter((item) => item.key === lead),
		...facts.filter((item) => item.key !== lead),
	]
}
