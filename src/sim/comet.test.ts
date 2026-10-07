import { describe, expect, it } from "vitest"

import { bodies, getBody } from "@/data"

import {
	DUST_BETA,
	activityAt,
	antiSunDirection,
	cometActivity,
	cometVelocity,
	dustAgeDays,
	dustTailLengthKm,
	grainOffsetKm,
	ionTailLengthKm,
	nextPerihelionJD,
	orbitMu,
	previousPerihelionJD,
	propagateState,
} from "./comet"
import { propagate, type OrbitElements, type Vec3 } from "./kepler"
import { AU_KM } from "./units"

const halley = getBody("halley")
const encke = getBody("encke")
const comets = bodies.filter((body) => body.tail !== undefined)
const tail = {
	onsetKm: 4 * AU_KM,
	fullKm: 1.5 * AU_KM,
	ionLengthKm: 1e7,
	dustLengthKm: 4e6,
}

const distanceAt = (orbit: OrbitElements, jd: number): number => {
	const p: Vec3 = { x: 0, y: 0, z: 0 }
	propagate(orbit, jd, p)
	return Math.hypot(p.x, p.y, p.z)
}

/** The day a comet crosses `km` from the Sun on its way in to the perihelion at `perihelionJD`. */
const inbound = (orbit: OrbitElements, perihelionJD: number, km: number) => {
	let far = perihelionJD - orbit.periodDays / 2
	let near = perihelionJD
	for (let k = 0; k < 60; k++) {
		const mid = (far + near) / 2
		if (distanceAt(orbit, mid) > km) far = mid
		else near = mid
	}
	return near
}

describe("comet activity and tail length", () => {
	it("is asleep beyond the comet's onset and fully active inside its full distance", () => {
		expect(cometActivity(tail, tail.onsetKm)).toBe(0)
		expect(cometActivity(tail, 30 * AU_KM)).toBe(0)
		expect(cometActivity(tail, tail.fullKm)).toBe(1)
		expect(cometActivity(tail, 0.3 * AU_KM)).toBe(1)
		expect(cometActivity(tail, Number.NaN)).toBe(0)
	})

	it("rises smoothly and monotonically on the way in", () => {
		let previous = 0
		for (let au = 6; au >= 0.2; au -= 0.01) {
			const activity = cometActivity(tail, au * AU_KM)
			expect(activity, `${au.toFixed(2)} AU`).toBeGreaterThanOrEqual(previous)
			// no jumps: at most a few percent per 0.01 AU
			expect(activity - previous, `${au.toFixed(2)} AU`).toBeLessThan(0.03)
			previous = activity
		}
	})

	it("switches every comet on at its own distance, each with its source in the data", () => {
		for (const comet of comets) {
			const t = comet.tail!
			expect(cometActivity(t, t.onsetKm * 1.001), comet.id).toBe(0)
			expect(cometActivity(t, t.onsetKm * 0.98), comet.id).toBeGreaterThan(0)
			// and in time: asleep just before it crosses its onset on the way in, awake just after
			const q = previousPerihelionJD(comet.orbit!, 2461308.5)
			const wakes = inbound(comet.orbit!, q, t.onsetKm) + (t.lagDays ?? 0)
			expect(activityAt(comet.orbit!, t, wakes - 2), comet.id).toBe(0)
			expect(activityAt(comet.orbit!, t, wakes + 20), comet.id).toBeGreaterThan(
				0,
			)
		}
		const onsetAu = (id: string) => getBody(id).tail!.onsetKm / AU_KM
		// big Hale-Bopp was active beyond Jupiter, little Encke only wakes up near the Sun
		expect(onsetAu("halebopp")).toBeGreaterThan(6)
		expect(onsetAu("encke")).toBeLessThan(2)
		expect(onsetAu("halebopp")).toBeGreaterThan(onsetAu("halley"))
		expect(onsetAu("halley")).toBeGreaterThan(onsetAu("encke"))
		expect(new Set(comets.map((comet) => comet.tail!.onsetKm)).size).toBe(
			comets.length,
		)
	})

	it("grows the tails with activity and stops at the longest tail observed", () => {
		expect(ionTailLengthKm(tail, 0)).toBe(0)
		expect(ionTailLengthKm(tail, 0.5)).toBe(5e6)
		expect(ionTailLengthKm(tail, 1)).toBe(1e7)
		expect(ionTailLengthKm(tail, 3)).toBe(1e7)
		expect(dustTailLengthKm(tail, 1)).toBe(4e6)
		for (const comet of comets) {
			const { orbit } = comet
			const t = comet.tail!
			const q = previousPerihelionJD(orbit!, 2461308.5)
			let longest = 0
			for (let days = -400; days <= 400; days += 2) {
				const activity = activityAt(orbit!, t, q + days)
				longest = Math.max(longest, ionTailLengthKm(t, activity))
			}
			expect(longest, comet.id).toBeLessThanOrEqual(t.ionLengthKm)
		}
	})

	it("lets a comet that is most active after perihelion answer to where it was earlier", () => {
		const comet = getBody("67p")
		const t = comet.tail!
		expect(t.lagDays).toBeGreaterThan(0)
		const q = previousPerihelionJD(comet.orbit!, 2461308.5)
		// the same distance before and after perihelion: more active on the way out
		const at = 60
		expect(
			Math.abs(
				distanceAt(comet.orbit!, q - at) - distanceAt(comet.orbit!, q + at),
			) / AU_KM,
		).toBeLessThan(0.01)
		expect(activityAt(comet.orbit!, t, q + at)).toBeGreaterThan(
			activityAt(comet.orbit!, t, q - at),
		)
	})
})

describe("perihelion passages", () => {
	it("puts Halley's perihelia on 9 Feb 1986 and 28 Jul 2061", () => {
		// 1986-02-09.47 TDB and 2061-07-28 (the predicted return)
		expect(nextPerihelionJD(halley.orbit!, 2446066.5)).toBeCloseTo(
			2446469.97,
			0,
		)
		expect(nextPerihelionJD(halley.orbit!, 2461308.5)).toBeCloseTo(2474034, 0)
		expect(previousPerihelionJD(halley.orbit!, 2461308.5)).toBeCloseTo(
			2446469.97,
			0,
		)
	})

	it("brings Encke back every 3.3 years, next in early 2027", () => {
		const next = nextPerihelionJD(encke.orbit!, 2461308.5)
		// 2027-02-09 +- a week (JPL: 2027-Feb-09)
		expect(Math.abs(next - 2461445.5)).toBeLessThan(7)
		expect(nextPerihelionJD(encke.orbit!, next + 1) - next).toBeCloseTo(
			encke.orbit!.periodDays,
			3,
		)
	})

	it("reaches Halley's perihelion distance of 0.575 AU", () => {
		expect(distanceAt(halley.orbit!, 2446469.97) / AU_KM).toBeCloseTo(0.575, 3)
	})
})

describe("the tail points away from the Sun", () => {
	const direction = new Float64Array(3)
	const sun = new Float64Array(3)

	/** Dot product of the anti-Sun direction and the comet's velocity at `jd`. */
	const tailAlongMotion = (jd: number): number => {
		const now: Vec3 = { x: 0, y: 0, z: 0 }
		const later: Vec3 = { x: 0, y: 0, z: 0 }
		propagate(halley.orbit!, jd, now)
		propagate(halley.orbit!, jd + 0.01, later)
		antiSunDirection([now.x, now.y, now.z], 0, sun, 0, direction)
		const v = [later.x - now.x, later.y - now.y, later.z - now.z]
		const speed = Math.hypot(v[0], v[1], v[2])
		return (
			(direction[0] * v[0] + direction[1] * v[1] + direction[2] * v[2]) / speed
		)
	}

	it("trails the comet on the way in and leads it on the way out", () => {
		// a month before and after the 1986 perihelion
		expect(tailAlongMotion(2446440)).toBeLessThan(-0.3)
		expect(tailAlongMotion(2446500)).toBeGreaterThan(0.3)
	})

	it("is a unit vector from the Sun through the comet", () => {
		const d = antiSunDirection([3, 4, 0], 0, [0, 0, 0], 0, direction)
		expect(d).toBe(5)
		expect(direction[0]).toBeCloseTo(0.6, 12)
		expect(direction[1]).toBeCloseTo(0.8, 12)
		expect(direction[2]).toBe(0)
		expect(antiSunDirection([1, 1, 1], 0, [1, 1, 1], 0, direction)).toBe(0)
		expect([...direction]).toEqual([0, 0, 0])
	})
})

/** The state of a comet (km, km/day) at `jd`. */
const stateAt = (orbit: OrbitElements, jd: number) => {
	const p: Vec3 = { x: 0, y: 0, z: 0 }
	propagate(orbit, jd, p)
	const position = new Float64Array([p.x, p.y, p.z])
	const velocity = new Float64Array(3)
	cometVelocity(orbit, jd, velocity)
	return { position, velocity }
}

/** A grain of `beta` integrated step by step (RK4) from the comet's state `ageDays` before `jd`. */
function integratedGrain(
	orbit: OrbitElements,
	jd: number,
	beta: number,
	ageDays: number,
): Float64Array {
	const { position, velocity } = stateAt(orbit, jd - ageDays)
	const mu = (1 - beta) * orbitMu(orbit)
	const steps = 4000
	const h = ageDays / steps
	let p = [...position]
	let v = [...velocity]
	const acc = (x: number[]) => {
		const r = Math.hypot(x[0], x[1], x[2])
		return x.map((c) => (-mu * c) / (r * r * r))
	}
	const plus = (a: number[], b: number[], k: number) =>
		a.map((c, i) => c + k * b[i])
	for (let s = 0; s < steps; s++) {
		const a1 = acc(p)
		const v1 = v
		const v2 = plus(v, a1, h / 2)
		const a2 = acc(plus(p, v1, h / 2))
		const v3 = plus(v, a2, h / 2)
		const a3 = acc(plus(p, v2, h / 2))
		const v4 = plus(v, a3, h)
		const a4 = acc(plus(p, v3, h))
		p = p.map((c, i) => c + (h / 6) * (v1[i] + 2 * v2[i] + 2 * v3[i] + v4[i]))
		v = v.map((c, i) => c + (h / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i]))
	}
	const now = stateAt(orbit, jd).position
	return new Float64Array([p[0] - now[0], p[1] - now[1], p[2] - now[2]])
}

describe("the dust tail's curve (a syndyne)", () => {
	it("moves a body along its own orbit, forwards and backwards", () => {
		const orbit = halley.orbit!
		const jd = 2446469.97
		const { position, velocity } = stateAt(orbit, jd)
		const out = new Float64Array(3)
		for (const days of [-60, -5, 3, 40]) {
			propagateState(position, velocity, orbitMu(orbit), days, out)
			const expected = stateAt(orbit, jd + days).position
			const off = Math.hypot(
				out[0] - expected[0],
				out[1] - expected[1],
				out[2] - expected[2],
			)
			expect(off / Math.hypot(...expected), `${days} d`).toBeLessThan(1e-6)
		}
		// nothing pulling: a straight line
		propagateState([1, 2, 3], [1, 0, -1], 0, 2, out)
		expect([...out]).toEqual([3, 2, 1])
	})

	it("matches dust grains followed step by step, even round NEOWISE's close perihelion", () => {
		for (const [id, jd] of [
			["neowise", 2459034.18 + 5],
			["halley", 2446469.97],
			["67p", 2457247.59],
		] as const) {
			const orbit = getBody(id).orbit!
			const { position, velocity } = stateAt(orbit, jd)
			const out = new Float64Array(3)
			for (const age of [2, 8, 15]) {
				grainOffsetKm(position, velocity, orbitMu(orbit), DUST_BETA, age, out)
				const expected = integratedGrain(orbit, jd, DUST_BETA, age)
				const off = Math.hypot(
					out[0] - expected[0],
					out[1] - expected[1],
					out[2] - expected[2],
				)
				expect(off / Math.hypot(...expected), `${id} ${age} d`).toBeLessThan(
					1e-3,
				)
				// a grain that sunlight does not push stays with the comet
				grainOffsetKm(position, velocity, orbitMu(orbit), 0, age, out)
				expect(Math.hypot(...out), `${id} ${age} d`).toBeLessThan(1)
			}
		}
	})

	/** Angle (deg) between the anti-Sun direction and a dust tail `lengthKm` long, at its end. */
	const bendDeg = (id: string, jd: number, lengthKm: number): number => {
		const orbit = getBody(id).orbit!
		const { position, velocity } = stateAt(orbit, jd)
		const r = Math.hypot(...position)
		const mu = orbitMu(orbit)
		const age = dustAgeDays(mu, DUST_BETA, r, lengthKm)
		const out = new Float64Array(3)
		grainOffsetKm(position, velocity, mu, DUST_BETA, age, out)
		const cos =
			(out[0] * position[0] + out[1] * position[1] + out[2] * position[2]) /
			(Math.hypot(...out) * r)
		return (Math.acos(cos) * 180) / Math.PI
	}

	it("curves more the faster and closer the comet swings round the Sun", () => {
		const halleyPerihelion = 2446469.97
		// Halley far out on its way in vs at perihelion, the same length of tail
		expect(bendDeg("halley", halleyPerihelion - 200, 3e6)).toBeLessThan(
			bendDeg("halley", halleyPerihelion, 3e6) / 3,
		)
		// NEOWISE, whipping round the Sun at 0.3 AU, bends more than 67P at 1.24 AU
		expect(bendDeg("neowise", 2459034.18, 3e6)).toBeGreaterThan(
			1.5 * bendDeg("67p", 2457247.59, 3e6),
		)
		// a longer tail is made of older grains: more bent
		expect(bendDeg("halley", halleyPerihelion, 1e7)).toBeGreaterThan(
			bendDeg("halley", halleyPerihelion, 3e6),
		)
	})
})
