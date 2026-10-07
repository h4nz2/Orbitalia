/**
 * The words and numbers of the flight readout (#18): how far the trip is, in
 * TRUE kilometres, and how long it would take at speeds a class can picture
 * (light, the fastest spacecraft ever launched, a car on the motorway). Pure,
 * translated through the i18n layer (`solarSystem.flight.*`); the readout
 * component only lays them out.
 */
import {
	durationInWords,
	formatDistance as formatAnyDistance,
	isSimple,
	type I18n,
} from "@/i18n"
import { kmToAu } from "@/sim"

/** km/s */
export const LIGHT_KM_S = 299_792.458
/**
 * New Horizons left Earth at 16.26 km/s (58,536 km/h), the fastest launch of
 * any spacecraft (NASA). The speed at launch, not a planned trajectory: the
 * readout compares straight-line distances, never mission times.
 */
export const PROBE_KM_S = 16.26
/** A car on the motorway, km/h. */
export const CAR_KM_H = 100

export type TravelMode = "light" | "probe" | "car"

export const TRAVEL_SPEEDS_KM_S: Readonly<Record<TravelMode, number>> = {
	light: LIGHT_KM_S,
	probe: PROBE_KM_S,
	car: CAR_KM_H / 3600,
}

export interface TravelTime {
	mode: TravelMode
	/** "Light", "The fastest space probe ever launched" */
	label: string
	/** "35 minutes" */
	time: string
}

/**
 * A figure for reading aloud: one decimal below 10 ("1.3"), whole numbers
 * below 100 ("35"), two significant digits above ("720", "5,300").
 */
export function approx(value: number): number {
	if (!Number.isFinite(value)) return value
	const abs = Math.abs(value)
	if (abs < 10) return Math.round(value * 10) / 10
	if (abs < 100) return Math.round(value)
	const step = 10 ** (Math.floor(Math.log10(abs)) - 1)
	return Math.round(value / step) * step
}

/**
 * "384,000 km", "628 million km", "4.35 billion km" (and the German forms);
 * at the simple level in words ("4 times as far as Earth is from the Sun").
 * `@/i18n`'s `formatDistance`, the app's one distance formatter.
 */
export const formatDistance = formatAnyDistance

const MINUTE = 60
const HOUR = 3600
const DAY = 86_400
const YEAR = 365.25 * DAY

/**
 * "1.3 seconds", "35 minutes", "4.2 hours", "160 days", "1.2 years", "5,300
 * years"; at the simple level "4 months", "hundreds of years".
 */
export function formatTravelTime(seconds: number, i18n: I18n): string {
	if (isSimple(i18n)) return durationInWords(seconds, i18n)
	if (seconds < 90) return i18n.quantity(approx(seconds), "second", "long")
	if (seconds < 90 * MINUTE) {
		return i18n.quantity(approx(seconds / MINUTE), "minute", "long")
	}
	if (seconds < 2 * DAY) {
		return i18n.quantity(approx(seconds / HOUR), "hour", "long")
	}
	if (seconds < YEAR) return i18n.quantity(approx(seconds / DAY), "day", "long")
	return i18n.quantity(approx(seconds / YEAR), "year", "long")
}

/** How long light, the fastest probe and a car would take for `km`, fastest first. */
export function travelTimes(km: number, i18n: I18n): TravelTime[] {
	const speed = {
		light: i18n.quantity(Math.round(LIGHT_KM_S), "kilometer-per-second"),
		probe: i18n.quantity(PROBE_KM_S, "kilometer-per-second"),
		car: i18n.quantity(CAR_KM_H, "kilometer-per-hour"),
	}
	return (["light", "probe", "car"] as const).map((mode) => ({
		mode,
		label: i18n.t(`solarSystem.flight.${mode}`, { speed: speed[mode] }),
		time: formatTravelTime(km / TRAVEL_SPEEDS_KM_S[mode], i18n),
	}))
}

/** "628 million km apart on this date" (with the AU at the advanced level). */
export const distanceLine = (km: number, i18n: I18n): string =>
	i18n.t("solarSystem.flight.distance", {
		distance: formatDistance(km, i18n),
		au: i18n.t("units.au", { value: i18n.significant(kmToAu(km), 3) }),
	})

/** The live counter under the progress bar: "312 million km crossed". */
export const crossedLine = (km: number, i18n: I18n): string =>
	i18n.t("solarSystem.flight.crossed", { distance: formatDistance(km, i18n) })
