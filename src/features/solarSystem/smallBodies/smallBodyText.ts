/**
 * The sentences the HUD says about the small bodies (#23), built from `I18n` so they are
 * testable in every locale and reading level: what a belt's dots stand for and how empty
 * the belt really is, and what a comet is doing right now.
 */
import { belts, type Belt, type Body } from "@/data"
import {
	distanceInWords,
	durationInWords,
	formatCount,
	isSimple,
	type I18n,
} from "@/i18n"
import { AU_KM, jdToDate, propagate, type Vec3 } from "@/sim"
import {
	activityAt,
	dustTailLengthKm,
	ionTailLengthKm,
	nextPerihelionJD,
	previousPerihelionJD,
} from "@/sim/comet"

import { LATEST_WATCH_JD } from "./cometWatch"
import { formatDayUTC } from "../ui/timeTravel"

/** Mean distance from the Earth to the Moon (km): the ruler for "how empty". */
export const EARTH_MOON_KM = 384400

/** Below this length (km) a comet's tail has hardly begun: the card says it is waking up. */
export const WAKING_TAIL_KM = 1e5

/** Rounds to two significant digits: "about 380", "about 17", "2.6". */
const roughly = (value: number): number =>
	value > 0 && Number.isFinite(value) ? Number(value.toPrecision(2)) : 0

/** The belt a body counts as a member of (its semi-major axis inside the belt's extent), if any. */
export function beltOf(body: Pick<Body, "orbit" | "parentId">): Belt | null {
	if (body.orbit === null) return null
	const a = body.orbit.semiMajorAxisKm
	return (
		belts.find(
			(belt) =>
				belt.parentId === body.parentId &&
				a >= belt.extentKm[0] &&
				a <= belt.extentKm[1],
		) ?? null
	)
}

/**
 * A length for a sentence: "1 million km", "60 million km", "400,000 km";
 * at the simple level in words ("26 times as far as the Moon is from Earth", #51).
 */
export function lengthText(km: number, i18n: I18n): string {
	if (isSimple(i18n)) return distanceInWords(km, i18n)
	return km >= 1e6
		? i18n.t("units.millionKm", { value: roughly(km / 1e6) })
		: i18n.quantity(roughly(km), "kilometer")
}

export interface BeltSentences {
	name: string
	perDot: string
	spacing: string
	dotSize: string
}

/** What a belt's dots stand for and how far apart its members really are. */
export function beltSentences(belt: Belt, i18n: I18n): BeltSentences {
	const perDot = roughly(belt.members.count / belt.dots)
	const moons = roughly(belt.meanSeparationKm / EARTH_MOON_KM)
	return {
		name: i18n.t("solarSystem.smallBodies.beltName", { belt: belt.id }),
		perDot: i18n.t("solarSystem.smallBodies.perDot", {
			belt: belt.id,
			count: perDot,
			n: formatCount(perDot, i18n),
			size: i18n.quantity(belt.members.minDiameterKm, "kilometer"),
			total: i18n.number(belt.members.count),
		}),
		spacing: i18n.t("solarSystem.smallBodies.spacing", {
			distance: lengthText(belt.meanSeparationKm, i18n),
			moons,
			n: formatCount(moons, i18n),
		}),
		dotSize: i18n.t("solarSystem.smallBodies.dotSize"),
	}
}

export interface CometSentences {
	where: string
	tail: string
	perihelion: string
}

const now: Vec3 = { x: 0, y: 0, z: 0 }
const later: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * Where a comet is at `jd`, what its tail is doing (its true length; that it is waking up;
 * or where it will) and when it is next (or was last) closest to the Sun; null for a body
 * without a tail.
 */
export function cometSentences(
	body: Pick<Body, "orbit" | "tail">,
	jd: number,
	i18n: I18n,
): CometSentences | null {
	const { orbit, tail: comet } = body
	if (orbit === null || comet === undefined) return null
	propagate(orbit, jd, now)
	propagate(orbit, jd + 0.01, later)
	const r = Math.hypot(now.x, now.y, now.z)
	const direction = Math.hypot(later.x, later.y, later.z) < r ? "in" : "out"
	const au = r / AU_KM
	const where = i18n.t("solarSystem.smallBodies.comet.where", {
		distance: isSimple(i18n)
			? distanceInWords(r, i18n)
			: i18n.t("units.au", { value: i18n.significant(au, au < 10 ? 2 : 3) }),
		direction,
	})
	// the longer of its tails (67P grew only a dust tail, Encke only a gas tail)
	const activity = activityAt(orbit, comet, jd)
	const length = Math.max(
		ionTailLengthKm(comet, activity),
		dustTailLengthKm(comet, activity),
	)
	const tail =
		length >= WAKING_TAIL_KM
			? i18n.t("solarSystem.smallBodies.comet.tail", {
					length: lengthText(length, i18n),
					direction,
				})
			: length > 0
				? i18n.t("solarSystem.smallBodies.comet.waking")
				: i18n.t("solarSystem.smallBodies.comet.noTail", {
						onset: i18n.t("units.au", {
							value: i18n.significant(comet.onsetKm / AU_KM, 2),
						}),
					})
	const next = nextPerihelionJD(orbit, jd)
	const day = (at: number) => formatDayUTC(jdToDate(at), i18n.formatLocale)
	const perihelion =
		next <= LATEST_WATCH_JD
			? i18n.t("solarSystem.smallBodies.comet.next", {
					date: day(next),
					duration: durationInWords((next - jd) * 86_400, i18n),
				})
			: i18n.t("solarSystem.smallBodies.comet.last", {
					date: day(previousPerihelionJD(orbit, jd)),
					years: roughly((next - jd) / 365.25),
					duration: durationInWords((next - jd) * 86_400, i18n),
				})
	return { where, tail, perihelion }
}
