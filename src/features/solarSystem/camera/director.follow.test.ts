/**
 * Following a spacecraft (#57) through the camera director, frame by frame:
 * the craft stays centred while time runs (forwards and backwards), the view
 * can be turned and zoomed without ending it, the camera's distance does not
 * jump when the craft moves between a planet's neighbourhood and open space,
 * a scale change rescales it with the drawing round the craft, and the way
 * out gives back normal control.
 */
import { afterEach, describe, expect, it } from "vitest"
import * as THREE from "three"
import { CameraControlsImpl } from "@react-three/drei"

import { bodies } from "@/data"
import { J2000_JD, SCALE_PRESETS, interpolateScale } from "@/sim"
import { useSimStore } from "@/store/sim"

import {
	createSimFrame,
	setSimFrameScale,
	updateSimFrame,
} from "../scene/simFrame"
import { CameraDirector, type CraftLocator } from "./director"
import {
	CAMERA_FAR,
	CAMERA_FOV_DEG,
	CAMERA_NEAR,
	CRAFT_FRAMING_DISTANCE,
	CRAFT_MIN_DISTANCE,
} from "./framing"

// camera-controls creates a DOMRect when constructed; node has none
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

/**
 * A craft that flies a straight line past Jupiter at a steady speed, its
 * neighbourhood Jupiter's while it is within 50 drawn Jupiter radii of it,
 * the Sun's otherwise; `drawn` false hides it (before launch, after its end).
 */
class FakeCraft implements CraftLocator {
	drawn = true
	scale = 1
	readonly at = new Float64Array(3)
	constructor(
		readonly frame: ReturnType<typeof createSimFrame>,
		readonly jupiter = frame.index.get("jupiter")!,
	) {}
	place(t: number): void {
		const j = this.jupiter * 3
		const r = this.frame.displayRadiiKm[this.jupiter]
		this.at[0] = this.frame.displayKm[j] + 5 * r
		this.at[1] = this.frame.displayKm[j + 1]
		this.at[2] = this.frame.displayKm[j + 2] + t * r
	}
	near(): boolean {
		const r = this.frame.displayRadiiKm[this.jupiter]
		const j = this.jupiter * 3
		return (
			Math.hypot(
				this.at[0] - this.frame.displayKm[j],
				this.at[2] - this.frame.displayKm[j + 2],
			) <
			50 * r
		)
	}
	locate(id: string, out: Float64Array): number {
		if (id !== "voyager1" || !this.drawn) return -1
		out.set(this.at)
		return this.near() ? this.jupiter : this.frame.index.get("sun")!
	}
	lengthScale(id: string): number {
		return id === "voyager1" && this.drawn ? this.scale : Number.NaN
	}
}

class Harness {
	readonly camera = new THREE.PerspectiveCamera(
		CAMERA_FOV_DEG,
		16 / 9,
		CAMERA_NEAR,
		CAMERA_FAR,
	)
	readonly controls = new CameraControlsImpl(this.camera)
	readonly frame = createSimFrame(bodies, J2000_JD)
	readonly craft = new FakeCraft(this.frame)
	readonly director = new CameraDirector(
		this.controls,
		this.camera,
		this.frame,
		useSimStore,
		undefined,
		this.craft,
	)
	now = 1000
	/** The craft's place along its line (drawn Jupiter radii from closest), and its step per frame. */
	t = -100
	perFrame = 0

	constructor() {
		this.director.attach()
		this.craft.place(this.t)
	}

	step(frames = 1): void {
		for (let i = 0; i < frames; i++) {
			this.now += DT * 1000
			this.t += this.perFrame
			updateSimFrame(this.frame, J2000_JD)
			this.craft.place(this.t)
			this.director.tick(this.now, DT)
		}
	}

	settle(maxMs = 8000): void {
		const end = this.now + maxMs
		while (
			store().transition !== null ||
			this.snapshot().transitionId !== null
		) {
			if (this.now > end) throw new Error("the camera never settled")
			this.step()
		}
		this.step(60)
	}

	snapshot() {
		return this.director.snapshot(this.now)
	}

	/** How far the pivot is from the craft, km. */
	offCentreKm(): number {
		const origin = this.snapshot().originKm
		return Math.hypot(
			origin[0] - this.craft.at[0],
			origin[1] - this.craft.at[1],
			origin[2] - this.craft.at[2],
		)
	}

	follow(distance = 2): void {
		store().goTo(
			{ kind: "craft", id: "voyager1", anchorId: "sun" },
			{ shot: { azimuthDeg: 30, elevationDeg: 40, distance } },
		)
	}
}

describe("following a spacecraft (#57)", () => {
	it("keeps the craft centred while time runs, forwards and backwards", () => {
		const h = new Harness()
		h.step()
		h.follow()
		h.settle()
		expect(h.snapshot().mode).toBe("following")
		const distance = h.snapshot().distance
		expect(distance).toBeCloseTo(2 * CRAFT_FRAMING_DISTANCE, 6)
		for (const perFrame of [0.5, -0.5, 3]) {
			h.perFrame = perFrame
			for (let i = 0; i < 60; i++) {
				h.step()
				expect(h.offCentreKm()).toBe(0)
				expect(h.snapshot().distance).toBeCloseTo(distance, 6)
			}
		}
	})

	it("holds its distance while the craft moves between a planet's neighbourhood and open space", () => {
		const h = new Harness()
		h.step()
		h.follow()
		h.settle()
		expect(store().view).toMatchObject({ anchorId: "sun" })
		const distance = h.snapshot().distance
		const anchors = ["sun"]
		h.perFrame = 1
		for (let i = 0; i < 200; i++) {
			h.step()
			if (store().focusId !== anchors[anchors.length - 1]) {
				anchors.push(store().focusId)
			}
			expect(h.offCentreKm()).toBe(0)
			// no jump, and no creep either
			expect(h.snapshot().distance / distance).toBeCloseTo(1, 9)
		}
		// it passed through Jupiter's neighbourhood and out again
		expect(anchors).toEqual(["sun", "jupiter", "sun"])
		expect(store().view).toMatchObject({ kind: "craft", anchorId: "sun" })
		expect(store().frameId).toBe("sun")
	})

	it("can be turned and zoomed without ending it; panning does not move the centre", () => {
		const h = new Harness()
		h.step()
		h.follow()
		h.settle()
		h.perFrame = 0.5
		expect(h.controls.truckSpeed).toBe(0)
		void h.controls.rotate(0.6, 0.2, false)
		void h.controls.dollyTo(0.5 * CRAFT_FRAMING_DISTANCE, false)
		h.controls.dispatchEvent({ type: "control" })
		h.step(30)
		expect(store().view.kind).toBe("craft")
		expect(h.offCentreKm()).toBe(0)
		expect(h.snapshot().distance).toBeCloseTo(0.5 * CRAFT_FRAMING_DISTANCE, 6)
		// a craft has no size: the closest dolly is a fixed one
		void h.controls.dollyTo(0, false)
		h.step(30)
		expect(h.snapshot().distance).toBeCloseTo(CRAFT_MIN_DISTANCE, 9)
	})

	it("rescales its distance with the drawing round the craft when the scale changes", () => {
		const h = new Harness()
		h.step()
		h.follow()
		h.settle()
		const distance = h.snapshot().distance
		// the drawing round the craft grows 3 times (a scale switch, in steps)
		for (let k = 1; k <= 10; k++) {
			h.craft.scale = 3 ** (k / 10)
			setSimFrameScale(
				h.frame,
				interpolateScale(
					SCALE_PRESETS.trueScale,
					SCALE_PRESETS.everythingVisible,
					k / 10,
				),
			)
			h.step()
			expect(h.offCentreKm()).toBeLessThan(1e-6)
			expect(h.snapshot().distance / distance).toBeCloseTo(3 ** (k / 10), 6)
		}
	})

	it("waits where the craft was last seen while it is not drawn", () => {
		const h = new Harness()
		h.step()
		h.follow()
		h.settle()
		const seen = h.snapshot().originKm
		h.craft.drawn = false
		h.perFrame = 2
		h.step(30)
		expect(store().view.kind).toBe("craft")
		const origin = h.snapshot().originKm
		expect(Math.hypot(origin[0] - seen[0], origin[2] - seen[2])).toBeLessThan(
			1e-6,
		)
		h.craft.drawn = true
		h.step()
		expect(h.offCentreKm()).toBe(0)
	})

	it("ends with the way out, which gives back the pan", () => {
		const h = new Harness()
		h.step()
		h.follow()
		h.settle()
		expect(h.controls.truckSpeed).toBe(0)
		store().reset()
		h.settle()
		expect(h.snapshot().mode).toBe("overview")
		expect(h.controls.truckSpeed).toBeGreaterThan(0)
	})
})
