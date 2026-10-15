/**
 * A planet's moon system as the card presents it (#17, docs/ARCHITECTURE.md,
 * "Moons"): the featured moons by name, the size of the long tail, and a
 * camera shot that shows the whole drawn system at once.
 */
import { moonsOf, type Body } from "@/data"
import { NO_INSETS, type Insets } from "@/store/freeArea"
import type { CameraShot } from "@/store/navigation"
import {
	childDistanceCurve,
	displayDistanceKm,
	propagate,
	radToDeg,
	spinAxis,
	type ScaleSettings,
	type Vec3,
} from "@/sim"

import {
	CAMERA_FOV_DEG,
	bodyFramingRadii,
	fitDistanceIn,
	framedRingRatio,
	lensOf,
} from "../camera/framing"

/** Margin around the outermost drawn orbit in the system shot. */
export const SYSTEM_MARGIN = 1.15
/**
 * The system shot looks down on the planet's equator, where its regular moons
 * orbit, from this elevation (degrees), so the orbits read as rings, from the
 * Sun's side, so the planet and its moons are lit.
 */
export const SYSTEM_ELEVATION_DEG = 55
/** The highest elevation a shot may ask for (the camera's pole limit). */
const MAX_SHOT_ELEVATION_DEG = 89.9

export interface MoonSystem {
	/** The featured moons in orbital order (the order `moonsOf` gives). */
	featured: Body[]
	/** The long tail: moons that are not featured. */
	others: Body[]
}

export function moonSystemOf(planetId: string): MoonSystem {
	const moons = moonsOf(planetId)
	return {
		featured: moons.filter((moon) => moon.featured),
		others: moons.filter((moon) => !moon.featured),
	}
}

/** A planet as the moon system's framing reads it: its size, depth and rings. */
export type FramedPlanet = Pick<Body, "radiusKm" | "parentId"> &
	Partial<Pick<Body, "rings">>

/** The planet's default framing in its drawn radii (`bodyFramingRadii`, #61). */
export const planetFramingRadii = (
	planet: FramedPlanet,
	aspect: number,
	insets: Insets = NO_INSETS,
): number =>
	bodyFramingRadii(
		framedRingRatio(planet),
		lensOf(CAMERA_FOV_DEG, aspect, insets),
	)

/**
 * The shot distance (a multiple of the planet's default framing,
 * `planetFramingRadii`) that fits the drawn apoapsis of the outermost of
 * `moons` under `scale`, with `SYSTEM_MARGIN`, in a view of `aspect` with
 * the band `insets` leave free (#61). At least 1: the system view never
 * comes closer than the close-up. 1 without moons.
 */
export function moonSystemShotDistance(
	planet: FramedPlanet,
	moons: readonly Pick<Body, "orbit">[],
	scale: ScaleSettings,
	aspect: number,
	insets: Insets = NO_INSETS,
): number {
	const curve = childDistanceCurve(scale, planet.parentId === null)
	let radii = 0
	for (const moon of moons) {
		if (moon.orbit === null) continue
		const apoapsisKm =
			moon.orbit.semiMajorAxisKm * (1 + moon.orbit.eccentricity)
		// in drawn parent radii: a drawn radius of 1
		radii = Math.max(
			radii,
			displayDistanceKm(apoapsisKm, planet.radiusKm, 1, curve),
		)
	}
	if (radii === 0) return 1
	const distance = fitDistanceIn(
		SYSTEM_MARGIN * radii,
		CAMERA_FOV_DEG,
		aspect,
		insets,
	)
	return Math.max(1, distance / planetFramingRadii(planet, aspect, insets))
}

const normalize = (v: Vec3): Vec3 => {
	const length = Math.hypot(v.x, v.y, v.z)
	return length > 0
		? { x: v.x / length, y: v.y / length, z: v.z / length }
		: { x: 0, y: 1, z: 0 }
}

/**
 * The direction (scene axes, from the planet to the camera) of the system
 * shot at `jd`: `SYSTEM_ELEVATION_DEG` above the planet's equator on its
 * northern side (the pole nearer the ecliptic north), turned toward the Sun.
 */
export function moonSystemDirection(
	planet: Pick<Body, "rotation" | "orbit">,
	jd: number,
): Vec3 {
	const axis = spinAxis(planet.rotation, planet.orbit)
	const pole = axis.y < 0 ? { x: -axis.x, y: -axis.y, z: -axis.z } : axis
	const position =
		planet.orbit === null ? { x: 0, y: 0, z: 1 } : propagate(planet.orbit, jd)
	// toward the Sun, flattened into the equator plane
	const sun = normalize({ x: -position.x, y: -position.y, z: -position.z })
	const along = sun.x * pole.x + sun.y * pole.y + sun.z * pole.z
	let flat = {
		x: sun.x - along * pole.x,
		y: sun.y - along * pole.y,
		z: sun.z - along * pole.z,
	}
	if (Math.hypot(flat.x, flat.y, flat.z) < 1e-6) flat = { x: 1, y: 0, z: 0 }
	const u = normalize(flat)
	const e = (SYSTEM_ELEVATION_DEG * Math.PI) / 180
	return normalize({
		x: Math.cos(e) * u.x + Math.sin(e) * pole.x,
		y: Math.cos(e) * u.y + Math.sin(e) * pole.y,
		z: Math.cos(e) * u.z + Math.sin(e) * pole.z,
	})
}

/**
 * The whole system shot (camera-controls angles: azimuth about +Y from +Z,
 * elevation above the ecliptic): `moonSystemDirection` at `jd`, from
 * `moonSystemShotDistance`.
 */
export function moonSystemShot(
	planet: FramedPlanet & Pick<Body, "rotation" | "orbit">,
	moons: readonly Pick<Body, "orbit">[],
	scale: ScaleSettings,
	aspect: number,
	jd: number,
	insets: Insets = NO_INSETS,
): CameraShot {
	const d = moonSystemDirection(planet, jd)
	return {
		azimuthDeg: radToDeg(Math.atan2(d.x, d.z)),
		elevationDeg: Math.min(
			MAX_SHOT_ELEVATION_DEG,
			radToDeg(Math.asin(Math.max(-1, Math.min(1, d.y)))),
		),
		distance: moonSystemShotDistance(planet, moons, scale, aspect, insets),
	}
}
