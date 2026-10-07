/**
 * The walk's sentences (#25), pure so the numbers and the wording can be
 * tested in every locale and reading level. Components pass `useI18n()` and
 * `useBodyName()`; tests pass `createI18n()` and `bodyName`.
 *
 * At the simple reading level (#51) a length above 100 m is counted in
 * football pitches ("7 football pitches"), and the true sizes, the true
 * distances and the scale ratio stay out of the sentences.
 */
import { countArgs, isSimple, thingName, type I18n } from "@/i18n"

import {
	formatLength,
	formatScaleDenominator,
	formatTrueKm,
	roundCount,
	roundHours,
	roundMinutes,
} from "./lengths"
import {
	LANDMARKS,
	landmarkCount,
	type LandmarkId,
	type ModelBody,
	type SolarWalk,
	type WalkStop,
} from "./walk"

type Name = (id: string) => string

/** Up to this many metres the simple level counts in metres, beyond it in football pitches. */
const SIMPLE_METRES = 100

/**
 * A length on the field: "2.2 mm", "26 m", "775 m"; at the simple level
 * above 100 m in football pitches ("7 football pitches", "more than 100
 * football pitches"), whichever landmark is picked.
 */
export function walkLength(metres: number, i18n: I18n): string {
	if (!isSimple(i18n) || metres <= SIMPLE_METRES) {
		return formatLength(metres, i18n.formatLocale)
	}
	const pitches = Math.max(1, landmarkCount(metres, "pitch"))
	return i18n.t("solarWalk.landmarkCount.pitch", countArgs(pitches, i18n))
}

const length = (i18n: I18n, metres: number) => walkLength(metres, i18n)

/** The page title: "If the Sun were a basketball…". */
export const titleText = (walk: SolarWalk, i18n: I18n): string =>
	i18n.t("solarWalk.title", {
		object: i18n.t(`solarWalk.sunObject.${walk.sunObject}`),
	})

/** The scale as the n of 1 : n, in words ("5.8 billion"). */
export const ratioText = (walk: SolarWalk, i18n: I18n): string =>
	formatScaleDenominator(walk.scaleDenominator, i18n.formatLocale)

/** "…Earth would be a pinhead, 26 m away." */
export function leadText(walk: SolarWalk, i18n: I18n): string {
	const earth = walk.stops.find((stop) => stop.id === "earth")
	if (earth === undefined) return ""
	return i18n.t("solarWalk.lead", {
		earth: thingName(earth.thing, i18n),
		earthSize: length(i18n, earth.sizeM),
		earthDistance: length(i18n, earth.distanceM),
		ratio: ratioText(walk, i18n),
	})
}

/** "The whole walk to Neptune: 775 m, about 12 minutes on foot." */
export const summaryText = (walk: SolarWalk, i18n: I18n): string =>
	i18n.t("solarWalk.summary", {
		distance: length(i18n, walk.lengthM),
		time: i18n.quantity(roundMinutes(walk.walkingMinutes), "minute", "long"),
	})

/** The first stop: the ball itself. */
export const sunStopText = (walk: SolarWalk, i18n: I18n): string =>
	i18n.t("solarWalk.sunStop", {
		object: i18n.t(`solarWalk.sunObject.${walk.sunObject}`),
		size: length(i18n, walk.sun.sizeM),
		trueSize: formatTrueKm(walk.sun.trueSizeKm, i18n.formatLocale),
	})

const sizeValues = (body: ModelBody, i18n: I18n) => ({
	size: length(i18n, body.sizeM),
	trueSize: formatTrueKm(body.trueSizeKm, i18n.formatLocale),
	thing: thingName(body.thing, i18n),
})

/**
 * A distance in landmark lengths: "1.3 football pitches"; null below a
 * tenth of one (nobody says "0 football pitches").
 */
export function landmarkCountText(
	distanceM: number,
	landmark: LandmarkId,
	i18n: I18n,
): string | null {
	const count = roundCount(landmarkCount(distanceM, landmark))
	return count === 0
		? null
		: i18n.t(`solarWalk.landmarkCount.${landmark}`, countArgs(count, i18n))
}

/** The lines of one stop's card. */
export interface StopText {
	/** "Walk 7.1 m more": the way there from the previous stop. */
	leg: string
	/** "2.2 mm across – about the size of a pinhead". */
	size: string
	/** "26 m from the Sun". */
	distance: string
	/** "0.2 football pitches", with a landmark. */
	landmark: string | null
	/** One line per big moon. */
	moons: string[]
}

/** "Walk 10 m". */
export const legText = (metres: number, i18n: I18n): string =>
	i18n.t("solarWalk.leg", { distance: length(i18n, metres) })

/**
 * @param legM the way there, when it does not start at the previous stop
 *             (after a landmark marker)
 */
export function stopText(
	stop: WalkStop,
	landmark: LandmarkId | null,
	i18n: I18n,
	name: Name,
	legM: number = stop.legM,
): StopText {
	return {
		leg: legText(legM, i18n),
		size: i18n.t("solarWalk.size", sizeValues(stop, i18n)),
		distance: i18n.t("solarWalk.distance", {
			distance: length(i18n, stop.distanceM),
			trueDistance: formatTrueKm(stop.trueDistanceKm, i18n.formatLocale),
		}),
		landmark:
			landmark === null
				? null
				: landmarkCountText(stop.distanceM, landmark, i18n),
		moons: stop.moons.map((moon) =>
			i18n.t("solarWalk.moon", {
				...sizeValues(moon, i18n),
				name: name(moon.id),
				distance: length(i18n, moon.distanceM),
				trueDistance: formatTrueKm(moon.trueDistanceKm, i18n.formatLocale),
			}),
		),
	}
}

/** "The end of a football pitch: 105 m from the Sun". */
export const landmarkMarkerText = (landmark: LandmarkId, i18n: I18n): string =>
	i18n.t(`solarWalk.landmarkMarker.${landmark}`, {
		length: length(i18n, LANDMARKS[landmark].lengthM),
	})

/** The shock at the end: the nearest star. */
export function starText(walk: SolarWalk, i18n: I18n): string {
	const star = walk.nearestStar
	return i18n.t("solarWalk.star", {
		...sizeValues(star, i18n),
		distance: length(i18n, star.distanceM),
		flight: i18n.quantity(roundHours(star.flightHours), "hour", "long"),
		times: i18n.significant(star.timesTheWalk, 2),
	})
}
