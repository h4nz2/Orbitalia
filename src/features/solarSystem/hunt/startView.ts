/**
 * Where an Easy clue is asked from (#52): "Easy clues ask only for what can
 * be seen from where the hunt starts". That is the overview, with the names
 * on, or for a clue about moons the planet with its moons around it ("We are
 * at Jupiter."). Either way the answer is framed clear of the hunt panel in
 * the dock, so it is on screen without a single drag. The hunt asks the
 * navigation store for the view, like every feature: the camera has one
 * owner.
 */
import { bodyById, moonsOf, sun, type Body } from "@/data"
import {
	childDistanceCurve,
	degToRad,
	displayDistanceKm,
	propagate,
	toUnits,
	type ScaleSettings,
	type Vec3,
} from "@/sim"
import { HOME_SHOT } from "@/store/navigation"
import { useScaleStore } from "@/store/scale"
import { useSimStore } from "@/store/sim"

import {
	CAMERA_FOV_DEG,
	FRAMING_RADII,
	overviewDistance,
} from "../camera/framing"
import { prefersReducedMotion } from "../present/media"
import { SYSTEM_MARGIN, moonSystemShot } from "../ui/moonSystem"
import type { HuntQuestion } from "./hunts"

/**
 * How far from the centre of a `width` x `height` screen the scene is free
 * of docked panels, px, towards each side.
 */
export interface Clearance {
	width: number
	height: number
	left: number
	right: number
	up: number
	down: number
}

/** Room kept at the top and bottom for the HUD's bars (the picker, the time bar), px. */
export const BAR_ROOM_PX = 72
/** Room between the answer and a panel's edge, px. */
export const EDGE_ROOM_PX = 24

/**
 * The clearance left by the dock at `dock` (its rectangle on the screen;
 * null when empty): beside it (a panel at the right) or above it (a sheet
 * from the bottom on a phone), whichever leaves more.
 */
export function clearanceOf(
	width: number,
	height: number,
	dock: { left: number; top: number } | null,
): Clearance {
	const side = width / 2 - EDGE_ROOM_PX
	const bars = height / 2 - BAR_ROOM_PX
	const free = { width, height, left: side, right: side, up: bars, down: bars }
	if (dock === null) return free
	const beside = {
		...free,
		right: Math.max(1, Math.min(side, dock.left - width / 2 - EDGE_ROOM_PX)),
	}
	const above = {
		...free,
		down: Math.max(1, Math.min(bars, dock.top - height / 2 - EDGE_ROOM_PX)),
	}
	return roomOf(beside) >= roomOf(above) ? beside : above
}

/** The smallest of the four sides: what a round region about the centre can use. */
const roomOf = (clear: Clearance): number =>
	Math.min(clear.left, clear.right, clear.up, clear.down)

/**
 * The camera distance (in the units of `radius`) from which a sphere of
 * `radius` round the centre of the screen stays inside `clear`.
 */
export function clearFitDistance(
	radius: number,
	clear: Clearance,
	fovDeg = CAMERA_FOV_DEG,
): number {
	const tanHalf = Math.tan(degToRad(fovDeg) / 2)
	return (
		radius / Math.sin(Math.atan((tanHalf * roomOf(clear)) / (clear.height / 2)))
	)
}

/** Where `body` is drawn round the Sun at `jd`, scene units (the Sun itself: the origin). */
export function drawnPosition(
	body: Body,
	scale: ScaleSettings,
	jd: number,
): Vec3 {
	if (body.orbit === null || body.parentId !== sun.id)
		return { x: 0, y: 0, z: 0 }
	const p = propagate(body.orbit, jd)
	const km = Math.hypot(p.x, p.y, p.z)
	if (km === 0) return p
	const drawn =
		toUnits(
			displayDistanceKm(km, sun.radiusKm, sun.radiusKm, scale.orbitDistance),
		) / km
	return { x: p.x * drawn, y: p.y * drawn, z: p.z * drawn }
}

/**
 * Where a point drawn at `at` (scene units round the Sun) appears in the
 * overview, px from the centre of a screen `height` high (right and down
 * positive), the camera `distance` away from `HOME_SHOT`'s direction.
 */
export function overviewPx(
	at: Vec3,
	distance: number,
	height: number,
	fovDeg = CAMERA_FOV_DEG,
): { x: number; y: number } {
	const elevation = degToRad(HOME_SHOT.elevationDeg)
	const sin = Math.sin(elevation)
	const cos = Math.cos(elevation)
	// the camera looks from +z (azimuth 0), raised by the elevation
	const depth = Math.max(1e-9, distance - (at.z * cos + at.y * sin))
	const px = height / 2 / (depth * Math.tan(degToRad(fovDeg) / 2))
	return { x: at.x * px, y: (at.z * sin - at.y * cos) * px }
}

/**
 * The overview's shot distance (a multiple of the default, 1) that keeps
 * each point in `answers` (drawn positions) and a name of `label` px beside
 * it clear of the panels: 1 unless a panel would cover one.
 */
export function overviewShotDistance(
	answers: readonly Vec3[],
	scale: ScaleSettings,
	clear: Clearance,
	label: { width: number; height: number } = { width: 0, height: 0 },
): number {
	const base = overviewDistance(
		scale,
		CAMERA_FOV_DEG,
		clear.width / clear.height,
	)
	let distance = 1
	for (const at of answers) {
		const { x, y } = overviewPx(at, base, clear.height)
		const across = x >= 0 ? clear.right : clear.left
		const along = y >= 0 ? clear.down : clear.up
		// backing off by k divides the offset by about k; the name keeps its size
		const roomX = Math.max(1, across - label.width)
		const roomY = Math.max(1, along - label.height)
		distance = Math.max(distance, Math.abs(x) / roomX, Math.abs(y) / roomY)
	}
	return distance
}

/**
 * The moons framed for a clue about `answers` at `planet`: the featured
 * moons out to the first one beyond the answers, so the answer has company
 * to be told apart from, and big enough to see.
 */
export function framedMoons(planet: Body, answers: readonly string[]): Body[] {
	const featured = moonsOf(planet.id).filter((moon) => moon.featured)
	const last = Math.max(
		...answers.map((id) => featured.findIndex((moon) => moon.id === id)),
	)
	return last < 0 ? featured : featured.slice(0, last + 2)
}

/** The shot distance (default framings of `planet`) that keeps `moons` clear of the panel. */
export function moonsShotDistance(
	planet: Body,
	moons: readonly Body[],
	scale: ScaleSettings,
	clear: Clearance,
): number {
	const curve = childDistanceCurve(scale, planet.parentId === null)
	let radii = 0
	for (const moon of moons) {
		if (moon.orbit === null) continue
		const apoapsisKm =
			moon.orbit.semiMajorAxisKm * (1 + moon.orbit.eccentricity)
		radii = Math.max(
			radii,
			displayDistanceKm(apoapsisKm, planet.radiusKm, 1, curve),
		)
	}
	if (radii === 0) return 1
	return Math.max(
		1,
		clearFitDistance(SYSTEM_MARGIN * radii, clear) / FRAMING_RADII,
	)
}

/**
 * The room the answer's name takes beside it, px: its label as drawn now,
 * plus the picture an Easy clue adds (about two letters wide).
 */
function labelRoom(id: string): { width: number; height: number } {
	const label = document.querySelector<HTMLElement>(
		`[data-label-layer] [data-body="${id}"]`,
	)
	const font =
		label === null ? 16 : parseFloat(getComputedStyle(label).fontSize)
	return {
		width: (label?.offsetWidth || 4 * font) + 2.4 * font,
		height: 1.6 * font,
	}
}

/** The screen's clearance now: the viewport beside the dock's panels. */
function clearanceNow(): Clearance {
	const width = window.innerWidth || 1
	const height = window.innerHeight || 1
	const dock = document.querySelector<HTMLElement>('[data-testid="dock"]')
	const rect = dock?.getBoundingClientRect()
	return clearanceOf(
		width,
		height,
		rect === undefined || rect.width === 0 || rect.height === 0 ? null : rect,
	)
}

/**
 * Takes the camera to where an Easy clue is asked from: names on, nothing
 * selected, the Sun in the middle; then the overview, or the planet `at`
 * with its moons (the Moons layer on). Reduced motion jumps.
 */
export function goToStart(question: HuntQuestion, sim = useSimStore): void {
	const store = sim.getState()
	const scale = useScaleStore.getState().scale
	const clear = clearanceNow()
	const jump = prefersReducedMotion()
	if (!store.showLabels) store.setShowLabels(true)
	const planet = question.at === undefined ? null : bodyById.get(question.at)
	if (planet === null || planet === undefined) {
		const answers = question.answers.flatMap((id) => {
			const body = bodyById.get(id)
			return body === undefined
				? []
				: [drawnPosition(body, scale, store.simTimeJD)]
		})
		store.reset()
		const distance = overviewShotDistance(
			answers,
			scale,
			clear,
			labelRoom(question.answers[0]),
		)
		if (distance > 1 || jump) {
			sim.getState().overview({
				shot: { distance },
				durationMs: jump ? 0 : undefined,
			})
		}
		return
	}
	if (!store.showMoons) store.setShowMoons(true)
	store.reset()
	const moons = framedMoons(planet, question.answers)
	const shot = moonSystemShot(
		planet,
		moons,
		scale,
		clear.width / clear.height,
		store.simTimeJD,
	)
	sim.getState().goTo(
		{ kind: "body", id: planet.id },
		{
			shot: {
				...shot,
				distance: Math.max(
					shot.distance,
					moonsShotDistance(planet, moons, scale, clear),
				),
			},
			durationMs: jump ? 0 : undefined,
		},
	)
}
