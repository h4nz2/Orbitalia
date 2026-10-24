/**
 * Which way a model faces and how Juno spins (#73): +Z at Earth or the Sun
 * for every craft, as drawn, +Y as close to ecliptic north as it can be
 * (also where +Z points at a pole), and a spin that follows the clock but
 * never strobes; Cassini drops Huygens on the day.
 */
import { describe, expect, it } from "vitest"

import { craftModelAt } from "@/data/spacecraftModels"
import { spacecraft } from "@/data/spacecraft"
import { isoToJD } from "@/sim/spacecraft"

import {
	CRAFT_MIN_SECONDS_PER_TURN,
	advanceCraftSpin,
	craftAttitude,
	createCraftSpin,
} from "./attitude"

const dot = (b: Float64Array, i: number, v: readonly number[]) =>
	b[i] * v[0] + b[i + 1] * v[1] + b[i + 2] * v[2]
const axis = (b: Float64Array, i: number) => [b[i], b[i + 1], b[i + 2]]

/** An orthonormal, right-handed basis (x = y × z). */
function expectFrame(b: Float64Array) {
	for (const i of [0, 3, 6]) expect(Math.hypot(...axis(b, i))).toBeCloseTo(1, 9)
	expect(dot(b, 0, axis(b, 3))).toBeCloseTo(0, 9)
	expect(dot(b, 0, axis(b, 6))).toBeCloseTo(0, 9)
	expect(dot(b, 3, axis(b, 6))).toBeCloseTo(0, 9)
	const [yx, yy, yz] = axis(b, 3)
	const [zx, zy, zz] = axis(b, 6)
	expect(b[0]).toBeCloseTo(yy * zz - yz * zy, 9)
	expect(b[1]).toBeCloseTo(yz * zx - yx * zz, 9)
	expect(b[2]).toBeCloseTo(yx * zy - yy * zx, 9)
}

describe("craftAttitude", () => {
	it("points +Z at the target and rolls +Y towards ecliptic north", () => {
		const basis = new Float64Array(9)
		for (const to of [
			[1, 0, 0],
			[0, 0, -3],
			[2, 0.5, 1],
			[-1, -0.8, 0.2],
		]) {
			expect(craftAttitude(to, basis)).toBe(true)
			expectFrame(basis)
			const length = Math.hypot(to[0], to[1], to[2])
			expect(dot(basis, 6, to) / length).toBeCloseTo(1, 9)
			// +Y in the plane of +Z and north, on north's side: as close to it as it can be
			expect(basis[4]).toBeGreaterThan(0)
			expect(dot(basis, 0, [0, 1, 0])).toBeCloseTo(0, 9)
		}
		// pointing along the ecliptic, +Y is north itself
		craftAttitude([0, 0, 5], basis)
		expect(basis[4]).toBeCloseTo(1, 12)
	})

	it("keeps the roll it had when +Z points at a pole (no spin round, no flip)", () => {
		const basis = new Float64Array(9)
		craftAttitude([1, 0, 0.0001], basis)
		const before = axis(basis, 3)
		expect(craftAttitude([0, 1, 0], basis)).toBe(true)
		expectFrame(basis)
		expect(basis[7]).toBeCloseTo(1, 12)
		// the old +Y projected onto the new plane: north swung over, still the same side
		expect(dot(basis, 3, before)).toBeLessThan(1)
		expect(basis[3] * before[0] + basis[5] * before[2]).toBeLessThanOrEqual(0)
		// straight down, from nothing held before: scene +X
		const fresh = new Float64Array(9)
		expect(craftAttitude([0, -2, 0], fresh)).toBe(true)
		expectFrame(fresh)
		expect(fresh[3]).toBeCloseTo(1, 12)
	})

	it("leaves the basis alone for a zero direction", () => {
		const basis = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
		expect(craftAttitude([0, 0, 0], basis)).toBe(false)
		expect([...basis]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
	})

	it("faces Earth with the dish, or the Sun with the shield and the arrays", () => {
		const jd = isoToJD("2030-01-01T00:00Z")
		const points = Object.fromEntries(
			spacecraft.map((craft) => [craft.id, craftModelAt(craft.id, jd)?.points]),
		)
		expect(points).toMatchObject({
			voyager1: "earth",
			voyager2: "earth",
			pioneer10: "earth",
			pioneer11: "earth",
			newHorizons: "earth",
			cassini: "earth",
			juno: "earth",
			parker: "sun",
			jwst: "sun",
			europaClipper: "sun",
		})
	})
})

describe("Cassini's models", () => {
	it("carries Huygens until 25 December 2004, 02:00 UTC, then flies without it", () => {
		expect(craftModelAt("cassini", isoToJD("2004-07-01T02:48Z"))?.id).toBe(
			"cassini",
		)
		expect(craftModelAt("cassini", isoToJD("2004-12-25T01:59Z"))?.id).toBe(
			"cassini",
		)
		expect(craftModelAt("cassini", isoToJD("2004-12-25T02:00Z"))?.id).toBe(
			"cassini-no-huygens",
		)
	})
})

describe("advanceCraftSpin", () => {
	const jd = 2457000.5
	const turn = 2 * Math.PI
	const minute = 1 / 1440

	it("turns with the clock at Juno's rate while that is watchable, backwards too", () => {
		const spin = createCraftSpin(jd, 0)
		// 2 rpm at real time: a sixtieth of a minute (1 s) is a thirtieth of a turn
		advanceCraftSpin(spin, jd + minute / 60, 1000, "realistic", 2)
		// (Julian Dates near 2.5 million carry a few microseconds of rounding)
		expect(spin.angle).toBeCloseTo(turn / 30, 4)
		advanceCraftSpin(spin, jd, 2000, "realistic", 2)
		expect(Math.min(spin.angle, turn - spin.angle)).toBeCloseTo(0, 4)
	})

	it("caps a fast clock at one turn per CRAFT_MIN_SECONDS_PER_TURN instead of strobing", () => {
		const spin = createCraftSpin(jd, 0)
		// a day per second: 2,880 turns in one second of real time, capped
		let realMs = 0
		let simJD = jd
		for (let frame = 0; frame < 60; frame++) {
			realMs += 1000 / 60
			simJD += 1 / 60
			const before = spin.angle
			advanceCraftSpin(spin, simJD, realMs, "realistic", 2)
			const step = (spin.angle - before + turn) % turn
			expect(step).toBeCloseTo(
				turn / 60 / CRAFT_MIN_SECONDS_PER_TURN.realistic,
				9,
			)
		}
		// slow and stopped slow it more, as they do the planets
		const slow = createCraftSpin(jd, 0)
		advanceCraftSpin(slow, jd + 1, 100, "slow", 2)
		expect(slow.angle).toBeCloseTo(
			(turn * 0.1) / CRAFT_MIN_SECONDS_PER_TURN.slow,
			9,
		)
		const stopped = createCraftSpin(jd, 0)
		advanceCraftSpin(stopped, jd + 1, 100, "stopped", 2)
		expect(stopped.angle).toBe(0)
	})

	it("turns a jump in time or a long frame gap by at most one capped frame", () => {
		const spin = createCraftSpin(jd, 0)
		advanceCraftSpin(spin, jd + 365, 60_000, "realistic", 2)
		expect(spin.angle).toBeCloseTo(
			(turn * 0.25) / CRAFT_MIN_SECONDS_PER_TURN.realistic,
			9,
		)
		expect(spin.angle).toBeGreaterThanOrEqual(0)
		expect(spin.angle).toBeLessThan(turn)
	})
})
