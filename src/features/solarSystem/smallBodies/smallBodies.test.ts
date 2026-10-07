import { Vector3 } from "three"
import { describe, expect, it } from "vitest"

import { belts, bodies, getBody, sun } from "@/data"
import { createI18n } from "@/i18n"
import {
	AU_KM,
	SCALE_PRESETS,
	SCALE_PRESET_IDS,
	TRUE_SCALE,
	propagate,
	toUnits,
} from "@/sim"
import { beltDotPositionKm, generateBeltOrbits } from "@/sim/belts"
import { activityAt, ionTailLengthKm, previousPerihelionJD } from "@/sim/comet"
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
	COMA_NUCLEUS_RADII,
	TAIL_SAMPLES,
	comaGrowth,
	createTailFrame,
	tailBrightness,
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

const comets = bodies.filter((body) => body.tail !== undefined)

/** Moments of a comet's last passage: from where it wakes up to its perihelion and out again. */
const passageMoments = (body: (typeof bodies)[number]): number[] => {
	const orbit = body.orbit!
	const q = previousPerihelionJD(orbit, 2461308.5)
	const moments: number[] = []
	for (let days = -1500; days <= 400; days += 25) {
		if (activityAt(orbit, body.tail!, q + days) > 0) moments.push(q + days)
	}
	return moments
}

const point = (axis: Float32Array, k: number) =>
	new Vector3().fromArray(axis, k * 3)

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
		expect(atPerihelion).toBe(getBody("halley").tail!.ionLengthKm)
	})

	it("switches each comet on at its own distance", () => {
		const tail = createTailFrame()
		for (const comet of comets) {
			const orbit = comet.orbit!
			const t = comet.tail!
			// the day it crosses its own onset on the way in, plus its lag
			const q = previousPerihelionJD(orbit, 2461308.5)
			let far = q - orbit.periodDays / 2
			let near = q
			for (let k = 0; k < 60; k++) {
				const mid = (far + near) / 2
				const p = { x: 0, y: 0, z: 0 }
				propagate(orbit, mid, p)
				if (Math.hypot(p.x, p.y, p.z) > t.onsetKm) far = mid
				else near = mid
			}
			const wakes = near + (t.lagDays ?? 0)
			const frame = createSimFrame(bodies, wakes - 1, TRUE_SCALE)
			expect(writeTail(frame, at(comet.id), tail).visible, comet.id).toBe(false)
			updateSimFrame(frame, wakes + 1)
			expect(writeTail(frame, at(comet.id), tail).visible, comet.id).toBe(true)
		}
		// at the same distance, 5 AU: Hale-Bopp awake, Halley and Encke not yet
		const tail5 = (id: string) => {
			const t = getBody(id).tail!
			return t.onsetKm > 5 * AU_KM
		}
		expect(tail5("halebopp")).toBe(true)
		expect(tail5("halley")).toBe(true)
		expect(tail5("encke")).toBe(false)
	})

	it("brightens as the comet wakes up and grows active", () => {
		let previous = -1
		for (let activity = 0; activity <= 1; activity += 0.05) {
			expect(tailBrightness(activity)).toBeGreaterThan(previous)
			expect(comaGrowth(activity)).toBeGreaterThanOrEqual(
				tailBrightness(activity),
			)
			previous = tailBrightness(activity)
		}
		expect(tailBrightness(0)).toBe(0)
		expect(comaGrowth(0)).toBe(0)
		expect(tailBrightness(1)).toBe(1)
		// along Halley's way in: brighter at every step, full at perihelion
		const frame = createSimFrame(bodies, HALLEY_PERIHELION, TRUE_SCALE)
		const tail = createTailFrame()
		const brightness: number[] = []
		for (const days of [-500, -400, -300, -200, -100, 0]) {
			updateSimFrame(frame, HALLEY_PERIHELION + days)
			brightness.push(
				tailBrightness(writeTail(frame, at("halley"), tail).activity),
			)
		}
		for (let k = 1; k < brightness.length; k++) {
			expect(brightness[k], `step ${k}`).toBeGreaterThan(brightness[k - 1])
		}
		expect(brightness.at(-1)).toBe(1)
	})

	it("surrounds the drawn nucleus with its coma in every preset, and starts the tails outside it", () => {
		const tail = createTailFrame()
		for (const presetId of SCALE_PRESET_IDS) {
			for (const comet of comets) {
				for (const jd of passageMoments(comet)) {
					const frame = createSimFrame(bodies, jd, SCALE_PRESETS[presetId])
					updateSimFrame(frame, jd, at(comet.id))
					writeTail(frame, at(comet.id), tail)
					const label = `${presetId} ${comet.id} ${jd}`
					expect(tail.visible, label).toBe(true)
					const nucleus = toUnits(frame.displayRadiiKm[at(comet.id)])
					expect(tail.nucleusUnits, label).toBeCloseTo(nucleus, 9)
					expect(tail.comaUnits, label).toBeGreaterThanOrEqual(
						COMA_NUCLEUS_RADII * nucleus * (1 - 1e-9),
					)
					const head = new Vector3().fromArray(tail.head)
					const tolerance = 1e-3 * nucleus
					for (const axis of [
						...(tail.lengthKm > 0 ? [tail.ion] : []),
						...(tail.dustLengthKm > 0 ? [tail.dust] : []),
					]) {
						// the fade-in starts on the nucleus's surface, the tail proper at the coma's edge
						expect(
							point(axis, 0).distanceTo(head),
							label,
						).toBeGreaterThanOrEqual(nucleus - tolerance)
						expect(
							Math.abs(point(axis, 1).distanceTo(head) - tail.comaUnits) /
								tail.comaUnits,
							label,
						).toBeLessThan(1e-3)
						for (let k = 2; k < TAIL_SAMPLES; k++) {
							expect(
								point(axis, k).distanceTo(head),
								`${label} ${k}`,
							).toBeGreaterThan(nucleus)
						}
					}
				}
			}
		}
	})

	it("points straight away from the drawn Sun in every preset, and is its true length at true scale", () => {
		for (const presetId of SCALE_PRESET_IDS) {
			// render origin on the comet, like a camera focused on it
			const scale = SCALE_PRESETS[presetId]
			const drawn = createSimFrame(bodies, HALLEY_PERIHELION + 30, scale)
			updateSimFrame(drawn, HALLEY_PERIHELION + 30, at("halley"))
			const tail = writeTail(drawn, at("halley"), createTailFrame())
			expect(tail.visible).toBe(true)
			const sunAt = drawn.renderPosition(0, new Vector3())
			const head = new Vector3().fromArray(tail.head)
			const outward = head.clone().sub(sunAt).normalize()
			for (const k of [0, 1, TAIL_SAMPLES - 1]) {
				const along = point(tail.ion, k).sub(head).normalize()
				expect(outward.angleTo(along), `${presetId} ${k}`).toBeLessThan(1e-4)
			}
			// the head is the comet as drawn
			const comet = drawn.renderPosition(at("halley"), new Vector3())
			expect(head.distanceTo(comet)).toBeLessThan(1e-6 * comet.length() + 1e-9)
			if (presetId === "trueScale") {
				expect(tail.ionUnits).toBeCloseTo(toUnits(tail.lengthKm), 0)
				const halley = getBody("halley")
				expect(tail.lengthKm).toBeCloseTo(
					ionTailLengthKm(
						halley.tail!,
						activityAt(halley.orbit!, halley.tail!, HALLEY_PERIHELION + 30),
					),
					0,
				)
				expect(tail.dustUnits).toBeCloseTo(toUnits(tail.dustLengthKm), 0)
			}
		}
	})

	it("bends the dust tail back along the orbit", () => {
		for (const comet of comets.filter((body) => body.tail!.dustLengthKm > 0)) {
			const q = previousPerihelionJD(comet.orbit!, 2461308.5)
			const frame = createSimFrame(bodies, q + 10, TRUE_SCALE)
			const tail = writeTail(frame, at(comet.id), createTailFrame())
			const last = TAIL_SAMPLES - 1
			const later = createSimFrame(bodies, q + 10.01, TRUE_SCALE)
			const o = at(comet.id) * 3
			const motion = new Vector3(
				later.positionsKm[o] - frame.positionsKm[o],
				later.positionsKm[o + 1] - frame.positionsKm[o + 1],
				later.positionsKm[o + 2] - frame.positionsKm[o + 2],
			)
			const head = point(tail.dust, 1)
			const bent = point(tail.dust, last).sub(head)
			const straight = point(tail.ion, last).sub(head).setLength(bent.length())
			expect(bent.sub(straight).dot(motion), comet.id).toBeLessThan(0)
			// and keeps the length the data gives it
			expect(tail.dustUnits / toUnits(tail.dustLengthKm), comet.id).toBeCloseTo(
				1,
				2,
			)
		}
	})

	it("works out the dust tail's curve again only when the clock has moved", () => {
		const frame = createSimFrame(bodies, HALLEY_PERIHELION, TRUE_SCALE)
		const tail = writeTail(frame, at("halley"), createTailFrame())
		const shape = Float64Array.from(tail.dustShape)
		expect(tail.dustJD).toBe(HALLEY_PERIHELION)
		writeTail(frame, at("halley"), tail)
		expect(tail.dustJD).toBe(HALLEY_PERIHELION)
		updateSimFrame(frame, HALLEY_PERIHELION + 3)
		writeTail(frame, at("halley"), tail)
		expect(tail.dustJD).toBe(HALLEY_PERIHELION + 3)
		expect(tail.dustShape).not.toEqual(shape)
	})

	it("is never thinner than its minimum on screen", () => {
		const axis = new Float32Array(TAIL_SAMPLES * 3)
		for (let k = 0; k < TAIL_SAMPLES; k++) axis[k * 3] = k
		const positions = new Float32Array(TAIL_SAMPLES * 6)
		// 1000 px per unit at distance 1, camera 100 units away: a pixel is 0.1 unit
		writeRibbon(axis, 23, 0, 0, 2, { x: 0, y: 0, z: 100 }, 1000, positions, 0)
		const last = (TAIL_SAMPLES - 1) * 6
		const width = Math.hypot(
			positions[last] - positions[last + 3],
			positions[last + 1] - positions[last + 4],
			positions[last + 2] - positions[last + 5],
		)
		expect(width).toBeGreaterThanOrEqual(0.2 * 0.99)
	})

	it("starts no wider than the coma and widens to its end", () => {
		const axis = new Float32Array(TAIL_SAMPLES * 3)
		for (let k = 0; k < TAIL_SAMPLES; k++) axis[k * 3] = k
		const positions = new Float32Array(TAIL_SAMPLES * 6)
		writeRibbon(axis, 22, 0.1, 0.3, 0, { x: 0, y: 0, z: 100 }, 0, positions, 0)
		const width = (k: number) =>
			Math.hypot(
				positions[k * 6] - positions[k * 6 + 3],
				positions[k * 6 + 1] - positions[k * 6 + 4],
				positions[k * 6 + 2] - positions[k * 6 + 5],
			)
		expect(width(1)).toBeCloseTo(0.6, 4)
		expect(width(TAIL_SAMPLES - 1)).toBeCloseTo(2 * 0.1 * 22, 4)
	})
})

describe("watching a comet pass the Sun", () => {
	const halley = getBody("halley").orbit!
	const halleyTail = getBody("halley").tail!
	const distance = (orbit: typeof halley, jd: number) => {
		const p = { x: 0, y: 0, z: 0 }
		propagate(orbit, jd, p)
		return Math.hypot(p.x, p.y, p.z)
	}

	it("frames the passage from where the comet wakes up on the way in to the same distance on the way out", () => {
		const passage = passageAround(halley, halleyTail, HALLEY_PERIHELION)
		expect(passage.perihelionJD).toBe(HALLEY_PERIHELION)
		// it crosses its onset, and wakes up its lag later
		expect(
			distance(halley, passage.startJD - (halleyTail.lagDays ?? 0)) /
				halleyTail.onsetKm,
		).toBeCloseTo(1, 6)
		// months on either side, the same both ways but for the lag
		const lag = halleyTail.lagDays ?? 0
		expect(HALLEY_PERIHELION - passage.startJD).toBeGreaterThan(100)
		expect(HALLEY_PERIHELION - passage.startJD).toBeLessThan(1000)
		expect(passage.endJD - lag - HALLEY_PERIHELION).toBeCloseTo(
			HALLEY_PERIHELION - (passage.startJD - lag),
			1,
		)
		// a comet with a lag wakes up (and falls asleep) that much later
		const p67 = getBody("67p")
		const lagged = passageAround(p67.orbit!, p67.tail!, 2457247.59)
		const plain = passageAround(
			p67.orbit!,
			{ ...p67.tail!, lagDays: undefined },
			2457247.59,
		)
		expect(lagged.startJD - plain.startJD).toBeCloseTo(p67.tail!.lagDays!, 6)
		expect(lagged.endJD - plain.endJD).toBeCloseTo(p67.tail!.lagDays!, 6)
	})

	it("goes to the next passage, the one under way, or for a comet that returns after 3000 the last one", () => {
		const now = 2461308.5
		const next = passageToWatch(halley, halleyTail, now)
		expect(Math.abs(next.perihelionJD - 2474034)).toBeLessThan(1)
		expect(watchStartJD(next, now)).toBe(next.startJD)
		const during = passageToWatch(halley, halleyTail, HALLEY_PERIHELION + 5)
		expect(during.perihelionJD).toBeCloseTo(HALLEY_PERIHELION, 2)
		expect(watchStartJD(during, HALLEY_PERIHELION + 5)).toBe(
			HALLEY_PERIHELION + 5,
		)
		const neowise = getBody("neowise")
		const last = passageToWatch(neowise.orbit!, neowise.tail!, now)
		expect(last.perihelionJD).toBeLessThan(now)
		expect(Math.abs(last.perihelionJD - 2459034.18)).toBeLessThan(1)
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
