/**
 * The basketball solar system (#25): the solar system shrunk until the Sun is
 * an object you can hold, laid out as a walk a class can do on a school field.
 *
 * This is not a second scale model. It is #21's true scale, measured with a
 * different ruler: every length is the length the engine draws under
 * `TRUE_SCALE` (via `bodyDistortion`, so a body is drawn exactly as the "True
 * scale" preset draws it), multiplied by one factor that makes the Sun's
 * diameter the chosen object's. Sizes and distances therefore keep their true
 * proportions, and the arithmetic rests on the same data as the 3D model.
 *
 * Pure: no React, no strings. Lengths are in metres.
 */
import { bodyById, moonsOf, planets, sun, type Body } from "@/data"
import { TRUE_SCALE, bodyDistortion } from "@/sim"

import type { LandmarkId, SunObjectId } from "./search"

export {
	DEFAULT_LANDMARK,
	DEFAULT_SUN_OBJECT,
	LANDMARK_IDS,
	SUN_OBJECT_IDS,
	type LandmarkId,
	type SunObjectId,
} from "./search"

/** The objects the Sun can be, with the diameters the walk is computed from. */
export const SUN_OBJECTS: Readonly<Record<SunObjectId, { diameterM: number }>> =
	{
		/** a typical orange */
		orange: { diameterM: 0.08 },
		/** a size 5 football (circumference 68–70 cm) */
		football: { diameterM: 0.22 },
		/** a size 7 basketball (circumference 75–78 cm) */
		basketball: { diameterM: 0.24 },
		/** a large exercise (gym) ball */
		exerciseBall: { diameterM: 1 },
	}

/**
 * Real ground to measure the walk against: standard sizes a school has, so a
 * teacher picks a name and never types a number.
 */
export const LANDMARKS: Readonly<Record<LandmarkId, { lengthM: number }>> = {
	/** FIFA's recommended pitch length (105 m x 68 m) */
	pitch: { lengthM: 105 },
	/** one lap of a standard athletics track, in lane 1 */
	track: { lengthM: 400 },
}

/**
 * Everyday things to compare a model body with, by typical diameter. Chosen to
 * be familiar in every shipped language (no national coins or foods) and close
 * enough together that the nearest one is never off by more than about 1.4x.
 */
export const THINGS = {
	fineSand: { diameterM: 0.0002 }, // fine sand: 0.125–0.25 mm
	salt: { diameterM: 0.0003 }, // a grain of table salt: about 0.3 mm
	sugar: { diameterM: 0.0006 }, // a grain of granulated sugar: 0.5–0.8 mm
	poppySeed: { diameterM: 0.001 }, // about 1 mm
	pinhead: { diameterM: 0.002 }, // the head of a dressmaker's pin: 1.5–2 mm
	peppercorn: { diameterM: 0.0045 }, // black pepper: 4–5 mm
	pea: { diameterM: 0.008 }, // a garden pea: 7–10 mm
	marble: { diameterM: 0.016 }, // the standard marble
	cherry: { diameterM: 0.022 }, // 2–2.5 cm
	walnut: { diameterM: 0.032 }, // 3–3.5 cm
	tableTennisBall: { diameterM: 0.04 }, // exactly 40 mm (ITTF)
	tennisBall: { diameterM: 0.067 }, // 6.54–6.86 cm (ITF)
	orange: { diameterM: 0.08 },
	grapefruit: { diameterM: 0.11 },
	melon: { diameterM: 0.15 }, // a small melon (Galia, cantaloupe)
	football: { diameterM: 0.22 },
} as const satisfies Record<string, { diameterM: number }>

export type ThingId = keyof typeof THINGS

const THING_IDS = Object.keys(THINGS) as ThingId[]

/** The everyday thing closest in size to `diameterM` (nearest on a log scale). */
export function nearestThing(diameterM: number): ThingId {
	let best: ThingId = THING_IDS[0]
	let bestMiss = Infinity
	for (const id of THING_IDS) {
		const miss = Math.abs(Math.log(diameterM / THINGS[id].diameterM))
		if (miss < bestMiss) {
			best = id
			bestMiss = miss
		}
	}
	return best
}

/**
 * The nearest star after the Sun. Not a body of the app (stars beyond the Sun
 * are not simulated), so its two numbers live here.
 * Distance: 1.3020 pc = 4.2465 light-years (Gaia DR3); radius 0.154 solar
 * radii (Kervella et al. 2017).
 */
export const LIGHT_YEAR_KM = 9_460_730_472_580.8
export const NEAREST_STAR = {
	distanceKm: 4.2465 * LIGHT_YEAR_KM,
	radiusKm: 0.154 * 695_700,
} as const

/** A class walking together: 4 km/h. */
export const WALKING_SPEED_KMH = 4
/** An airliner's cruising speed. */
export const FLIGHT_SPEED_KMH = 900

/** Moons from this radius up are "big moons" and get a line of their own on the walk. */
export const BIG_MOON_RADIUS_KM = 1000

/** A body shrunk to the model. */
export interface ModelBody {
	readonly id: string
	/** Diameter in the model (m). */
	readonly sizeM: number
	/** The true diameter (km). */
	readonly trueSizeKm: number
	/** Mean distance from its parent in the model (m): the semi-major axis. */
	readonly distanceM: number
	/** The true mean distance (km). */
	readonly trueDistanceKm: number
	readonly thing: ThingId
}

/** One stop of the walk: a planet and its big moons. */
export interface WalkStop extends ModelBody {
	/** How far on from the previous stop (m); from the Sun for the first planet. */
	readonly legM: number
	readonly moons: readonly ModelBody[]
}

export interface SolarWalk {
	readonly sunObject: SunObjectId
	/** Model metres per true kilometre. */
	readonly metresPerKm: number
	/** The scale as 1 : n. */
	readonly scaleDenominator: number
	/** The Sun: the chosen object, at the start. */
	readonly sun: ModelBody
	/** The planets from the Sun outward. */
	readonly stops: readonly WalkStop[]
	/** From the Sun to the last planet (m). */
	readonly lengthM: number
	/** Minutes to walk it at `WALKING_SPEED_KMH`. */
	readonly walkingMinutes: number
	readonly nearestStar: ModelBody & {
		/** Hours to fly its model distance at `FLIGHT_SPEED_KMH`. */
		readonly flightHours: number
		/** How many walks to the last planet fit into its distance. */
		readonly timesTheWalk: number
	}
}

/** `body` as the True scale preset draws it, in true km: the size and the distance from its parent. */
function trueScaleLengthsKm(body: Body): {
	sizeKm: number
	distanceKm: number
} {
	const parent =
		body.parentId === null ? null : (bodyById.get(body.parentId) ?? null)
	const { size, distance } = bodyDistortion(
		body,
		parent,
		sun.radiusKm,
		TRUE_SCALE,
	)
	return {
		sizeKm: 2 * body.radiusKm * size,
		distanceKm: (body.orbit?.semiMajorAxisKm ?? 0) * distance,
	}
}

function modelBody(body: Body, metresPerKm: number): ModelBody {
	const { sizeKm, distanceKm } = trueScaleLengthsKm(body)
	const sizeM = sizeKm * metresPerKm
	return {
		id: body.id,
		sizeM,
		trueSizeKm: 2 * body.radiusKm,
		distanceM: distanceKm * metresPerKm,
		trueDistanceKm: body.orbit?.semiMajorAxisKm ?? 0,
		thing: nearestThing(sizeM),
	}
}

/** The whole walk with the Sun as `sunObject`. */
export function buildWalk(sunObject: SunObjectId): SolarWalk {
	const sunDiameterKm = trueScaleLengthsKm(sun).sizeKm
	const metresPerKm = SUN_OBJECTS[sunObject].diameterM / sunDiameterKm
	let previousM = 0
	const stops = planets.map((planet): WalkStop => {
		const stop = modelBody(planet, metresPerKm)
		const legM = stop.distanceM - previousM
		previousM = stop.distanceM
		return {
			...stop,
			legM,
			moons: moonsOf(planet.id)
				.filter((moon) => moon.radiusKm >= BIG_MOON_RADIUS_KM)
				.map((moon) => modelBody(moon, metresPerKm)),
		}
	})
	const lengthM = previousM
	const starDistanceM = NEAREST_STAR.distanceKm * metresPerKm
	const starSizeM = 2 * NEAREST_STAR.radiusKm * metresPerKm
	return {
		sunObject,
		metresPerKm,
		scaleDenominator: 1 / (metresPerKm / 1000),
		sun: modelBody(sun, metresPerKm),
		stops,
		lengthM,
		walkingMinutes: (lengthM / 1000 / WALKING_SPEED_KMH) * 60,
		nearestStar: {
			id: "nearestStar",
			sizeM: starSizeM,
			trueSizeKm: 2 * NEAREST_STAR.radiusKm,
			distanceM: starDistanceM,
			trueDistanceKm: NEAREST_STAR.distanceKm,
			thing: nearestThing(starSizeM),
			flightHours: starDistanceM / 1000 / FLIGHT_SPEED_KMH,
			timesTheWalk: starDistanceM / lengthM,
		},
	}
}

/**
 * The stop a body's line is on (#48, `?focus=`): a planet's own stop, or the
 * stop of the planet a big moon circles; null for the Sun (the start) and for
 * anything the walk leaves out.
 */
export function stopOf(walk: SolarWalk, id: string): WalkStop | null {
	return (
		walk.stops.find(
			(stop) => stop.id === id || stop.moons.some((moon) => moon.id === id),
		) ?? null
	)
}

/** Where on the walk the first whole landmark length is reached. */
export interface LandmarkOnWalk {
	/** The index of the stop it comes before (a pitch's end between Mars and Jupiter comes before Jupiter). */
	readonly before: number
	/** From the previous stop (or the Sun) to the landmark (m). */
	readonly fromPreviousM: number
	/** From the landmark on to the stop it comes before (m). */
	readonly toNextM: number
}

/** Where the first whole landmark length is reached, or null if the walk ends before it. */
export function landmarkOnWalk(
	walk: SolarWalk,
	landmark: LandmarkId,
): LandmarkOnWalk | null {
	const lengthM = LANDMARKS[landmark].lengthM
	const before = walk.stops.findIndex((stop) => stop.distanceM >= lengthM)
	if (before === -1) return null
	const previousM = before === 0 ? 0 : walk.stops[before - 1].distanceM
	return {
		before,
		fromPreviousM: lengthM - previousM,
		toNextM: walk.stops[before].distanceM - lengthM,
	}
}

/** A distance in landmark lengths ("1.3 football pitches"). */
export const landmarkCount = (
	distanceM: number,
	landmark: LandmarkId,
): number => distanceM / LANDMARKS[landmark].lengthM
