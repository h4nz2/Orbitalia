/**
 * Re-centring (#15) through the real camera director and camera-controls,
 * frame by frame: a released pan becomes a point in space anchored to the
 * body whose neighbourhood it is in, lands on a body it was dropped on, and
 * never moves anything on screen when it is committed.
 */
import { afterEach, describe, expect, it } from "vitest"
import * as THREE from "three"
import { CameraControlsImpl } from "@react-three/drei"

import { bodies } from "@/data"
import { AU_KM, J2000_JD, KM_PER_UNIT, SCALE_PRESETS } from "@/sim"
import { OVERVIEW, type View } from "@/store/navigation"
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
	minViewDistance,
} from "./framing"
import { pointDisplayKm } from "./recentre"

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
	readonly frame = createSimFrame(bodies, J2000_JD)
	readonly director = new CameraDirector(
		this.controls,
		this.camera,
		this.frame,
		useSimStore,
	)
	now = 1000
	jd = J2000_JD
	daysPerFrame = 0

	constructor(view?: View) {
		this.director.attach()
		if (view !== undefined) store().jumpTo(view)
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

	/** Runs until nothing moves any more: transitions over, damping over, pans committed. */
	settle(maxMs = 8000): void {
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
			this.snapshot().transitionId !== null ||
			moving() ||
			store().panning
		)
	}

	snapshot() {
		return this.director.snapshot(this.now)
	}

	bodyKm(id: string): Vec {
		const i = this.frame.index.get(id)!
		const p = this.frame.displayKm
		return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
	}

	/** The pivot the controls orbit, display km. */
	pivotKm(): Vec {
		const t = this.controls.getTarget(new THREE.Vector3(), false)
		const o = this.frame.originKm
		return [
			o[0] + t.x * KM_PER_UNIT,
			o[1] + t.y * KM_PER_UNIT,
			o[2] + t.z * KM_PER_UNIT,
		]
	}

	/** A pan gesture that moves the pivot to `km` (display km) and lets go. */
	panTo(km: ArrayLike<number>): void {
		const o = this.frame.originKm
		this.controls.dispatchEvent({ type: "control" })
		void this.controls.moveTo(
			(km[0] - o[0]) / KM_PER_UNIT,
			(km[1] - o[1]) / KM_PER_UNIT,
			(km[2] - o[2]) / KM_PER_UNIT,
			// damped, like a released drag
			true,
		)
	}
}

describe("re-centring (#15)", () => {
	it("turns a pan into empty space into a point anchored to the Sun, with nothing moving on screen", () => {
		const h = new Harness()
		const radius = h.snapshot().distance
		// in the asteroid belt, between the orbits of Mars and Jupiter, and
		// in a direction with no planet near it
		const clearance = (deg: number) => {
			const p = [2.8 * AU_KM * Math.cos(deg), 0, 2.8 * AU_KM * Math.sin(deg)]
			return Math.min(
				...["mercury", "venus", "earth", "mars", "jupiter"].map((id) =>
					distance(p, h.bodyKm(id)),
				),
			)
		}
		const angles = Array.from({ length: 36 }, (_, k) => (k * Math.PI) / 18)
		const angle = angles.reduce((a, b) => (clearance(b) > clearance(a) ? b : a))
		const offset: Vec = [
			2.8 * AU_KM * Math.cos(angle),
			0,
			2.8 * AU_KM * Math.sin(angle),
		]
		const target = pointDisplayKm(
			h.frame,
			h.frame.index.get("sun")!,
			offset,
			new Float64Array(3),
		)
		h.panTo(target)
		h.step(2)
		expect(store().panning).toBe(true)
		// frame by frame until the store learns about the point: the commit
		// itself moves nothing on screen
		const tolerance = 1e-3 * radius * KM_PER_UNIT
		let camera = h.snapshot().cameraKm
		for (let i = 0; i < 600 && store().view.kind !== "point"; i++) {
			const before = camera
			h.step()
			camera = h.snapshot().cameraKm
			expect(distance(camera, before)).toBeLessThan(0.2 * radius * KM_PER_UNIT)
		}
		const committed = h.snapshot().cameraKm
		h.step()
		expect(distance(h.snapshot().cameraKm, committed)).toBeLessThan(tolerance)
		h.settle()

		expect(store().panning).toBe(false)
		const view = store().view
		expect(view).toMatchObject({ kind: "point", anchorId: "sun" })
		expect(h.snapshot().mode).toBe("free")
		// the offset is true km from the anchor (true scale: drawn = true)
		if (view.kind !== "point") throw new Error("not a point")
		expect(distance(view.offsetKm, offset)).toBeLessThan(tolerance)
		expect(distance(h.pivotKm(), target)).toBeLessThan(tolerance)
		expect(h.snapshot().distance).toBeCloseTo(radius, 6)
		// the selection is not touched by a camera gesture
		expect(store().selectedId).toBeNull()

		// the way back
		store().reset()
		h.settle()
		expect(store().view).toEqual(OVERVIEW)
		expect(distance(h.snapshot().originKm, h.bodyKm("sun"))).toBeLessThan(1e-6)
	})

	it("re-anchors a point to the body whose neighbourhood it lands in, and follows that body", () => {
		const h = new Harness({ kind: "body", id: "jupiter" })
		h.settle()
		const r = h.frame.displayRadiiKm[h.frame.index.get("jupiter")!]
		const jupiter = h.bodyKm("jupiter")
		// 20 radii off Jupiter: well inside its Hill sphere, off its disc on screen
		h.panTo([jupiter[0] + 20 * r, jupiter[1], jupiter[2]])
		h.settle()
		expect(store().view).toMatchObject({ kind: "point", anchorId: "jupiter" })
		expect(store().focusId).toBe("jupiter")

		// the point travels with Jupiter
		const before = h.pivotKm().map((v, k) => v - h.bodyKm("jupiter")[k])
		h.daysPerFrame = 2
		h.step(30)
		const after = h.pivotKm().map((v, k) => v - h.bodyKm("jupiter")[k])
		expect(distance(before, after)).toBeLessThan(1e-3)

		// the zoom limit is Jupiter's, not a point's
		expect(h.controls.minDistance).toBe(minViewDistance(store().view, h.frame))
	})

	it("lets a pan out of a planet's neighbourhood stay put relative to the Sun", () => {
		const h = new Harness({ kind: "body", id: "earth" })
		h.settle()
		const earth = h.bodyKm("earth")
		h.panTo([earth[0] + 0.2 * AU_KM, earth[1], earth[2]])
		h.settle()
		expect(store().view).toMatchObject({ kind: "point", anchorId: "sun" })
	})

	it("snaps back onto the focused body when the pan never left its disc", () => {
		const h = new Harness({ kind: "body", id: "mars" })
		h.settle()
		store().select("earth")
		const r = h.frame.displayRadiiKm[h.frame.index.get("mars")!]
		const mars = h.bodyKm("mars")
		const radius = h.snapshot().distance
		h.panTo([mars[0] + 0.5 * r, mars[1] + 0.2 * r, mars[2]])
		h.settle()
		expect(store().view).toEqual({ kind: "body", id: "mars" })
		expect(h.snapshot().mode).toBe("focused")
		expect(distance(h.snapshot().originKm, h.bodyKm("mars"))).toBeLessThan(1e-6)
		expect(h.snapshot().distance).toBeCloseTo(radius, 3)
		expect(store().selectedId).toBe("earth")
	})

	it("re-centres on a planet dragged to the middle of the screen, keeping the distance", () => {
		const h = new Harness()
		const radius = h.snapshot().distance
		h.panTo(h.bodyKm("saturn"))
		h.settle()
		expect(store().view).toEqual({ kind: "body", id: "saturn" })
		expect(distance(h.snapshot().originKm, h.bodyKm("saturn"))).toBeLessThan(
			1e-6,
		)
		expect(h.snapshot().distance / radius).toBeCloseTo(1, 3)
	})

	it("stays the overview after a small pan in the overview", () => {
		const h = new Harness()
		const sun = h.bodyKm("sun")
		const r = h.frame.displayRadiiKm[h.frame.index.get("sun")!]
		h.panTo([sun[0] + r, sun[1], sun[2]])
		h.settle()
		expect(store().view).toEqual(OVERVIEW)
		expect(h.snapshot().mode).toBe("overview")
	})

	it("keeps a point in its neighbourhood when the scale changes", () => {
		const h = new Harness({ kind: "body", id: "earth" })
		h.settle()
		const earth = h.bodyKm("earth")
		const r = h.frame.displayRadiiKm[h.frame.index.get("earth")!]
		h.panTo([earth[0] + 30 * r, earth[1], earth[2]])
		h.settle()
		const view = store().view
		expect(view).toMatchObject({ kind: "point", anchorId: "earth" })
		if (view.kind !== "point") throw new Error("not a point")

		setSimFrameScale(h.frame, SCALE_PRESETS.everythingVisible)
		h.step()
		const expected = pointDisplayKm(
			h.frame,
			h.frame.index.get("earth")!,
			view.offsetKm,
			new Float64Array(3),
		)
		expect(distance(h.snapshot().originKm, expected)).toBeLessThan(1e-3)
		// still drawn outside Earth, in the same direction from it
		const drawnEarth = h.bodyKm("earth")
		const drawnR = h.frame.displayRadiiKm[h.frame.index.get("earth")!]
		expect(distance(expected, drawnEarth)).toBeGreaterThan(drawnR)
		expect(expected[0] - drawnEarth[0]).toBeGreaterThan(0)
	})

	it("flies to a point view from a link, framed from its anchor's default distance", () => {
		const h = new Harness()
		const view: View = {
			kind: "point",
			anchorId: "saturn",
			offsetKm: [2e6, 0, 0],
		}
		store().goTo(view)
		h.settle()
		expect(h.snapshot().mode).toBe("free")
		const expected = pointDisplayKm(
			h.frame,
			h.frame.index.get("saturn")!,
			view.offsetKm,
			new Float64Array(3),
		)
		expect(distance(h.snapshot().originKm, expected)).toBeLessThan(1e-3)
		expect(h.snapshot().distance).toBeCloseTo(
			defaultDistance(view, h.frame, CAMERA_FOV_DEG, ASPECT),
			3,
		)
	})
})
