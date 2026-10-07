/**
 * The view from Earth (#41) through the real camera director and
 * camera-controls: a request with an `eye` stands the camera on that point
 * and looks at the view's centre, keeps standing there while the bodies move,
 * narrows the lens, and lets go when the user takes the camera; the next
 * request without a lens goes back to the normal one.
 */
import { afterEach, describe, expect, it } from "vitest"
import * as THREE from "three"
import { CameraControlsImpl } from "@react-three/drei"

import { bodies } from "@/data"
import { KM_PER_UNIT, TRUE_SCALE, dateToJD } from "@/sim"
import { useSimStore } from "@/store/sim"

import { createSimFrame, updateSimFrame } from "../scene/simFrame"
import { CameraDirector } from "./director"
import { CAMERA_FAR, CAMERA_FOV_DEG, CAMERA_NEAR } from "./framing"

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

afterEach(() => useSimStore.setState(useSimStore.getInitialState(), true))

class Harness {
	readonly camera = new THREE.PerspectiveCamera(
		CAMERA_FOV_DEG,
		16 / 9,
		CAMERA_NEAR,
		CAMERA_FAR,
	)
	readonly controls = new CameraControlsImpl(this.camera)
	jd = dateToJD(new Date("2024-04-08T16:40:00Z"))
	readonly frame = createSimFrame(bodies, this.jd, TRUE_SCALE)
	readonly director = new CameraDirector(
		this.controls,
		this.camera,
		this.frame,
		useSimStore,
	)
	now = 1000
	daysPerFrame = 0

	constructor() {
		this.director.attach()
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

	settle(): void {
		for (let i = 0; i < 1200 && store().transition !== null; i++) this.step()
		this.step(30)
	}

	/** The camera in world km. */
	cameraKm(): [number, number, number] {
		const o = this.frame.originKm
		const p = this.camera.position
		return [
			o[0] + p.x * KM_PER_UNIT,
			o[1] + p.y * KM_PER_UNIT,
			o[2] + p.z * KM_PER_UNIT,
		]
	}

	bodyKm(id: string): [number, number, number] {
		const i = this.frame.index.get(id) ?? 0
		const p = this.frame.displayKm
		return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
	}
}

const distance = (a: ArrayLike<number>, b: ArrayLike<number>) =>
	Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

describe("a camera standing at an eye point", () => {
	const eyeOnEarth = (h: Harness) => {
		// on the Earth's surface under the Moon
		const e = h.bodyKm("earth")
		const m = h.bodyKm("moon")
		const d = distance(m, e)
		const r = 6371 * 1.002
		return [
			((m[0] - e[0]) / d) * r,
			((m[1] - e[1]) / d) * r,
			((m[2] - e[2]) / d) * r,
		] as const
	}

	it("stands at the eye, looks at the centre and narrows the lens", () => {
		const h = new Harness()
		store().goTo(
			{ kind: "body", id: "moon" },
			{ eye: { anchorId: "earth", offsetKm: eyeOnEarth(h) }, lensDeg: 2 },
		)
		h.settle()
		const snapshot = h.director.snapshot(h.now)
		expect(snapshot.fovDeg).toBeCloseTo(2, 6)
		expect(snapshot.eyeHeld).toBe(true)
		// the camera is on the Earth's surface
		expect(distance(h.cameraKm(), h.bodyKm("earth"))).toBeCloseTo(
			6371 * 1.002,
			-1,
		)
		// the Moon is at the centre of the view
		const toMoon = new THREE.Vector3(...h.bodyKm("moon"))
			.sub(new THREE.Vector3(...h.cameraKm()))
			.normalize()
		const forward = h.camera.getWorldDirection(new THREE.Vector3())
		expect(forward.angleTo(toMoon)).toBeLessThan(1e-4)
	})

	it("keeps standing on the Earth while the Moon moves, until the user takes the camera", () => {
		const h = new Harness()
		store().goTo(
			{ kind: "body", id: "moon" },
			{ eye: { anchorId: "earth", offsetKm: eyeOnEarth(h) }, lensDeg: 2 },
		)
		h.settle()
		const eye = h.director.snapshot(h.now).cameraKm
		const offset = distance(eye, h.bodyKm("earth"))
		// an hour of simulated time: the Moon moves some 3,700 km
		h.daysPerFrame = 1 / 24 / 60
		h.step(60)
		expect(distance(h.cameraKm(), h.bodyKm("earth"))).toBeCloseTo(offset, -1)
		// the user drags: the eye is let go
		h.controls.dispatchEvent({ type: "control" })
		h.step()
		expect(h.director.snapshot(h.now).eyeHeld).toBe(false)
	})

	it("goes back to the normal lens with the next request", () => {
		const h = new Harness()
		store().goTo({ kind: "body", id: "sun" }, { lensDeg: 0.8 })
		h.settle()
		expect(h.camera.fov).toBeCloseTo(0.8, 6)
		store().goTo({ kind: "body", id: "earth" })
		h.settle()
		expect(h.camera.fov).toBe(CAMERA_FOV_DEG)
	})

	it("keeps the eye and the lens when a move is finished at once (Skip)", () => {
		const h = new Harness()
		store().goTo(
			{ kind: "body", id: "moon" },
			{ eye: { anchorId: "earth", offsetKm: eyeOnEarth(h) }, lensDeg: 2 },
		)
		h.step(3)
		store().finishMove()
		h.settle()
		expect(h.camera.fov).toBeCloseTo(2, 6)
		expect(h.director.snapshot(h.now).eyeHeld).toBe(true)
	})
})
