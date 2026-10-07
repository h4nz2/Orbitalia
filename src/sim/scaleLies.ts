/**
 * The scale experience's vocabulary (#21): which lies a preset tells, and how
 * far from the truth a given body is drawn under a scale.
 *
 * "Sizes and distances are separate lies": every preset is one cell of a
 * two-by-two grid, sizes true or enlarged times distances true or squeezed,
 * so a user can hold one lie and switch the other. The squeeze is tuned to
 * the sizes (enlarged moon systems need room between the planets, true-size
 * planets can sit close to the Sun like a textbook diagram), which is why the
 * grid names presets instead of combining factors.
 *
 * Poster (#54) tells both lies harder than any cell and sits beside the grid:
 * it has the lies of Everything visible (enlarged, squeezed) but is not their
 * cell, so `presetForLies` never returns it and the switches name no cell
 * while it is on (`isGridPreset`).
 *
 * The distortion of a body is what the honesty statement shows ("Earth is
 * drawn 10x too big, 13x too close to the Sun"): measured in kilometres, drawn
 * against true, so it holds whatever the camera does.
 *
 * Pure: no React, no three.js.
 */
import type { OrbitingBody } from "./positions"
import {
	childDistanceCurve,
	displayDistanceKm,
	displayMoonRadiusKm,
	displayRadiusKm,
	type ScalableBody,
	type ScalePresetId,
	type ScaleSettings,
} from "./scale"

export type SizeLie = "true" | "enlarged"
export type DistanceLie = "true" | "squeezed"

/** The two separate lies a preset tells. */
export interface ScaleLies {
	readonly sizes: SizeLie
	readonly distances: DistanceLie
}

/**
 * The lies every preset tells: for the four presets of the sizes x distances
 * grid their cell (one preset per cell); Poster tells Everything visible's,
 * further (see `isGridPreset`).
 */
export const SCALE_LIES: Readonly<Record<ScalePresetId, ScaleLies>> =
	Object.freeze({
		trueScale: Object.freeze({ sizes: "true", distances: "true" }),
		textbook: Object.freeze({ sizes: "true", distances: "squeezed" }),
		bigPlanets: Object.freeze({ sizes: "enlarged", distances: "true" }),
		everythingVisible: Object.freeze({
			sizes: "enlarged",
			distances: "squeezed",
		}),
		poster: Object.freeze({ sizes: "enlarged", distances: "squeezed" }),
	})

/** The presets beside the grid (#54): they tell a cell's lies but are not its preset. */
const BESIDE_GRID: ReadonlySet<ScalePresetId> = new Set(["poster"])

/** Whether the preset is a cell of the sizes x distances grid (false for Poster). */
export const isGridPreset = (id: ScalePresetId): boolean => !BESIDE_GRID.has(id)

/** The grid preset that tells exactly these lies. */
export function presetForLies(lies: ScaleLies): ScalePresetId {
	for (const [id, cell] of Object.entries(SCALE_LIES) as [
		ScalePresetId,
		ScaleLies,
	][]) {
		if (
			isGridPreset(id) &&
			cell.sizes === lies.sizes &&
			cell.distances === lies.distances
		) {
			return id
		}
	}
	// unreachable while the grid is complete (guarded by scaleLies.test.ts)
	throw new Error(`scale: no preset for ${lies.sizes}/${lies.distances}`)
}

/** How far from true one body is drawn. */
export interface BodyDistortion {
	/** Drawn radius over true radius: 1 is true, 10 is "ten times too big". */
	readonly size: number
	/**
	 * Drawn distance from its parent over the true one, at the mean distance
	 * (semi-major axis): 1 is true, below 1 too close, above 1 too far.
	 * 1 for a body without an orbit (the root).
	 */
	readonly distance: number
}

type DistortedBody = ScalableBody & Pick<OrbitingBody, "orbit">

/**
 * How far from true `body` is drawn under `scale`, in kilometres drawn per
 * kilometre true.
 *
 * @param parent       the body's parent (null for the root)
 * @param rootRadiusKm the root's radius (the Sun, the ruler of every size)
 */
export function bodyDistortion(
	body: DistortedBody,
	parent: ScalableBody | null,
	rootRadiusKm: number,
	scale: ScaleSettings,
): BodyDistortion {
	// the parent's drawn radius: moons here are the planets' (and dwarf planets') moons, one level deep
	const parentDrawn =
		parent === null
			? 0
			: displayRadiusKm(parent.radiusKm, rootRadiusKm, scale.bodySize)
	const drawnRadius =
		parent === null || parent.parentId === null
			? displayRadiusKm(body.radiusKm, rootRadiusKm, scale.bodySize)
			: displayMoonRadiusKm(
					body.radiusKm,
					parent.radiusKm,
					parentDrawn,
					rootRadiusKm,
					scale,
				)
	const size = drawnRadius / body.radiusKm
	const a = body.orbit?.semiMajorAxisKm ?? 0
	if (parent === null || !(a > 0)) return { size, distance: 1 }
	const drawn = displayDistanceKm(
		a,
		parent.radiusKm,
		parentDrawn,
		childDistanceCurve(scale, parent.parentId === null),
	)
	return { size, distance: drawn / a }
}
