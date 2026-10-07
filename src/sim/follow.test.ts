/**
 * The pure parts of riding along with a spacecraft (#57): the speeds a
 * passage is watched at, the direction it is watched from, and the local
 * scale a following camera rescales with. Against the real trajectories:
 * src/data/spacecraftFollow.test.ts.
 */
import { describe, expect, it } from "vitest"

import { SCALE_PRESETS, SECONDS_PER_DAY } from "@/sim"

import {
	WATCH_MAX_SECONDS,
	WATCH_MIN_SECONDS,
	WATCH_ELEVATION_DEG,
	WATCH_TILT_DEG,
	WATCH_WARPS,
	craftLengthScale,
	isWatchedKind,
	watchDirection,
	watchWarp,
} from "./follow"

const sun = { radiusKm: 695700 }
const jupiter = { radiusKm: 69911 }

describe("watch speeds", () => {
	it("are never more than 1.5 times apart, so one is within 20 % of half a minute", () => {
		for (let k = 1; k < WATCH_WARPS.length; k++) {
			expect(WATCH_WARPS[k] / WATCH_WARPS[k - 1]).toBeLessThanOrEqual(1.5)
		}
	})

	it("show any passage from minutes to years of clock time in 20 to 40 s", () => {
		for (let days = 10 / 1440; days < 3000; days *= 1.07) {
			const seconds = (days * SECONDS_PER_DAY) / watchWarp(days)
			expect(seconds).toBeGreaterThanOrEqual(WATCH_MIN_SECONDS)
			expect(seconds).toBeLessThanOrEqual(WATCH_MAX_SECONDS)
		}
	})

	it("are whole minutes, hours, days, weeks or months per second from 2 min/s up", () => {
		const units = [60, 3600, 86400, 604800, 2629800]
		for (const warp of WATCH_WARPS.filter((w) => w >= 120)) {
			expect(
				units.some((unit) => warp % unit === 0),
				`${warp}`,
			).toBe(true)
		}
	})

	it("are offered for flybys and arrivals only", () => {
		expect(isWatchedKind("flyby")).toBe(true)
		expect(isWatchedKind("orbitInsertion")).toBe(true)
		expect(isWatchedKind("arrival")).toBe(true)
		expect(isWatchedKind("launch")).toBe(false)
		expect(isWatchedKind("heliopause")).toBe(false)
	})
})

describe("the watch direction", () => {
	it("sees a passage in the plane of the planets from above, the planet to the right at closest approach", () => {
		// a flyby in the ecliptic: normal +Y, periapsis towards +X (the planet at -X from the craft)
		const p = Float64Array.of(1, 0, 0)
		for (const h of [Float64Array.of(0, 1, 0), Float64Array.of(0, -1, 0)]) {
			const { azimuthDeg, elevationDeg } = watchDirection({ h, p })
			expect(elevationDeg).toBe(WATCH_ELEVATION_DEG)
			// camera-controls' screen right is (cos az, 0, -sin az)
			const az = (azimuthDeg * Math.PI) / 180
			expect(Math.cos(az)).toBeCloseTo(-1, 9)
			expect(-Math.sin(az)).toBeCloseTo(0, 9)
		}
	})

	it("sees a steep passage from above its own plane, tilted towards the planet", () => {
		// a flyby over a pole: normal along +X, periapsis towards +Y
		const { elevationDeg } = watchDirection({
			h: Float64Array.of(1, 0, 0),
			p: Float64Array.of(0, 1, 0),
		})
		expect(elevationDeg).toBeCloseTo(-WATCH_TILT_DEG, 6)
	})
})

describe("the local scale round a craft", () => {
	it("is 1 at true scale, wherever the craft is", () => {
		for (const w of [0, 0.5, 1]) {
			expect(
				craftLengthScale(SCALE_PRESETS.trueScale, sun, 7.8e8, jupiter, 1e6, w),
			).toBeCloseTo(1, 12)
		}
	})

	it("is the moon curve's near a planet and the Sun-centred map's far from it, blended", () => {
		const scale = SCALE_PRESETS.everythingVisible
		const near = craftLengthScale(scale, sun, 7.8e8, jupiter, 3.5e5, 1)
		const far = craftLengthScale(scale, sun, 7.8e8, jupiter, 3.5e5, 0)
		const half = craftLengthScale(scale, sun, 7.8e8, jupiter, 3.5e5, 0.5)
		// Jupiter's neighbourhood is drawn bigger than true, the space between the planets smaller
		expect(near).toBeGreaterThan(1)
		expect(far).toBeLessThan(0.1)
		expect(half).toBeCloseTo(Math.sqrt(near * far), 9)
		expect(craftLengthScale(scale, sun, 7.8e8, null, 0, 1)).toBeCloseTo(far, 12)
	})
})
