import { Vector3 } from "three"
import { describe, expect, it } from "vitest"

import { belts, bodies, getBody, sun } from "@/data"
import { createI18n } from "@/i18n"
import {
	AU_KM,
	SCALE_PRESETS,
	SCALE_PRESET_IDS,
	TRUE_SCALE,
	toUnits,
} from "@/sim"
import { beltDotPositionKm, generateBeltOrbits } from "@/sim/belts"
import { tailLengthKm } from "@/sim/comet"
import { WARP_PRESETS } from "@/store/sim"

import { mapTruePointKm } from "../light/lightFront"
import { createSimFrame, updateSimFrame } from "../scene/simFrame"
import {
	BELT_DOT_PX,
	beltMidRadiusKm,
	createBeltUniforms,
	hexToRgb,
	updateBeltUniforms,
	type BeltUniforms,
} from "./belts"
import {
	LATEST_WATCH_JD,
	passageAround,
	passageToWatch,
	watchStartJD,
	watchWarp,
} from "./cometWatch"
import {
	TAIL_SAMPLES,
	createTailFrame,
	writeRibbon,
	writeTail,
} from "./cometTail"
import { beltOf, beltSentences, cometSentences } from "./smallBodyText"

const at = (id: string) => bodies.findIndex((body) => body.id === id)
const HALLEY_PERIHELION = 2446469.97
const J2000 = 2451545

/** The belt shader's anchored curve (beltSpline) in JS, doubles. */
function splineDistance(u: BeltUniforms, x: number): number {
	const v = Math.log(x)
	const end = u.uSplineEnd.value
	if (v >= end.x) return end.y + end.z * (v - end.x)
	const U = u.uSplineU.value
	const Y = u.uSplineY.value
	const M = u.uSplineM.value
	for (let k = 0; k + 1 < u.uSplineCount.value; k++) {
		if (v >= U[k + 1]) continue
		const h = U[k + 1] - U[k]
		const t = (v - U[k]) / h
		return (
			(2 * t ** 3 - 3 * t ** 2 + 1) * Y[k] +
			(t ** 3 - 2 * t ** 2 + t) * h * M[k] +
			(-2 * t ** 3 + 3 * t ** 2) * Y[k + 1] +
			(t ** 3 - t ** 2) * h * M[k + 1]
		)
	}
	return end.y
}

/** The belt vertex shader's arithmetic in JS (beltShader.ts), doubles. */
function shaderPosition(
	u: BeltUniforms,
	p: Float64Array,
	out: Vector3,
): Vector3 {
	const mapped = (
		x: number,
		y: number,
		z: number,
	): [number, number, number] => {
		const d = Math.hypot(x, y, z)
		if (d <= 0) return [0, 0, 0]
		const r = u.uRootRadiusKm.value
		const xr = d / r
		const { x: knee, y: exponent, z: gain } = u.uCurve.value
		let f = xr <= knee ? xr : knee * (1 + gain * ((xr / knee) ** exponent - 1))
		const share = u.uSplineShare.value
		if (xr > knee && share > 0) {
			const s = splineDistance(u, xr)
			f = share >= 1 ? s : f ** (1 - share) * s ** share
		}
		const k = (r * f) / d
		return [x * k, y * k, z * k]
	}
	const [hx, hy, hz] = mapped(p[0], p[1], p[2])
	const helio = u.uRootRender.value
		.clone()
		.add(new Vector3(hx, hy, hz).multiplyScalar(0.001))
	out.copy(helio)
	u.uAnchorWeight.value.forEach((w, k) => {
		if (!(w > 0)) return
		const t = u.uAnchorTrue.value[k]
		const [ax, ay, az] = mapped(p[0] - t.x, p[1] - t.y, p[2] - t.z)
		out.add(
			u.uAnchorRender.value[k]
				.clone()
				.add(new Vector3(ax, ay, az).multiplyScalar(0.001))
				.sub(helio)
				.multiplyScalar(w),
		)
	})
	return out
}

describe("belt dots as drawn", () => {
	const belt = belts[0]
	const orbits = generateBeltOrbits(belt, sun.massKg!)
	const jd = 2461308.5

	it("land where a body at that true place is drawn, in every preset and in anchored frames", () => {
		for (const presetId of SCALE_PRESET_IDS) {
			for (const anchored of [null, "earth", "jupiter"]) {
				const frame = createSimFrame(bodies, jd, SCALE_PRESETS[presetId])
				if (anchored !== null) {
					frame.frameBlend.anchors[0] = at(anchored)
					frame.frameBlend.weights[0] = anchored === "earth" ? 1 : 0.4
				}
				updateSimFrame(frame, jd, at("mars"))
				const uniforms = createBeltUniforms([1, 1, 1], 2)
				updateBeltUniforms(uniforms, frame, 0, 2)
				expect(uniforms.uPointSize.value).toBe(2 * BELT_DOT_PX)
				const p = new Float64Array(3)
				const expected = new Float64Array(3)
				const drawn = new Vector3()
				for (let k = 0; k < orbits.count; k += 251) {
					beltDotPositionKm(orbits, k, uniforms.uDays.value, p)
					shaderPosition(uniforms, p, drawn)
					mapTruePointKm(frame, 0, 0, p[0], p[1], p[2], expected)
					const units = [0, 1, 2].map((c) =>
						toUnits(expected[c] - frame.originKm[c]),
					)
					const size = Math.max(1, Math.hypot(...units))
					expect(
						Math.hypot(
							drawn.x - units[0],
							drawn.y - units[1],
							drawn.z - units[2],
						) / size,
						`${presetId} ${anchored} dot ${k}`,
					).toBeLessThan(1e-9)
				}
			}
		}
	})

	it("surround the named members: Vesta and Ceres are drawn inside the belt in every preset", () => {
		for (const presetId of SCALE_PRESET_IDS) {
			const frame = createSimFrame(bodies, jd, SCALE_PRESETS[presetId])
			const drawnRadius = (km: number) => {
				const out = new Float64Array(3)
				mapTruePointKm(frame, 0, 0, km, 0, 0, out)
				return Math.hypot(out[0], out[1], out[2])
			}
			const inner = drawnRadius(belt.zones[0].semiMajorAxisKm[0] * 0.8)
			const outer = drawnRadius(belt.zones.at(-1)!.semiMajorAxisKm[1] * 1.25)
			for (const id of ["ceres", "vesta", "pallas"]) {
				const o = at(id) * 3
				const r = Math.hypot(
					frame.displayKm[o],
					frame.displayKm[o + 1],
					frame.displayKm[o + 2],
				)
				expect(r, `${presetId} ${id}`).toBeGreaterThan(inner)
				expect(r, `${presetId} ${id}`).toBeLessThan(outer)
			}
		}
	})

	it("reads colours and the belt's middle", () => {
		expect(hexToRgb("#ff8000")).toEqual([1, 128 / 255, 0])
		const mid = beltMidRadiusKm(belt) / AU_KM
		expect(mid).toBeGreaterThan(2.3)
		expect(mid).toBeLessThan(3)
	})
})

describe("a comet's tail as drawn", () => {
	it("is asleep far from the Sun and grows toward perihelion", () => {
		const frame = createSimFrame(bodies, 2461308.5, TRUE_SCALE)
		const tail = createTailFrame()
		expect(writeTail(frame, at("halley"), tail).visible).toBe(false)
		updateSimFrame(frame, HALLEY_PERIHELION - 60)
		const before = writeTail(frame, at("halley"), tail).lengthKm
		updateSimFrame(frame, HALLEY_PERIHELION)
		const atPerihelion = writeTail(frame, at("halley"), tail).lengthKm
		expect(before).toBeGreaterThan(0)
		expect(atPerihelion).toBeGreaterThan(before)
		expect(tail.activity).toBe(1)
	})

	it("points straight away from the drawn Sun in every preset, and is its true length at true scale", () => {
		for (const presetId of SCALE_PRESET_IDS) {
			const frame = createSimFrame(bodies, HALLEY_PERIHELION + 30)
			// render origin on the comet, like a camera focused on it
			const scale = SCALE_PRESETS[presetId]
			const drawn = createSimFrame(bodies, HALLEY_PERIHELION + 30, scale)
			updateSimFrame(drawn, HALLEY_PERIHELION + 30, at("halley"))
			const tail = writeTail(drawn, at("halley"), createTailFrame())
			expect(tail.visible).toBe(true)
			const sunAt = drawn.renderPosition(0, new Vector3())
			const head = new Vector3(tail.ion[0], tail.ion[1], tail.ion[2])
			const end = new Vector3().fromArray(tail.ion, (TAIL_SAMPLES - 1) * 3)
			const outward = head.clone().sub(sunAt).normalize()
			const along = end.clone().sub(head).normalize()
			expect(outward.angleTo(along), presetId).toBeLessThan(1e-4)
			// the head is the comet as drawn
			const comet = drawn.renderPosition(at("halley"), new Vector3())
			expect(head.distanceTo(comet)).toBeLessThan(1e-6 * comet.length() + 1e-9)
			if (presetId === "trueScale") {
				expect(tail.ionUnits).toBeCloseTo(toUnits(tail.lengthKm), 0)
				const o = at("halley") * 3
				const r = Math.hypot(
					frame.positionsKm[o],
					frame.positionsKm[o + 1],
					frame.positionsKm[o + 2],
				)
				expect(tail.lengthKm).toBeCloseTo(
					tailLengthKm(getBody("halley").tail!, r),
					0,
				)
			}
		}
	})

	it("bends the dust tail back along the orbit", () => {
		const frame = createSimFrame(bodies, HALLEY_PERIHELION + 30, TRUE_SCALE)
		const tail = writeTail(frame, at("halley"), createTailFrame())
		const last = (TAIL_SAMPLES - 1) * 3
		const ionEnd = new Vector3().fromArray(tail.ion, last)
		const dustEnd = new Vector3().fromArray(tail.dust, last)
		const later = createSimFrame(bodies, HALLEY_PERIHELION + 30.01, TRUE_SCALE)
		const o = at("halley") * 3
		const motion = new Vector3(
			later.positionsKm[o] - frame.positionsKm[o],
			later.positionsKm[o + 1] - frame.positionsKm[o + 1],
			later.positionsKm[o + 2] - frame.positionsKm[o + 2],
		)
		const head = new Vector3(tail.dust[0], tail.dust[1], tail.dust[2])
		const bent = dustEnd.clone().sub(head)
		const straight = ionEnd.clone().sub(head).setLength(bent.length())
		expect(bent.sub(straight).dot(motion)).toBeLessThan(0)
	})

	it("is never thinner than its minimum on screen", () => {
		const axis = new Float32Array(TAIL_SAMPLES * 3)
		for (let k = 0; k < TAIL_SAMPLES; k++) axis[k * 3] = k
		const positions = new Float32Array(TAIL_SAMPLES * 6)
		// 1000 px per unit at distance 1, camera 100 units away: a pixel is 0.1 unit
		writeRibbon(axis, 23, 0, 2, { x: 0, y: 0, z: 100 }, 1000, positions, 0)
		const last = (TAIL_SAMPLES - 1) * 6
		const width = Math.hypot(
			positions[last] - positions[last + 3],
			positions[last + 1] - positions[last + 4],
			positions[last + 2] - positions[last + 5],
		)
		expect(width).toBeGreaterThanOrEqual(0.2 * 0.99)
	})
})

describe("watching a comet pass the Sun", () => {
	const halley = getBody("halley").orbit!

	it("frames the passage from 4 AU in to 4 AU out", () => {
		const passage = passageAround(halley, HALLEY_PERIHELION)
		expect(passage.perihelionJD).toBe(HALLEY_PERIHELION)
		// Halley crossed 4 AU inbound in the autumn of 1985 and outbound in mid 1986... about 4 months each way
		expect(HALLEY_PERIHELION - passage.startJD).toBeGreaterThan(100)
		expect(HALLEY_PERIHELION - passage.startJD).toBeLessThan(300)
		expect(passage.endJD - HALLEY_PERIHELION).toBeCloseTo(
			HALLEY_PERIHELION - passage.startJD,
			1,
		)
	})

	it("goes to the next passage, the one under way, or for a comet that returns after 3000 the last one", () => {
		const now = 2461308.5
		const next = passageToWatch(halley, now)
		expect(Math.abs(next.perihelionJD - 2474034)).toBeLessThan(1)
		expect(watchStartJD(next, now)).toBe(next.startJD)
		const during = passageToWatch(halley, HALLEY_PERIHELION + 5)
		expect(during.perihelionJD).toBeCloseTo(HALLEY_PERIHELION, 2)
		expect(watchStartJD(during, HALLEY_PERIHELION + 5)).toBe(
			HALLEY_PERIHELION + 5,
		)
		const neowise = passageToWatch(getBody("neowise").orbit!, now)
		expect(neowise.perihelionJD).toBeLessThan(now)
		expect(Math.abs(neowise.perihelionJD - 2459034.18)).toBeLessThan(1)
		expect(LATEST_WATCH_JD).toBeGreaterThan(now)
	})

	it("picks a speed preset that shows the passage in about a minute and a half", () => {
		expect(WARP_PRESETS).toContain(watchWarp(240))
		// Halley's 540 days from 4 AU in to 4 AU out: 1 week/s, 77 s on screen
		expect(watchWarp(540)).toBe(604800)
		expect(watchWarp(1)).toBe(3600)
	})
})

describe("what the card says", () => {
	it("says how many asteroids a dot stands for and how empty the belt is, in every language and level", () => {
		const belt = belts[0]
		for (const locale of ["en", "de"] as const) {
			for (const readingLevel of ["simple", "standard", "advanced"] as const) {
				const text = beltSentences(belt, createI18n({ locale, readingLevel }))
				expect(text.perDot).toMatch(/380/)
				expect(text.spacing).toMatch(/2[.,]6/)
				expect(text.name.length).toBeGreaterThan(3)
			}
		}
		const en = beltSentences(belt, createI18n())
		expect(en.name).toBe("Asteroid belt")
		expect(en.perDot).toBe(
			"Each dot stands for about 380 asteroids bigger than 1 km.",
		)
		expect(en.spacing).toMatch(/^Neighbours are about 1 million km apart/)
		expect(beltSentences(belts[1], createI18n({ locale: "de" })).name).toBe(
			"Kuipergürtel",
		)
	})

	it("puts belt members in their belt, and nobody else", () => {
		expect(beltOf(getBody("ceres"))?.id).toBe("asteroidbelt")
		expect(beltOf(getBody("vesta"))?.id).toBe("asteroidbelt")
		expect(beltOf(getBody("pluto"))?.id).toBe("kuiperbelt")
		expect(beltOf(getBody("arrokoth"))?.id).toBe("kuiperbelt")
		expect(beltOf(getBody("eris"))).toBeNull()
		expect(beltOf(getBody("eros"))).toBeNull()
		expect(beltOf(getBody("mars"))).toBeNull()
		expect(beltOf(getBody("charon"))).toBeNull()
	})

	it("tells where a comet is and that its tail leads on the way out", () => {
		const en = createI18n()
		const outbound = cometSentences(
			getBody("halley"),
			HALLEY_PERIHELION + 30,
			en,
		)!
		expect(outbound.where).toMatch(/heading away from it/)
		expect(outbound.tail).toMatch(
			/million km long .* so now the tail goes first/,
		)
		const inbound = cometSentences(
			getBody("halley"),
			HALLEY_PERIHELION - 30,
			en,
		)!
		expect(inbound.where).toMatch(/falling toward it/)
		expect(inbound.tail).not.toMatch(/goes first/)
		const today = cometSentences(getBody("halley"), 2461308.5, en)!
		expect(today.tail).toMatch(/^No tail right now/)
		expect(today.perihelion).toBe("Next time closest to the Sun: Jul 28, 2061.")
		const neowise = cometSentences(getBody("neowise"), 2461308.5, en)!
		expect(neowise.perihelion).toMatch(
			/^Last time closest to the Sun: Jul 3, 2020\. It returns in about 6,800 years\.$/,
		)
		const de = cometSentences(
			getBody("halley"),
			HALLEY_PERIHELION + 30,
			createI18n({ locale: "de", readingLevel: "simple" }),
		)!
		expect(de.tail).toMatch(/mit dem Schweif voran/)
	})
})

it("uses J2000 as the belt clock's zero", () => {
	const frame = createSimFrame(bodies, J2000, TRUE_SCALE)
	const uniforms = createBeltUniforms([1, 1, 1], 2)
	updateBeltUniforms(uniforms, frame, 0, 1)
	expect(uniforms.uDays.value).toBe(0)
})
