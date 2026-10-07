/**
 * The camera's numbers (docs/ARCHITECTURE.md, "Camera"), kept free of React and
 * drei so the rules can be unit-tested: near/far planes, dolly limits and the
 * default framing distance of every view. Every size and distance here is a
 * drawn one (the active scale's, docs/ARCHITECTURE.md "Scale"), read from the
 * SimFrame, never a true one.
 */
import { planets, sun } from "@/data"
import {
	degToRad,
	displayDistanceKm,
	displayRadiusKm,
	toUnits,
	type ScaleSettings,
} from "@/sim"
import { HOME_SHOT, type View, viewBodyId } from "@/store/navigation"

import type { SimFrame } from "../scene/simFrame"

/**
 * Near plane, scene units (10 m). The logarithmic depth buffer's resolution
 * depends on the far plane alone, so a tiny near plane costs nothing, and it
 * has to be smaller than the gap between the eye and the surface of the
 * smallest moon (0.3 km) at the closest dolly.
 */
export const CAMERA_NEAR = 1e-5
export const CAMERA_FAR = 1e9
export const CAMERA_FOV_DEG = 45
/**
 * Farthest dolly, scene units (1e11 km, about 670 AU): room to back out of
 * the true-scale overview, which frames Neptune's orbit from 100 AU
 * (landscape) to about 250 AU (a tall phone).
 */
export const CAMERA_MAX_DISTANCE = toUnits(1e11)
/** Closest dolly, in focus radii. */
export const MIN_DISTANCE_RADII = 1.2
/** Default distance of a focused body, in its drawn radii. */
export const FRAMING_RADII = 6
/**
 * A followed spacecraft's `distance: 1` (#57), scene units: a million drawn
 * km in every preset. The camera keeps its own distance from a craft (it is
 * not a multiple of the neighbourhood's size), so it never jumps when the
 * craft leaves a planet behind; a scale change rescales it with the drawing
 * round the craft (`craftLengthScale` in src/sim/follow.ts).
 */
export const CRAFT_FRAMING_DISTANCE = toUnits(1e6)
/** Closest dolly to a followed spacecraft, scene units (100 km): it has no size to stop at. */
export const CRAFT_MIN_DISTANCE = toUnits(100)
export const CAMERA_SMOOTH_TIME_S = 0.4
/**
 * Room around the planetary system in the overview, so the HUD panels at the
 * top and bottom of the screen do not cover the outermost orbit.
 */
export const OVERVIEW_MARGIN = 1.3

/** What framing reads from the SimFrame: the drawn radii and the active scale. */
export type FramingFrame = Pick<SimFrame, "index" | "renderRadius" | "scale">

/**
 * The tight overview fit (#54, Poster, `overviewFit` 1): the share of the
 * half-height the drawn system's near edge may reach, seen from the home
 * elevation (the rest is the time bar's), and of the half-width its sides may.
 */
export const TIGHT_FIT_HEIGHT = 0.85
export const TIGHT_FIT_WIDTH = 0.9

/**
 * Radius of the region the overview shows under `scale`: the farthest
 * planet's aphelion as drawn plus its drawn disc (#54: an enlarged Neptune is
 * not cut off at the edge), scene units. The Sun (the root) keeps its true
 * size in every scale, so it is the parent radius on both sides.
 */
export const overviewRadius = (scale: ScaleSettings): number =>
	Math.max(
		...planets.map((planet) =>
			planet.orbit === null
				? 0
				: toUnits(
						displayDistanceKm(
							planet.orbit.semiMajorAxisKm * (1 + planet.orbit.eccentricity),
							sun.radiusKm,
							sun.radiusKm,
							scale.orbitDistance,
						) + displayRadiusKm(planet.radiusKm, sun.radiusKm, scale.bodySize),
					),
		),
	)

/**
 * Closest the eye may come to the focus centre, scene units: 1.2 radii, but
 * never so close that the surface crosses the near plane (two near planes of
 * clearance), so sub-kilometre moons can be inspected without being clipped.
 */
export const minDollyDistance = (radiusUnits: number): number =>
	Math.max(MIN_DISTANCE_RADII * radiusUnits, radiusUnits + 2 * CAMERA_NEAR)

/**
 * Distance from which a sphere of `radius` exactly fills the narrower of the
 * two fields of view (vertical `fovDeg`, horizontal from `aspect`).
 */
export function fitDistance(
	radius: number,
	fovDeg: number,
	aspect: number,
): number {
	const halfVertical = degToRad(fovDeg) / 2
	const halfHorizontal = Math.atan(
		Math.tan(halfVertical) * (aspect > 0 ? aspect : 1),
	)
	return radius / Math.sin(Math.min(halfVertical, halfHorizontal))
}

/**
 * Distance from which a flat disc of `radius` in the ecliptic, seen from
 * `elevationDeg` toward its centre, fills the view as tightly as the HUD
 * allows: its near edge at `TIGHT_FIT_HEIGHT` of the half-height, its widest
 * points at `TIGHT_FIT_WIDTH` of the half-width (#54). Closer than the shared
 * fit, which fits a sphere around the system from any direction; tilting the
 * camera steeper than the home shot brings the near edge closer to the bottom.
 */
export function tightFitDistance(
	radius: number,
	fovDeg: number,
	aspect: number,
	elevationDeg: number = HOME_SHOT.elevationDeg,
): number {
	const tanHalf = Math.tan(degToRad(fovDeg) / 2)
	const v = TIGHT_FIT_HEIGHT * tanHalf
	const h = TIGHT_FIT_WIDTH * tanHalf * (aspect > 0 ? aspect : 1)
	const e = degToRad(elevationDeg)
	// the near edge is seen at tan = r sin e / (d - r cos e) below the centre
	const near = radius * (Math.cos(e) + Math.sin(e) / v)
	// the widest points (where the line of sight grazes the disc) at tan = r / sqrt(d^2 - r^2 cos^2 e)
	const side = radius * Math.sqrt(1 / (h * h) + Math.cos(e) ** 2)
	return Math.max(near, side)
}

/**
 * The overview's default distance: the whole planetary system on screen. The
 * shared fit puts a sphere `OVERVIEW_MARGIN` times the drawn system into the
 * narrower field of view; a scale with `overviewFit` (Poster, #54) blends
 * toward `tightFitDistance`, so a switch glides the camera there.
 */
export function overviewDistance(
	scale: ScaleSettings,
	fovDeg: number,
	aspect: number,
): number {
	const radius = overviewRadius(scale)
	const shared = fitDistance(OVERVIEW_MARGIN * radius, fovDeg, aspect)
	const fit = scale.overviewFit ?? 0
	if (!(fit > 0)) return shared
	const tight = tightFitDistance(radius, fovDeg, aspect)
	return shared + (tight - shared) * Math.min(1, fit)
}

/** Drawn radius (scene units) of the body a view is centred on; the Sun for unknown ids. */
export const viewRadius = (view: View, frame: FramingFrame): number =>
	frame.renderRadius(
		frame.index.get(viewBodyId(view)) ?? frame.index.get(sun.id) ?? 0,
	)

/**
 * The distance a shot's `distance: 1` stands for, scene units: the whole
 * system for the overview and for a point in interplanetary space (a point
 * anchored to the Sun, #15), `FRAMING_RADII` drawn radii of the body (or of
 * the anchor of a point in its neighbourhood) otherwise, so Jupiter and
 * Mercury fill the same share of the screen; a fixed distance for a
 * followed spacecraft (`CRAFT_FRAMING_DISTANCE`).
 */
export function defaultDistance(
	view: View,
	frame: FramingFrame,
	fovDeg: number,
	aspect: number,
): number {
	if (view.kind === "craft") return CRAFT_FRAMING_DISTANCE
	if (
		view.kind === "overview" ||
		(view.kind === "point" && view.anchorId === sun.id)
	) {
		return overviewDistance(frame.scale, fovDeg, aspect)
	}
	return FRAMING_RADII * viewRadius(view, frame)
}

/**
 * Closest dolly for a view: the body's `minDollyDistance`, so the limits
 * follow whatever is at the centre. A point in empty space takes its anchor's
 * (the body whose neighbourhood it is in): around the Sun that stops a dolly
 * into empty interplanetary space at a sensible distance instead of creeping
 * towards the pivot forever, near Mercury it lets the camera come close.
 * A followed spacecraft has a fixed one, which does not change with the
 * neighbourhood it flies through (#57).
 */
export const minViewDistance = (view: View, frame: FramingFrame): number =>
	view.kind === "craft"
		? CRAFT_MIN_DISTANCE
		: minDollyDistance(viewRadius(view, frame))
