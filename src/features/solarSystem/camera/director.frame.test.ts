/**
 * The anchored reference frame (#31) through the real camera director and
 * camera-controls, frame by frame: the Earth preset's region is framed on
 * arrival, the body held still never moves while the frame blends in, and a
 * pan keeps the centre with the body held still instead of re-anchoring.
 */
import { afterEach, describe, expect, it } from "vitest"
import * as THREE from "three"
import { CameraControlsImpl } from "@react-three/drei"

import { bodies, sun } from "@/data"
import {
	AU_KM,
	J2000_JD,
	KM_PER_UNIT,
	SCALE_PRESETS,
	displayDistanceKm,
	toUnits,
} from "@/sim"
import { useSimStore } from "@/store/sim"

import { createFrameBlendState } from "../frame/frameBlend"
import { syncReferenceFrame } from "../frame/ReferenceFrameSync"
import {
	FRAME_BLEND_SLOTS,
	createSimFrame,
	updateSimFrame,
} from "../scene/simFrame"
import { CameraDirector } from "./director"
import { CAMERA_FAR, CAMERA_FOV_DEG, CAMERA_NEAR, fitDistance } from "./framing"

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

const ASPECT = 16 / 9
const DT = 1 / 60
const EV = SCALE_PRESETS.everythingVisible
type Vec = [number, number, number]

const store = () => useSimStore.getState()
const distance = (a: ArrayLike<number>, b: ArrayLike<number>) =>
	Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

afterEach(() => useSimStore.setState(useSimStore.getInitialState(), true))

class Harness {
	readonly camera = new THREE.PerspectiveCamera(
		CAMERA_FOV_DEG,
		ASPECT,
		CAMERA_NEAR,
		CAMERA_FAR,
	)
	readonly controls = new CameraControlsImpl(this.camera)
	readonly frame = createSimFrame(bodies, J2000_JD, EV)
	readonly blend = createFrameBlendState(FRAME_BLEND_SLOTS)
	readonly director = new CameraDirector(
		this.controls,
		this.camera,
		this.frame,
		useSimStore,
	)
	now = 1000
	jd = J2000_JD
	daysPerFrame = 0

	constructor() {
		this.director.attach()
		this.step()
	}

	step(frames = 1): void {
		for (let i = 0; i < frames; i++) {
			this.now += DT * 1000
			this.jd += this.daysPerFrame
			syncReferenceFrame(this.frame, this.blend, store().frameId, DT * 1000)
			updateSimFrame(this.frame, this.jd)
			this.director.tick(this.now, DT)
		}
	}

	settle(maxMs = 10000): void {
		const end = this.now + maxMs
		const moving = () => {
			const s = this.controls.getSpherical(new THREE.Spherical(), false)
			const e = this.controls.getSpherical(new THREE.Spherical(), true)
			const t = this.controls.getTarget(new THREE.Vector3(), false)
			const te = this.controls.getTarget(new THREE.Vector3(), true)
			return (
				Math.abs(s.radius - e.radius) > 1e-9 * e.radius ||
				t.distanceTo(te) > 1e-6 * e.radius
			)
		}
		do {
			if (this.now > end) throw new Error("the camera never settled")
			this.step()
		} while (
			store().transition !== null ||
			this.director.snapshot(this.now).transitionId !== null ||
			moving() ||
			store().panning
		)
		// let the frame blend finish too
		this.step(90)
	}

	bodyKm(id: string): Vec {
		const i = this.frame.index.get(id)!
		const p = this.frame.displayKm
		return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
	}

	pivotKm(): Vec {
		const t = this.controls.getTarget(new THREE.Vector3(), false)
		const o = this.frame.originKm
		return [
			o[0] + t.x * KM_PER_UNIT,
			o[1] + t.y * KM_PER_UNIT,
			o[2] + t.z * KM_PER_UNIT,
		]
	}

	panTo(km: ArrayLike<number>): void {
		const o = this.frame.originKm
		this.controls.dispatchEvent({ type: "control" })
		void this.controls.moveTo(
			(km[0] - o[0]) / KM_PER_UNIT,
			(km[1] - o[1]) / KM_PER_UNIT,
			(km[2] - o[2]) / KM_PER_UNIT,
			true,
		)
	}
}

/** Earth held still, from straight above, framing 2.7 AU: the planets preset. */
const holdEarth = () =>
	store().anchorFrame("earth", {
		shot: { azimuthDeg: 0, elevationDeg: 89.9 },
		fit: { km: 2.7 * AU_KM, around: "sun" },
	})

describe("the anchored frame and the camera (#31)", () => {
	it("frames the requested region around the body held still", () => {
		const h = new Harness()
		holdEarth()
		h.settle()
		const snap = h.director.snapshot(h.now)
		const expected = fitDistance(
			toUnits(
				displayDistanceKm(
					2.7 * AU_KM,
					sun.radiusKm,
					sun.radiusKm,
					EV.orbitDistance,
				),
			),
			CAMERA_FOV_DEG,
			ASPECT,
		)
		expect(snap.distance / expected).toBeCloseTo(1, 3)
		expect(snap.elevationDeg).toBeCloseTo(89.9, 1)
		expect(distance(h.pivotKm(), h.bodyKm("earth"))).toBeLessThan(1)
		expect(snap.mode).toBe("focused")
	})

	it("never moves the body held still while the frame blends in, and moves the others", () => {
		const h = new Harness()
		store().jumpTo({ kind: "body", id: "earth" })
		h.settle()
		const earth = h.bodyKm("earth")
		const mars = h.bodyKm("mars")
		store().anchorFrame("earth")
		for (let k = 0; k < 80; k++) {
			h.step()
			expect(distance(h.bodyKm("earth"), earth)).toBeLessThan(1e-3)
		}
		expect(distance(h.bodyKm("mars"), mars)).toBeGreaterThan(1e6)
		// the Sun stays put in both frames
		expect(distance(h.bodyKm("sun"), [0, 0, 0])).toBeLessThan(1)
	})

	it("keeps a pan's centre with the body held still, even out among the planets", () => {
		const h = new Harness()
		holdEarth()
		h.settle()
		// out towards (but not onto) Mars, far beyond Earth's own neighbourhood
		const earth = h.bodyKm("earth")
		const mars = h.bodyKm("mars")
		const aside: Vec = [
			earth[0] + 0.6 * (mars[0] - earth[0]) + 0.2 * (mars[2] - earth[2]),
			earth[1],
			earth[2] + 0.6 * (mars[2] - earth[2]) - 0.2 * (mars[0] - earth[0]),
		]
		h.panTo(aside)
		h.settle()
		expect(store().view).toMatchObject({ kind: "point", anchorId: "earth" })
		expect(store().frameId).toBe("earth")
		expect(distance(h.pivotKm(), aside)).toBeLessThan(
			1e-3 * distance(aside, earth),
		)
	})

	it("does not re-anchor on a planet a pan is dropped onto", () => {
		const h = new Harness()
		holdEarth()
		h.settle()
		h.panTo(h.bodyKm("mars"))
		h.settle()
		expect(store().frameId).toBe("earth")
		expect(store().view).toMatchObject({ kind: "point", anchorId: "earth" })
		// dropped back on Earth: centred on it again
		h.panTo(h.bodyKm("earth"))
		h.settle()
		expect(store().view).toEqual({ kind: "body", id: "earth" })
	})

	it("goes back to the Sun-centred overview in one action", () => {
		const h = new Harness()
		holdEarth()
		h.settle()
		store().releaseFrame()
		h.settle()
		expect(h.director.snapshot(h.now).mode).toBe("overview")
		expect(store().frameId).toBe("sun")
		expect(Array.from(h.frame.frameBlend.weights)).toEqual([0, 0])
	})
})
