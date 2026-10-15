/**
 * Framing what is free (#61): the director draws what it looks at in the
 * middle of the band a phone's HUD leaves free, fits it there, follows the
 * band when the HUD settles at another size, and turns the overview to the
 * screen's home shot when the screen turns between upright and wide.
 */
import { afterEach, describe, expect, it } from "vitest"
import * as THREE from "three"
import { CameraControlsImpl } from "@react-three/drei"

import { bodies } from "@/data"
import { J2000_JD, degToRad } from "@/sim"
import { insetShares, type FreeArea } from "@/store/freeArea"
import {
	HOME_SHOT,
	OVERVIEW,
	UPRIGHT_HOME_SHOT,
	type View,
} from "@/store/navigation"
import { useSimStore } from "@/store/sim"

import { createSimFrame, updateSimFrame } from "../scene/simFrame"
import {
	CameraDirector,
	FREE_AREA_SETTLE_MS,
	type FreeAreaLike,
} from "./director"
import {
	BODY_FIT_SHARE,
	CAMERA_FAR,
	CAMERA_FOV_DEG,
	CAMERA_NEAR,
	defaultDistance,
} from "./framing"

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

/** A 390 x 844 phone: today's top stack (where, corner) and its bottom stack with the card folded. */
const PHONE: FreeArea = { width: 390, height: 844, top: 122, bottom: 206 }
/** The same phone with the card unfolded: a short band above it. */
const UNFOLDED: FreeArea = { ...PHONE, bottom: 522 }
const LAPTOP: FreeArea = { width: 1366, height: 768, top: 0, bottom: 0 }

class Harness {
	readonly camera: THREE.PerspectiveCamera
	readonly controls: CameraControlsImpl
	readonly frame = createSimFrame(bodies, J2000_JD)
	readonly free: { area: FreeArea }
	readonly director: CameraDirector
	now = 1000

	constructor(area: FreeArea) {
		this.free = { area }
		this.camera = new THREE.PerspectiveCamera(
			CAMERA_FOV_DEG,
			area.width / area.height,
			CAMERA_NEAR,
			CAMERA_FAR,
		)
		this.controls = new CameraControlsImpl(this.camera)
		const source: FreeAreaLike = { getState: () => this.free }
		this.director = new CameraDirector(
			this.controls,
			this.camera,
			this.frame,
			useSimStore,
			undefined,
			null,
			source,
		)
		this.director.attach()
	}

	step(frames = 1): void {
		for (let i = 0; i < frames; i++) {
			this.now += DT * 1000
			updateSimFrame(this.frame, J2000_JD)
			this.director.tick(this.now, DT)
		}
	}

	/** Steps past the first frames, in which a new free area is taken at once. */
	pastSettling(): void {
		this.step(Math.ceil(FREE_AREA_SETTLE_MS / (DT * 1000)) + 1)
	}

	/** Where the camera draws a point `km` (display km) on its canvas: CSS-free NDC y (up). */
	ndcY(km: ArrayLike<number>): number {
		const origin = this.frame.originKm
		const point = new THREE.Vector3(
			(km[0] - origin[0]) / 1000,
			(km[1] - origin[1]) / 1000,
			(km[2] - origin[2]) / 1000,
		)
		this.camera.updateMatrixWorld()
		return point.project(this.camera).y
	}

	defaultOf(view: View): number {
		return defaultDistance(
			view,
			this.frame,
			this.camera.fov,
			this.camera.aspect,
			insetShares(this.free.area),
		)
	}
}

const earth: View = { kind: "body", id: "earth" }

describe("framing what is free (#61)", () => {
	it("leaves a laptop's lens alone: the pivot at the centre, no view offset", () => {
		const h = new Harness(LAPTOP)
		store().jumpTo(earth, null)
		h.step(3)
		expect(h.director.snapshot().pivotLift).toBe(0)
		expect(h.camera.view?.enabled ?? false).toBe(false)
		expect(h.ndcY(h.frame.originKm)).toBeCloseTo(0, 9)
	})

	it("draws the pivot in the middle of a phone's free band from the first frame", () => {
		const h = new Harness(PHONE)
		store().jumpTo(earth, null)
		h.step()
		const lift = (PHONE.bottom - PHONE.top) / 2 / PHONE.height
		expect(h.director.snapshot().pivotLift).toBeCloseTo(lift, 9)
		// NDC y of the pivot: twice its lift (NDC spans the height twice)
		expect(h.ndcY(h.frame.originKm)).toBeCloseTo(2 * lift, 6)
		const free = { top: PHONE.top, bottom: PHONE.height - PHONE.bottom }
		const pivotPx = ((1 - h.ndcY(h.frame.originKm)) / 2) * PHONE.height
		expect(pivotPx).toBeCloseTo((free.top + free.bottom) / 2, 6)
		// framed whole in the band, at the default distance
		expect(h.director.snapshot().distance / h.defaultOf(earth)).toBeCloseTo(
			1,
			9,
		)
	})

	it("glides to a new band when the HUD settles at another size, keeping the framing", () => {
		const h = new Harness(PHONE)
		store().jumpTo(earth, null)
		h.pastSettling()
		const before = h.director.snapshot()
		h.free.area = UNFOLDED
		h.step()
		// one frame in: on its way, not there
		const target = (UNFOLDED.bottom - UNFOLDED.top) / 2 / UNFOLDED.height
		const first = h.director.snapshot().pivotLift
		expect(first).toBeGreaterThan(before.pivotLift)
		expect(first).toBeLessThan(target)
		h.step(90)
		const after = h.director.snapshot()
		expect(after.pivotLift).toBeCloseTo(target, 9)
		// the distance followed the band: still the default framing, now farther
		expect(after.distance).toBeGreaterThan(before.distance)
		expect(after.distance / h.defaultOf(earth)).toBeCloseTo(1, 6)
		// and the whole Earth is in the band, with the framing's margin
		const radius = h.frame.renderRadius(h.frame.index.get("earth")!)
		const angular = Math.tan(Math.asin(radius / after.distance))
		const band = 1 - (UNFOLDED.top + UNFOLDED.bottom) / UNFOLDED.height
		const halfBand = Math.tan(degToRad(CAMERA_FOV_DEG / 2)) * band
		expect(angular).toBeLessThanOrEqual(BODY_FIT_SHARE * halfBand * 1.0001)
		// the shot in the store keeps its multiple: nothing for the URL to churn
		expect(store().shot?.distance).toBe(1)
		// folded again: back where it was
		h.free.area = PHONE
		h.step(90)
		expect(h.director.snapshot().distance).toBeCloseTo(before.distance, 6)
	})

	it("opens the overview of an upright screen from its steeper home shot", () => {
		const h = new Harness(PHONE)
		h.step()
		const snap = h.director.snapshot()
		expect(snap.elevationDeg).toBeCloseTo(UPRIGHT_HOME_SHOT.elevationDeg, 6)
		expect(snap.distance / h.defaultOf(OVERVIEW)).toBeCloseTo(1, 9)
		expect(store().shot).toEqual(UPRIGHT_HOME_SHOT)
	})

	it("turns the resting overview to the home shot of a turned screen, and back", () => {
		const h = new Harness(LAPTOP)
		h.step()
		expect(store().shot).toEqual(HOME_SHOT)
		h.camera.aspect = 390 / 844
		h.camera.updateProjectionMatrix()
		h.free.area = PHONE
		h.step(240)
		expect(store().transition).toBeNull()
		expect(h.director.snapshot().elevationDeg).toBeCloseTo(
			UPRIGHT_HOME_SHOT.elevationDeg,
			3,
		)
		expect(store().shot).toEqual(UPRIGHT_HOME_SHOT)
		h.camera.aspect = 1366 / 768
		h.camera.updateProjectionMatrix()
		h.free.area = LAPTOP
		h.step(240)
		expect(store().shot).toEqual(HOME_SHOT)
	})

	it("leaves an overview the viewer turned alone when the screen turns", () => {
		const h = new Harness(LAPTOP)
		store().jumpTo(OVERVIEW, { azimuthDeg: 40, elevationDeg: 20, distance: 1 })
		h.step()
		h.camera.aspect = 390 / 844
		h.camera.updateProjectionMatrix()
		h.free.area = PHONE
		h.step(120)
		expect(h.director.snapshot().elevationDeg).toBeCloseTo(20, 3)
		expect(h.director.snapshot().azimuthDeg).toBeCloseTo(40, 3)
	})
})
