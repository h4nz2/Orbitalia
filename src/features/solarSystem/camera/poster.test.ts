/**
 * Poster on a laptop (#54): the whole-system view of the default overview
 * (home shot, `overviewDistance` with Poster's tight fit), projected the way
 * the camera does it. Every planet is measured wherever it is on its drawn
 * orbit (the far side, smallest on screen, included), so the numbers hold on
 * any date.
 */
import { describe, expect, it } from "vitest"

import { bodies, getBody, planets, sun, type Body } from "@/data"
import {
	SCALE_PRESETS,
	childDistanceCurve,
	degToRad,
	displayOffset,
	interpolateScale,
	mapDistance,
	propagate,
	toUnits,
	type ScaleSettings,
} from "@/sim"
import { HOME_SHOT } from "@/store/navigation"

import { createSimFrame } from "../scene/simFrame"
import {
	CAMERA_FOV_DEG,
	OVERVIEW_MARGIN,
	TIGHT_FIT_HEIGHT,
	TIGHT_FIT_WIDTH,
	fitDistance,
	overviewDistance,
	overviewRadius,
	tightFitDistance,
} from "./framing"

const POSTER = SCALE_PRESETS.poster

interface Screen {
	width: number
	height: number
}
const LAPTOP: Screen = { width: 1366, height: 768 }

/** A planet's drawn disc on screen, at `samples` places along its drawn orbit around the drawn Sun. */
function discsOnScreen(
	planet: Body,
	scale: ScaleSettings,
	screen: Screen,
	samples = 360,
) {
	const frame = createSimFrame(bodies, undefined, scale)
	const i = frame.index.get(planet.id) ?? -1
	const drawnRadius = frame.renderRadius(i)
	const aspect = screen.width / screen.height
	const d = overviewDistance(scale, CAMERA_FOV_DEG, aspect)
	// home shot: azimuth 0, elevation 45, looking at the Sun (the overview's pivot)
	const e = degToRad(HOME_SHOT.elevationDeg)
	const eye = [0, d * Math.sin(e), d * Math.cos(e)]
	const forward = [0, -Math.sin(e), -Math.cos(e)]
	const up = [0, Math.cos(e), -Math.sin(e)]
	const tanHalf = Math.tan(degToRad(CAMERA_FOV_DEG) / 2)
	const focal = screen.height / 2 / tanHalf
	const position = { x: 0, y: 0, z: 0 }
	const offset = new Float64Array(3)
	const discs: { diameterPx: number; x: number; y: number; r: number }[] = []
	const orbit = planet.orbit!
	for (let k = 0; k < samples; k++) {
		const jd = orbit.epochJD + (orbit.periodDays * k) / samples
		const at = propagate(orbit, jd, position)
		displayOffset(
			at.x,
			at.y,
			at.z,
			sun.radiusKm,
			sun.radiusKm,
			childDistanceCurve(scale, true),
			offset,
		)
		const p = [toUnits(offset[0]), toUnits(offset[1]), toUnits(offset[2])]
		const v = p.map((c, axis) => c - eye[axis])
		const depth = v[0] * forward[0] + v[1] * forward[1] + v[2] * forward[2]
		const range = Math.hypot(v[0], v[1], v[2])
		// the disc's angular size (a sphere looks no smaller off-axis), projected at its depth
		const angular = Math.asin(Math.min(1, drawnRadius / range))
		const r = (Math.tan(angular) * focal * range) / depth
		discs.push({
			diameterPx: 2 * Math.tan(angular) * focal,
			x: (v[0] / depth) * focal,
			y: ((v[0] * up[0] + v[1] * up[1] + v[2] * up[2]) / depth) * focal,
			r,
		})
	}
	return discs
}

/** The smallest a planet gets on screen along its orbit, px across. */
const smallestPx = (
	id: string,
	scale: ScaleSettings = POSTER,
	screen: Screen = LAPTOP,
) =>
	Math.min(
		...discsOnScreen(getBody(id), scale, screen).map((d) => d.diameterPx),
	)

describe("Poster on a 1366x768 laptop, the whole-system view (#54)", () => {
	it("draws Earth at least 12 px across wherever it is on its orbit", () => {
		expect(smallestPx("earth")).toBeGreaterThanOrEqual(12)
		// and on a 4:3 projector of the same height
		expect(
			smallestPx("earth", POSTER, { width: 1024, height: 768 }),
		).toBeGreaterThanOrEqual(12)
		// never below 10 px on a 720p screen
		expect(
			smallestPx("earth", POSTER, { width: 1280, height: 720 }),
		).toBeGreaterThanOrEqual(10)
	})

	it("makes every planet a disc of at least 9 px, Jupiter and Saturn the biggest", () => {
		const px = Object.fromEntries(
			planets.map((planet) => [planet.id, smallestPx(planet.id)]),
		)
		for (const planet of planets)
			expect(px[planet.id], planet.id).toBeGreaterThan(9)
		expect(px.jupiter).toBeGreaterThan(20)
		expect(px.saturn).toBeGreaterThan(18)
		for (const id of [
			"mercury",
			"venus",
			"earth",
			"mars",
			"uranus",
			"neptune",
		]) {
			expect(px.jupiter).toBeGreaterThan(px[id])
			expect(px.saturn).toBeGreaterThan(px[id])
		}
		// Saturn's rings: more than twice Jupiter across
		const saturn = getBody("saturn")
		const rings = (saturn.rings?.outerRadiusKm ?? 0) / saturn.radiusKm
		expect(rings * px.saturn).toBeGreaterThan(2 * px.jupiter)
	})

	it("shows the Sun big, at the centre", () => {
		const d = overviewDistance(POSTER, CAMERA_FOV_DEG, 1366 / 768)
		const focal = 768 / 2 / Math.tan(degToRad(CAMERA_FOV_DEG) / 2)
		const sunPx = 2 * Math.tan(Math.asin(toUnits(sun.radiusKm) / d)) * focal
		expect(sunPx).toBeGreaterThan(40)
		expect(sunPx).toBeGreaterThan(2 * smallestPx("jupiter"))
	})

	it("keeps every disc, Neptune's too, inside the screen and clear of the time bar", () => {
		for (const screen of [LAPTOP, { width: 1024, height: 768 }]) {
			for (const planet of planets) {
				for (const disc of discsOnScreen(planet, POSTER, screen, 180)) {
					expect(Math.abs(disc.x) + disc.r).toBeLessThan(screen.width / 2)
					// below the centre the time bar: the near edge stays within the tight fit's share
					expect(-disc.y + disc.r).toBeLessThanOrEqual(
						(TIGHT_FIT_HEIGHT * screen.height) / 2 + 0.5,
					)
					expect(disc.y + disc.r).toBeLessThan(screen.height / 2)
				}
			}
		}
	})

	it("is many times bigger on screen than Everything visible's planets", () => {
		const ev = SCALE_PRESETS.everythingVisible
		expect(smallestPx("earth")).toBeGreaterThan(10 * smallestPx("earth", ev))
		expect(smallestPx("jupiter")).toBeGreaterThan(5 * smallestPx("jupiter", ev))
	})
})

describe("the tight overview fit", () => {
	it("puts a disc's near edge at the tight share of the half-height, seen from the home elevation", () => {
		const r = 1
		const aspect = 16 / 9
		const d = tightFitDistance(r, 45, aspect)
		const e = degToRad(HOME_SHOT.elevationDeg)
		const tanNear = (r * Math.sin(e)) / (d - r * Math.cos(e))
		expect(tanNear).toBeCloseTo(TIGHT_FIT_HEIGHT * Math.tan(degToRad(22.5)), 12)
		// closer than the shared fit
		expect(d).toBeLessThan(fitDistance(OVERVIEW_MARGIN * r, 45, aspect))
	})

	it("fits the width instead on a portrait screen", () => {
		const r = 1
		const aspect = 9 / 19.5
		const d = tightFitDistance(r, 45, aspect)
		const e = degToRad(HOME_SHOT.elevationDeg)
		// the widest point, where the line of sight grazes the disc
		const tanSide = r / Math.sqrt(d * d - (r * Math.cos(e)) ** 2)
		expect(tanSide).toBeCloseTo(
			TIGHT_FIT_WIDTH * Math.tan(degToRad(22.5)) * aspect,
			12,
		)
	})

	it("is Poster's alone, and a switch glides the camera between the fits", () => {
		const aspect = 1366 / 768
		const shared = (scale: ScaleSettings) =>
			fitDistance(OVERVIEW_MARGIN * overviewRadius(scale), 45, aspect)
		for (const id of [
			"trueScale",
			"textbook",
			"bigPlanets",
			"everythingVisible",
		] as const) {
			const scale = SCALE_PRESETS[id]
			expect(overviewDistance(scale, 45, aspect)).toBe(shared(scale))
		}
		expect(overviewDistance(POSTER, 45, aspect)).toBe(
			tightFitDistance(overviewRadius(POSTER), 45, aspect),
		)
		// halfway through a switch, halfway between the two fits of the scale on screen
		const half = interpolateScale(SCALE_PRESETS.everythingVisible, POSTER, 0.5)
		expect(half.overviewFit).toBe(0.5)
		const tight = tightFitDistance(overviewRadius(half), 45, aspect)
		expect(overviewDistance(half, 45, aspect)).toBeCloseTo(
			(shared(half) + tight) / 2,
			6,
		)
	})

	it("includes the drawn disc of the farthest planet", () => {
		const neptune = getBody("neptune")
		const frame = createSimFrame(bodies, undefined, POSTER)
		const drawn = frame.renderRadius(frame.index.get("neptune") ?? -1)
		const aphelion =
			(neptune.orbit?.semiMajorAxisKm ?? 0) *
			(1 + (neptune.orbit?.eccentricity ?? 0))
		expect(overviewRadius(POSTER)).toBeCloseTo(
			toUnits(
				sun.radiusKm *
					mapDistance(POSTER.orbitDistance, aphelion / sun.radiusKm),
			) + drawn,
			9,
		)
	})
})
