/**
 * The numbers behind the light panel (#27): who a pulse reaches and when, the
 * signal delay from Earth, and durations written the way the reading level
 * reads them. All from TRUE positions (src/sim/light.ts). Pure; the React
 * panel is LightPanel.tsx.
 */
import { bodies, bodyById, planets, sun, type Body } from "@/data"
import { durationInWords, isSimple, type I18n } from "@/i18n"
import { buildIndex } from "@/sim"
import {
	arrivalJD,
	distanceBetweenKm,
	distanceRangeKm,
	lightSeconds,
	truePositionAt,
} from "@/sim/light"
import type { LightPulse } from "@/store/light"

const index = buildIndex(bodies)

/** The bodies a pulse can be sent from, and a signal delay shown for: the Sun, the planets and the Moon. */
export const LIGHT_BODY_IDS: readonly string[] = Object.freeze([
	sun.id,
	...planets.map((planet) => planet.id),
	"moon",
])

/**
 * Who a pulse from `emitterId` is timed to: the Sun and the planets, plus the
 * Moon when Earth sends (the one moon a class knows, 1.3 s away); never the
 * source itself.
 */
export const pulseTargetIds = (emitterId: string): string[] =>
	[
		sun.id,
		...planets.map((planet) => planet.id),
		...(emitterId === "earth" ? ["moon"] : []),
	].filter((id) => id !== emitterId && bodyById.has(id))

export interface Arrival {
	readonly id: string
	/** Simulation time (JD) the light gets there. */
	readonly jd: number
	/** Seconds after it was sent. */
	readonly seconds: number
}

/** When the pulse reaches each target, earliest first (exact for where each body is when the light arrives). */
export function pulseArrivals(pulse: LightPulse): Arrival[] {
	const emitter = index.get(pulse.emitterId)
	if (emitter === undefined) return []
	const origin = truePositionAt(
		bodies,
		index,
		emitter,
		pulse.emitJD,
		new Float64Array(3),
	)
	return pulseTargetIds(pulse.emitterId)
		.map((id) => {
			const jd = arrivalJD(bodies, index, index.get(id)!, origin, pulse.emitJD)
			return { id, jd, seconds: (jd - pulse.emitJD) * 86400 }
		})
		.sort((a, b) => a.jd - b.jd)
}

export interface SignalDelay {
	/** Distance right now, km (true). */
	readonly distanceKm: number
	/** One-way light time right now, s. */
	readonly seconds: number
	/** The smallest and largest one-way time over all positions of both orbits, s. */
	readonly minSeconds: number
	readonly maxSeconds: number
}

/** The one-way signal delay between two bodies at `jd`, and its range over the years. */
export function signalDelay(
	fromId: string,
	toId: string,
	jd: number,
): SignalDelay | null {
	const from = index.get(fromId)
	const to = index.get(toId)
	if (from === undefined || to === undefined || from === to) return null
	const distanceKm = distanceBetweenKm(bodies, index, from, to, jd)
	const range = distanceRangeKm(bodies[from], bodies[to], bodyById)
	return {
		distanceKm,
		seconds: lightSeconds(distanceKm),
		minSeconds: lightSeconds(range.min),
		maxSeconds: lightSeconds(range.max),
	}
}

/** Light-travel facts beyond the solar system (the exit ramp), in light-years. */
export const BEYOND = [
	{ id: "proximaCentauri", lightYears: 4.2465 },
	{ id: "galacticCentre", lightYears: 26_000 },
	{ id: "andromeda", lightYears: 2_500_000 },
] as const

export type BeyondId = (typeof BEYOND)[number]["id"]

/** km to the farthest planet's aphelion: once the front is past it, the light has left the planets behind. */
export const PLANETS_EDGE_KM = Math.max(
	...planets.map((planet: Body) =>
		planet.orbit === null
			? 0
			: planet.orbit.semiMajorAxisKm * (1 + planet.orbit.eccentricity),
	),
)

/**
 * A flash that has passed every planet lingers a while ("beyond the planets"),
 * then fades out (#38), so it never stays on screen forever. Both spans are
 * fractions of the time it took to pass the planets, so they are simulation
 * time: running time backwards brings the flash back.
 */
export const FLASH_LINGER = 0.25
export const FLASH_FADE = 0.25

/** "notYet": time is before the flash was sent; "leaving": past every planet, lingering and fading; "ended": faded out. */
export type FlashPhase = "notYet" | "travelling" | "leaving" | "ended"

export interface FlashState {
	readonly phase: FlashPhase
	/** 0..1: how strongly the flash is drawn (it fades at the end of "leaving"). */
	readonly opacity: number
}

const pastPlanetsCache = new WeakMap<LightPulse, number>()

/**
 * Seconds after sending at which the flash has passed every planet: its last
 * arrival, or the farthest planet's aphelion, whichever is later.
 */
export function pastPlanetsSeconds(pulse: LightPulse): number {
	let seconds = pastPlanetsCache.get(pulse)
	if (seconds === undefined) {
		seconds = Math.max(
			lightSeconds(PLANETS_EDGE_KM),
			pulseArrivals(pulse).at(-1)?.seconds ?? 0,
		)
		pastPlanetsCache.set(pulse, seconds)
	}
	return seconds
}

/** Where a flash is in its life `seconds` after it was sent, given when it passes the planets. */
export function flashState(seconds: number, pastSeconds: number): FlashState {
	if (seconds < 0) return { phase: "notYet", opacity: 0 }
	if (seconds < pastSeconds) return { phase: "travelling", opacity: 1 }
	const t = (seconds / pastSeconds - 1 - FLASH_LINGER) / FLASH_FADE
	if (t >= 1) return { phase: "ended", opacity: 0 }
	if (t <= 0) return { phase: "leaving", opacity: 1 }
	return { phase: "leaving", opacity: 1 - t * t * (3 - 2 * t) }
}

/** Years light needs for the nearest star (to a tenth), for the "left the planets behind" line. */
export const NEAREST_STAR_YEARS: number =
	Math.round(BEYOND[0].lightYears * 10) / 10

type DurationUnit = "second" | "minute" | "hour" | "day" | "year"

const MINUTE = 60
const HOUR = 3600
const DAY = 86400
const YEAR = 365.25 * DAY

/**
 * A duration split into the units a person reads: "1.3 s", "42 s",
 * "8 min 20 s", "4 h 10 min" ("4 h 10 min 12 s" when `precise`, for a
 * running clock), "3 days 4 h", "4.2 years". Values carry correctly (59.96 s
 * is "1 min", never "60 s"); trailing zeros are dropped unless `precise`.
 * Negative durations are measured as positive.
 */
export function durationParts(
	seconds: number,
	precise = false,
): { unit: DurationUnit; value: number }[] {
	const parts = splitDuration(seconds, precise)
	if (precise) return parts
	// "1 min", not "1 min 0 s"; "3 h", not "3 h 0 min"
	while (parts.length > 1 && parts[parts.length - 1].value === 0) parts.pop()
	return parts
}

/** Seconds rounded to whole minutes from a minute on: for ranges and rough figures ("3 to 22 min"). */
export const roughSeconds = (seconds: number): number =>
	Math.abs(seconds) >= 60 ? Math.round(seconds / 60) * 60 : seconds

function splitDuration(
	seconds: number,
	precise: boolean,
): { unit: DurationUnit; value: number }[] {
	const s = Math.abs(seconds)
	if (!Number.isFinite(s)) return []
	if (s < 10) {
		const value = Math.round(s * 10) / 10
		if (value < 10) return [{ unit: "second", value }]
	}
	if (s < YEAR) {
		const total = Math.round(s)
		const days = Math.floor(total / DAY)
		const hours = Math.floor((total % DAY) / HOUR)
		const minutes = Math.floor((total % HOUR) / MINUTE)
		const secs = total % MINUTE
		if (total < MINUTE) return [{ unit: "second", value: secs }]
		if (total < HOUR) {
			return [
				{ unit: "minute", value: minutes },
				{ unit: "second", value: secs },
			]
		}
		if (total < DAY) {
			if (precise) {
				return [
					{ unit: "hour", value: hours },
					{ unit: "minute", value: minutes },
					{ unit: "second", value: secs },
				]
			}
			const roundedMinutes = Math.round((total % HOUR) / MINUTE)
			if (roundedMinutes === 60) {
				return hours + 1 === 24
					? [{ unit: "day", value: 1 }]
					: [
							{ unit: "hour", value: hours + 1 },
							{ unit: "minute", value: 0 },
						]
			}
			return [
				{ unit: "hour", value: hours },
				{ unit: "minute", value: roundedMinutes },
			]
		}
		const roundedHours = precise ? hours : Math.round((total % DAY) / HOUR)
		if (roundedHours === 24) {
			return [
				{ unit: "day", value: days + 1 },
				{ unit: "hour", value: 0 },
			]
		}
		return [
			{ unit: "day", value: days },
			{ unit: "hour", value: roundedHours },
		]
	}
	const years = s / YEAR
	const value =
		years < 100 ? Math.round(years * 10) / 10 : Math.round(years / 100) * 100
	return [{ unit: "year", value }]
}

/** From this long on, the simple level says a duration in words, not in counted days or years (#51). */
const SIMPLE_IN_WORDS_FROM = 100 * DAY

/**
 * `durationParts` as text in the i18n's language and reading level ("8 min
 * 20 s", "8 Minuten und 20 Sekunden"); at the simple level spans from 100
 * days on as `durationInWords` ("4 years", "hundreds of years").
 */
export function formatDuration(
	seconds: number,
	i18n: I18n,
	precise = false,
): string {
	if (isSimple(i18n) && Math.abs(seconds) >= SIMPLE_IN_WORDS_FROM) {
		return durationInWords(seconds, i18n)
	}
	const parts = durationParts(seconds, precise).map((part) =>
		i18n.t(`solarSystem.light.duration.${part.unit}`, { count: part.value }),
	)
	if (parts.length === 0) return "—"
	if (parts.length === 1) return parts[0]
	if (parts.length === 2) {
		return i18n.t("solarSystem.light.duration.join2", {
			a: parts[0],
			b: parts[1],
		})
	}
	return i18n.t("solarSystem.light.duration.join3", {
		a: parts[0],
		b: parts[1],
		c: parts[2],
	})
}
