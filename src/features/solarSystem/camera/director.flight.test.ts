/**
 * The flight between bodies (#18) through the real camera director and
 * camera-controls, frame by frame: one continuous pull back -> travel ->
 * descend, both ends in view at the top in every scale preset and screen
 * shape, the destination met where it is on arrival, and the record the
 * distance readout is built from.
 */
import { afterEach, describe, expect, it } from "vitest"
import * as THREE from "three"
import { CameraControlsImpl } from "@react-three/drei"

import { bodies } from "@/data"
import {
	J2000_JD,
	SCALE_PRESETS,
	SCALE_PRESET_IDS,
	type ScalePresetId,
} from "@/sim"
import { FLIGHT_PROFILE, flightStep, useFlightStore } from "@/store/flight"
import type { View } from "@/store/navigation"
import { useSimStore } from "@/store/sim"

import {
	createSimFrame,
	setSimFrameScale,
	updateSimFrame,
} from "../scene/simFrame"
import { CameraDirector } from "./director"
import {
	CAMERA_FAR,
	CAMERA_FOV_DEG,
	CAMERA_NEAR,
	defaultDistance,
} from "./framing"
import { FLIGHT_MAX_MS, FLIGHT_MIN_MS, LIFT_ELEVATION_DEG } from "./profiles"

class Rect {
	constructor(
		public x = 0,
		public y = 0,
		public width = 0,
		public height = 0,
	) {}
}
const globals = globalThis as { DOMRect?: unknown }
globals.DOMRect ??= Rect
CameraControlsImpl.install({ THREE })

const DT = 1 / 60
const store = () => useSimStore.getState()
const flight = () => useFlightStore.getState().flight

afterEach(() => {
	useSimStore.setState(useSimStore.getInitialState(), true)
	useFlightStore.setState(useFlightStore.getInitialState(), true)
})

class Harness {
	readonly camera: THREE.PerspectiveCamera
	readonly controls: CameraControlsImpl
	readonly frame = createSimFrame(bodies, J2000_JD)
	readonly director: CameraDirector
	now = 1000
	jd = J2000_JD
	daysPerFrame = 0

	constructor(
		view: View,
		{
			aspect = 16 / 9,
			preset = "everythingVisible",
			elevationDeg = 20,
		}: { aspect?: number; preset?: ScalePresetId; elevationDeg?: number } = {},
	) {
		this.camera = new THREE.PerspectiveCamera(
			CAMERA_FOV_DEG,
			aspect,
			CAMERA_NEAR,
			CAMERA_FAR,
		)
		this.controls = new CameraControlsImpl(this.camera)
		this.director = new CameraDirector(
			this.controls,
			this.camera,
			this.frame,
			useSimStore,
		)
		setSimFrameScale(this.frame, SCALE_PRESETS[preset])
		this.director.attach()
		store().jumpTo(view, { azimuthDeg: 30, elevationDeg, distance: 1 })
		this.step()
	}

	step(frames = 1): void {
		for (let i = 0; i < frames; i++) {
			this.now += DT * 1000
			this.jd += this.daysPerFrame
			updateSimFrame(this.frame, this.jd)
			this.director.tick(this.now, DT)
		}
	}

	snapshot() {
		return this.director.snapshot(this.now)
	}

	/** Where body `id` is on screen: normalized device coordinates (-1..1 is in view). */
	ndc(id: string): THREE.Vector3 {
		this.camera.updateMatrixWorld()
		const i = this.frame.index.get(id)!
		return this.frame
			.renderPosition(i, new THREE.Vector3())
			.project(this.camera)
	}

	/** Flies until arrival, recording every frame. */
	fly(to: string, record: (h: Harness) => void = () => undefined): number {
		store().setFocus(to)
		let frames = 0
		do {
			this.step()
			record(this)
			frames++
			if (frames > 1000) throw new Error("the flight never arrived")
		} while (store().transition !== null)
		return frames
	}
}

const inView = (p: THREE.Vector3): boolean =>
	Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z < 1

const body = (id: string): View => ({ kind: "body", id })

describe("the flight between bodies", () => {
	it("is what a second selection does; a selection from the overview only descends", () => {
		const h = new Harness({ kind: "overview" })
		store().setFocus("mars")
		expect(store().transition?.profile).toBeNull()
		h.fly("mars")
		expect(flight()).toBeNull()

		store().setFocus("jupiter")
		expect(store().transition?.profile).toBe(FLIGHT_PROFILE)
		h.step()
		const snap = h.snapshot()
		expect(snap.durationMs).toBeGreaterThanOrEqual(FLIGHT_MIN_MS)
		expect(snap.durationMs).toBeLessThanOrEqual(FLIGHT_MAX_MS)
	})

	for (const preset of SCALE_PRESET_IDS) {
		for (const aspect of [16 / 9, 9 / 19.5]) {
			it(`pulls back until both ends are in view, crosses, descends (${preset}, aspect ${aspect.toFixed(2)})`, () => {
				const h = new Harness(body("earth"), { preset, aspect })
				const distances: number[] = []
				let bothInView = false
				h.fly("neptune", (h) => {
					distances.push(h.snapshot().distance)
					if (inView(h.ndc("earth")) && inView(h.ndc("neptune"))) {
						bothInView = true
					}
				})
				// one climb, one descent: the distance rises to its top, then only falls
				const top = distances.indexOf(Math.max(...distances))
				for (let i = 1; i < distances.length; i++) {
					if (i <= top) {
						expect(distances[i]).toBeGreaterThanOrEqual(
							distances[i - 1] * (1 - 1e-9),
						)
					} else {
						expect(distances[i]).toBeLessThanOrEqual(
							distances[i - 1] * (1 + 1e-9),
						)
					}
				}
				// Poster (#54) draws Earth so big that the whole system is only ~100 Earth radii across
				expect(distances[top] / distances[0]).toBeGreaterThan(
					preset === "poster" ? 15 : 100,
				)
				expect(bothInView).toBe(true)
				// ends framed on the destination, tracking it
				const snap = h.snapshot()
				expect(snap.mode).toBe("focused")
				expect(store().focusId).toBe("neptune")
				expect(snap.distance).toBeCloseTo(
					defaultDistance(body("neptune"), h.frame, CAMERA_FOV_DEG, aspect),
					6,
				)
			})
		}
	}

	it("takes 2.5-5 s, most of it at the top, where the picture visibly moves", () => {
		const h = new Harness(body("earth"))
		const samples: { distance: number; x: number; y: number }[] = []
		const frames = h.fly("jupiter", (h) => {
			const p = h.ndc("earth")
			samples.push({ distance: h.snapshot().distance, x: p.x, y: p.y })
		})
		const ms = frames * DT * 1000
		expect(ms).toBeGreaterThanOrEqual(FLIGHT_MIN_MS)
		expect(ms).toBeLessThanOrEqual(FLIGHT_MAX_MS + 2 * DT * 1000)
		const top = Math.max(...samples.map((s) => s.distance))
		const atTop = samples.filter((s) => s.distance > top * (1 - 1e-6))
		expect(atTop.length / samples.length).toBeGreaterThanOrEqual(0.45)
		// the origin slides a good part of the screen while the camera holds its height
		const first = atTop[0]
		const last = atTop[atTop.length - 1]
		expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeGreaterThan(0.4)
	})

	it("rises above the plane of the orbits on the way and comes back down to the chosen view", () => {
		const h = new Harness(body("earth"), { elevationDeg: 5 })
		let highest = -90
		h.fly("mars", (h) => {
			highest = Math.max(highest, h.snapshot().elevationDeg)
		})
		expect(highest).toBeCloseTo(LIFT_ELEVATION_DEG, 0)
		expect(h.snapshot().elevationDeg).toBeCloseTo(5, 6)
	})

	it("lands on a moving destination where it is on arrival", () => {
		const h = new Harness(body("earth"))
		// Mercury runs over a third of its orbit during the flight
		h.daysPerFrame = 0.15
		h.fly("mercury")
		h.step()
		const i = h.frame.index.get("mercury")!
		const p = h.frame.displayKm
		const o = h.snapshot().originKm
		expect(
			Math.hypot(o[0] - p[i * 3], o[1] - p[i * 3 + 1], o[2] - p[i * 3 + 2]),
		).toBe(0)
		expect(h.snapshot().mode).toBe("focused")
	})

	describe("the record behind the readout", () => {
		it("gives the TRUE distance between the two bodies at departure, never the drawn one", () => {
			const h = new Harness(body("earth"))
			store().setFocus("jupiter")
			h.step()
			const record = flight()!
			expect(record).toMatchObject({
				fromId: "earth",
				toId: "jupiter",
				arrived: false,
			})
			const truth = createSimFrame(bodies, J2000_JD)
			updateSimFrame(truth, h.jd)
			const at = (id: string) => truth.index.get(id)! * 3
			const [e, j] = [at("earth"), at("jupiter")]
			const p = truth.positionsKm
			const km = Math.hypot(
				p[j] - p[e],
				p[j + 1] - p[e + 1],
				p[j + 2] - p[e + 2],
			)
			expect(record.distanceKm).toBeCloseTo(km, 0)
			// about 4-6 AU, whatever the preset draws
			expect(record.distanceKm).toBeGreaterThan(5.8e8)
			expect(record.durationMs).toBe(h.snapshot().durationMs)
			while (store().transition !== null) h.step()
			expect(flight()?.arrived).toBe(true)
		})

		it("survives a skip (arrived at once) and goes with the way out", () => {
			const h = new Harness(body("earth"))
			store().setFocus("saturn")
			h.step(30)
			store().skip()
			h.step()
			expect(flight()).toMatchObject({ toId: "saturn", arrived: true })
			expect(h.snapshot().mode).toBe("focused")
			store().reset()
			h.step()
			expect(flight()).toBeNull()
		})

		it("is replaced by a new flight from the body the camera is held on when retargeted", () => {
			const h = new Harness(body("earth"))
			store().setFocus("neptune")
			h.step(20)
			store().setFocus("mars")
			h.step()
			expect(flight()).toMatchObject({ fromId: "earth", toId: "mars" })
			h.fly("mars")
			expect(flight()).toMatchObject({ toId: "mars", arrived: true })
		})

		it("goes when the user flies somewhere without a flight (the overview, then a body)", () => {
			const h = new Harness(body("earth"))
			h.fly("mars")
			store().overview()
			h.step()
			expect(flight()).toBeNull()
			store().setFocus("mars")
			h.step()
			expect(flight()).toBeNull()
		})

		it("comes with a scripted flight step too (tours, the opening)", () => {
			const h = new Harness(body("earth"))
			store().playSequence([flightStep("moon", { holdMs: 500 })])
			h.step()
			expect(flight()).toMatchObject({ fromId: "earth", toId: "moon" })
			expect(flight()!.distanceKm).toBeGreaterThan(3.5e5)
			expect(flight()!.distanceKm).toBeLessThan(4.1e5)
		})
	})
})
