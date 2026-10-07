/**
 * The camera director over the real camera-controls and a real SimFrame, one
 * frame at a time with a fake clock: the navigation model driven end to end
 * with no feature code touching the camera, and every transition interrupted
 * at every point without leaving the camera stuck or the pivot orphaned.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { CameraControlsImpl } from "@react-three/drei"

import { bodies } from "@/data"
import { J2000_JD, SCALE_PRESETS } from "@/sim"
import {
	HOME_SHOT,
	OVERVIEW,
	type SequenceStep,
	type View,
	type ViewMode,
} from "@/store/navigation"
import { useSimStore } from "@/store/sim"

import {
	createSimFrame,
	setSimFrameScale,
	updateSimFrame,
	type SimFrame,
} from "../scene/simFrame"
import { CameraDirector } from "./director"
import {
	CAMERA_FAR,
	CAMERA_FOV_DEG,
	CAMERA_MAX_DISTANCE,
	CAMERA_NEAR,
	defaultDistance,
	minViewDistance,
} from "./framing"

/** What the page's press tracker says of the press under way (#49): a drag or a pinch by now. */
let grabbing = false
vi.mock("../scene/tap", async (importOriginal) => ({
	...(await importOriginal<typeof import("../scene/tap")>()),
	isPressGrab: () => grabbing,
}))

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

const ASPECT = 16 / 9
const DT = 1 / 60
type Vec = [number, number, number]

const store = () => useSimStore.getState()
const distance = (a: Vec, b: ArrayLike<number>) =>
	Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const length = (a: ArrayLike<number>) => Math.hypot(a[0], a[1], a[2])

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
	/** Simulated days per frame (0: the clock stands still). */
	daysPerFrame = 0

	constructor() {
		this.director.attach()
	}

	step(frames = 1): void {
		for (let i = 0; i < frames; i++) {
			this.now += DT * 1000
			this.jd += this.daysPerFrame
			updateSimFrame(this.frame, this.jd)
			this.director.tick(this.now, DT)
		}
	}

	/** Runs until the running transition has arrived and the controls' damping is over. */
	settle(maxMs = 8000): void {
		const end = this.now + maxMs
		const moving = () => {
			const current = this.controls.getSpherical(
				new THREE.Spherical(),
				false,
			).radius
			const goal = this.controls.getSpherical(
				new THREE.Spherical(),
				true,
			).radius
			return Math.abs(current - goal) > 1e-9 * goal
		}
		while (
			store().transition !== null ||
			this.snapshot().transitionId !== null ||
			moving()
		) {
			if (this.now > end) throw new Error("the camera never settled")
			this.step()
		}
		this.step()
	}

	snapshot() {
		return this.director.snapshot(this.now)
	}

	bodyKm(id: string): Vec {
		const i = this.frame.index.get(id)!
		const p = this.frame.displayKm
		return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
	}

	/**
	 * The user moves the camera: what camera-controls reports for a wheel, or
	 * for a drag or pinch once it has moved (a press alone is a tap, see `press`).
	 */
	grab(): void {
		this.controls.dispatchEvent({ type: "control" })
	}
}

/** The invariants of a settled camera: tracked pivot at the origin, nothing orphaned. */
function expectSettled(h: Harness, mode: ViewMode, bodyId: string) {
	const snap = h.snapshot()
	expect(store().transition).toBeNull()
	expect(snap.transitionId).toBeNull()
	expect(snap.mode).toBe(mode)
	expect(snap.finite).toBe(true)
	expect(store().focusId).toBe(bodyId)
	// the pivot is the body, and the controls orbit exactly that point
	expect(distance(snap.originKm, h.bodyKm(bodyId))).toBeLessThan(1e-6)
	expect(length(snap.targetUnits)).toBeLessThan(1e-9 * snap.distance)
	expect(snap.distance).toBeGreaterThanOrEqual(
		minViewDistance(store().view, h.frame) * (1 - 1e-9),
	)
	expect(snap.distance).toBeLessThanOrEqual(CAMERA_MAX_DISTANCE)
}

/** Drawn sizes do not depend on time: one true-scale frame sizes every expectation. */
const sizing = createSimFrame(bodies, J2000_JD)
const framing = (view: View, frame: SimFrame = sizing) =>
	defaultDistance(view, frame, CAMERA_FOV_DEG, ASPECT)

describe("CameraDirector", () => {
	it("mounts into the overview, from the home direction", () => {
		const h = new Harness()
		h.step()
		expectSettled(h, "overview", "sun")
		const snap = h.snapshot()
		expect(snap.distance / framing(OVERVIEW)).toBeCloseTo(1, 9)
		expect(snap.elevationDeg).toBeCloseTo(45, 9)
		expect(snap.azimuthDeg).toBeCloseTo(0, 9)
		expect(store().shot).toEqual(HOME_SHOT)
	})

	it("opens a deep link directly on its view and camera", () => {
		const h = new Harness()
		store().jumpTo(
			{ kind: "body", id: "saturn" },
			{ azimuthDeg: 30, elevationDeg: 20, distance: 2 },
		)
		h.step()
		expectSettled(h, "focused", "saturn")
		const snap = h.snapshot()
		expect(snap.azimuthDeg).toBeCloseTo(30, 9)
		expect(snap.elevationDeg).toBeCloseTo(20, 9)
		expect(snap.distance / framing({ kind: "body", id: "saturn" })).toBeCloseTo(
			2,
			9,
		)
	})

	it("drives select -> focus -> overview end to end through the store alone", () => {
		const h = new Harness()
		h.step()
		const home = h.snapshot().cameraKm

		store().select("saturn")
		h.step(30)
		expect(store().selectedId).toBe("saturn")
		// selecting is not moving
		expect(distance(h.snapshot().cameraKm, home)).toBe(0)
		expectSettled(h, "overview", "sun")

		store().focus("saturn")
		h.step()
		expect(h.snapshot().mode).toBe("transit")
		h.settle()
		expectSettled(h, "focused", "saturn")
		expect(
			h.snapshot().distance / framing({ kind: "body", id: "saturn" }),
		).toBeCloseTo(1, 9)
		// the viewing direction was kept
		expect(h.snapshot().elevationDeg).toBeCloseTo(45, 6)
		expect(store().shot).toEqual(HOME_SHOT)

		store().overview()
		h.settle()
		expectSettled(h, "overview", "sun")
		expect(distance(h.snapshot().cameraKm, home)).toBeLessThan(1e-3)
	})

	it("keeps tracking a focused body as it orbits", () => {
		const h = new Harness()
		store().jumpTo({ kind: "body", id: "io" })
		h.step()
		h.daysPerFrame = 0.05
		const radius = h.snapshot().distance
		for (let i = 0; i < 120; i++) {
			h.step()
			const snap = h.snapshot()
			expect(distance(snap.originKm, h.bodyKm("io"))).toBe(0)
			expect(length(snap.targetUnits)).toBe(0)
			expect(snap.distance).toBeCloseTo(radius, 9)
		}
	})

	it("meets a moving destination where it is on arrival, not where it was", () => {
		const h = new Harness()
		h.step()
		// Mercury runs a quarter of its orbit during the flight
		h.daysPerFrame = 0.25
		store().focus("mercury")
		h.settle()
		expectSettled(h, "focused", "mercury")
	})

	describe("interruptions", () => {
		const interruptions: Record<
			string,
			{
				act: (h: Harness) => void
				/** What the user goes on to do after the interrupting event. */
				then?: (h: Harness) => void
				mode: ViewMode
				body: string
			}
		> = {
			"a second selection": {
				act: () => store().setFocus("mars"),
				mode: "focused",
				body: "mars",
			},
			"a request for the overview": {
				act: () => store().overview(),
				mode: "overview",
				body: "sun",
			},
			"the way out (reset)": {
				act: () => store().reset(),
				mode: "overview",
				body: "sun",
			},
			"the user grabbing the camera": {
				act: (h) => h.grab(),
				then: (h) => {
					void h.controls.rotate(0.4, -0.2, true)
					void h.controls.dolly(-5, true)
				},
				mode: "focused",
				body: "jupiter",
			},
		}

		// "last" is the final frame before arrival
		const points = [0, 0.05, 0.25, 0.5, 0.75, 0.95, "last"] as const

		/** Flies from Earth toward Jupiter and stops at `at` of the flight; returns the last frame's camera step. */
		const flyUntil = (h: Harness, at: (typeof points)[number]): number => {
			store().jumpTo({ kind: "body", id: "earth" })
			h.step()
			store().setFocus("jupiter")
			h.step()
			let previous = h.snapshot().cameraKm
			let lastStep = 0
			const frameShare = () => (DT * 1000) / (h.snapshot().durationMs ?? 1)
			const before = (progress: number) =>
				at === "last" ? progress + 2 * frameShare() < 1 : progress < at
			while (before(h.snapshot().progress ?? 1)) {
				h.step()
				const current = h.snapshot().cameraKm
				lastStep = distance(current, previous)
				previous = current
			}
			expect(h.snapshot().mode).toBe("transit")
			return lastStep
		}

		for (const [name, { act, then, mode, body }] of Object.entries(
			interruptions,
		)) {
			it.each(points)(
				`${name} at %s of a flight retargets from where the camera is`,
				(at) => {
					const h = new Harness()
					const lastStep = flyUntil(h, at)
					const flying = h.snapshot()

					act(h)
					h.step()
					// no jump, least of all back to where the flight began
					const jump = distance(h.snapshot().cameraKm, flying.cameraKm)
					expect(jump).toBeLessThanOrEqual(3 * lastStep + 1)

					then?.(h)
					h.settle()
					expectSettled(h, mode, body)
				},
			)
		}

		it.each(points)(
			"a skip at %s of a flight lands on the destination at once",
			(at) => {
				const h = new Harness()
				flyUntil(h, at)
				store().skip()
				h.step()
				expectSettled(h, "focused", "jupiter")
				expect(
					h.snapshot().distance / framing({ kind: "body", id: "jupiter" }),
				).toBeCloseTo(1, 9)
			},
		)

		it("survives a burst of requests, one per frame", () => {
			const h = new Harness()
			h.step()
			h.daysPerFrame = 1
			const ids = ["earth", "moon", "mars", "phobos", "jupiter", "io", "sun"]
			for (const id of ids) {
				store().setFocus(id)
				h.step()
			}
			store().reset()
			h.step(3)
			store().setFocus("neptune")
			h.settle()
			expectSettled(h, "focused", "neptune")
		})

		it("keeps the user's zoom after a hand-over, but never inside the destination", () => {
			const h = new Harness()
			h.step()
			store().setFocus("jupiter")
			h.step(10)
			h.grab()
			void h.controls.dollyTo(1e-3, false)
			h.settle()
			h.step(60)
			expectSettled(h, "focused", "jupiter")
			expect(h.snapshot().distance).toBeGreaterThanOrEqual(
				minViewDistance({ kind: "body", id: "jupiter" }, h.frame) * (1 - 1e-6),
			)
		})
	})

	describe("the way out from a broken state", () => {
		it("replaces a camera that is not finite by the overview", () => {
			const h = new Harness()
			store().jumpTo({ kind: "body", id: "earth" })
			store().select("earth")
			h.step()
			void h.controls.setLookAt(NaN, 0, 0, 0, 0, 0, false)
			h.step()
			expectSettled(h, "overview", "sun")
			expect(store().selectedId).toBeNull()
		})

		it("replaces a view of a body that does not exist by the overview", () => {
			const h = new Harness()
			h.step()
			useSimStore.setState({
				view: { kind: "body", id: "vulcan" },
				focusId: "vulcan",
			})
			h.step()
			h.settle()
			expectSettled(h, "overview", "sun")
		})
	})

	describe("free movement (the pan of #15)", () => {
		it("turns a moved target into a point in space without moving anything on screen", () => {
			const h = new Harness()
			store().jumpTo({ kind: "body", id: "earth" })
			h.step()
			void h.controls.truck(50, 20, false)
			h.controls.update(0)
			const origin = h.frame.originKm
			const target = h.controls.getTarget(new THREE.Vector3(), false)
			const targetKm: Vec = [
				origin[0] + target.x * 1000,
				origin[1] + target.y * 1000,
				origin[2] + target.z * 1000,
			]
			const cameraKm: Vec = [
				origin[0] + h.camera.position.x * 1000,
				origin[1] + h.camera.position.y * 1000,
				origin[2] + h.camera.position.z * 1000,
			]
			h.step()
			const snap = h.snapshot()
			// the moved target became the origin; the camera did not move
			expect(distance(snap.originKm, targetKm)).toBeLessThan(1e-6)
			expect(length(snap.targetUnits)).toBeLessThan(1e-9)
			expect(distance(snap.cameraKm, cameraKm)).toBeLessThan(1e-6)

			// at rest the store learns about it: a point anchored to Earth
			h.controls.dispatchEvent({ type: "rest" })
			expect(store().view).toMatchObject({ kind: "point", anchorId: "earth" })
			h.step()
			expect(h.snapshot().mode).toBe("free")

			// the point keeps its place in Earth's neighbourhood as Earth moves on
			const earthBefore = h.bodyKm("earth")
			const offset = snap.originKm.map((v, i) => v - earthBefore[i])
			h.daysPerFrame = 1
			h.step(30)
			const now = h.snapshot().originKm.map((v, i) => v - h.bodyKm("earth")[i])
			expect(distance(now as Vec, offset)).toBeLessThan(1e-6)

			// and the way out still works from here
			store().reset()
			h.settle()
			expectSettled(h, "overview", "sun")
		})
	})

	describe("scripted sequences", () => {
		it("plays every stop in order, holds, and ends on the last one", () => {
			const h = new Harness()
			h.step()
			const steps: SequenceStep[] = [
				{ view: { kind: "body", id: "earth" }, holdMs: 300 },
				{ view: { kind: "body", id: "moon" }, holdMs: 300, durationMs: 500 },
				{ view: OVERVIEW, holdMs: 100 },
			]
			const visited: string[] = []
			const unsubscribe = useSimStore.subscribe((state, previous) => {
				if (state.transition === null && previous.transition !== null) {
					visited.push(state.focusId)
				}
			})
			store().playSequence(steps)
			const end = h.now + 15000
			while (store().sequence !== null && h.now < end) h.step()
			unsubscribe()
			expect(store().sequence).toBeNull()
			expect(visited).toEqual(["earth", "moon", "sun"])
			expectSettled(h, "overview", "sun")
		})

		it("pauses on user input and resumes at the same stop", () => {
			const h = new Harness()
			h.step()
			store().playSequence([
				{ view: { kind: "body", id: "mars" }, holdMs: 100 },
				{ view: { kind: "body", id: "phobos" }, holdMs: 100 },
			])
			h.step(5)
			h.grab()
			expect(store().sequence?.phase).toBe("interrupted")
			h.settle()
			h.step(60)
			// still at the first stop: nothing advanced behind the user's back
			expect(store().sequence).toMatchObject({ index: 0, phase: "interrupted" })
			expectSettled(h, "focused", "mars")
			store().resumeSequence()
			const end = h.now + 10000
			while (store().sequence !== null && h.now < end) h.step()
			expectSettled(h, "focused", "phobos")
		})

		it("lets a tap go by, and takes over once the press is a drag or a pinch (#49)", () => {
			const h = new Harness()
			h.step()
			store().playSequence([
				{ view: { kind: "body", id: "mars" }, holdMs: 100 },
				{ view: { kind: "body", id: "phobos" }, holdMs: 100 },
			])
			h.step(5)
			// a finger lands and wobbles a little: a tap, not a grab
			grabbing = false
			h.controls.dispatchEvent({ type: "controlstart" })
			h.controls.dispatchEvent({ type: "control" })
			h.step()
			expect(store().sequence?.phase).toBe("moving")
			expect(store().transition?.handedOver).toBe(false)
			// then it wanders off (or a second finger lands): the camera is the user's
			grabbing = true
			h.controls.dispatchEvent({ type: "control" })
			expect(store().sequence?.phase).toBe("interrupted")
			expect(store().transition?.handedOver).toBe(true)
			h.controls.dispatchEvent({ type: "controlend" })
			grabbing = false
		})
	})

	describe("scale presets (#8, #21)", () => {
		const visible = SCALE_PRESETS.everythingVisible

		it("frames and tracks the drawn body, not the true one", () => {
			const h = new Harness()
			setSimFrameScale(h.frame, visible)
			store().jumpTo({ kind: "body", id: "earth" })
			h.step()
			expectSettled(h, "focused", "earth")
			const view: View = { kind: "body", id: "earth" }
			expect(h.snapshot().distance / framing(view, h.frame)).toBeCloseTo(1, 9)
			// the origin sits on the drawn position, which differs from the true one
			const i = h.frame.index.get("earth")!
			expect(h.frame.displayKm[i * 3]).not.toBe(h.frame.positionsKm[i * 3])
		})

		it("keeps the focus the same size on screen when the scale changes", () => {
			const h = new Harness()
			store().jumpTo({ kind: "body", id: "jupiter" }, { distance: 3 })
			h.step()
			setSimFrameScale(h.frame, visible)
			h.step()
			expectSettled(h, "focused", "jupiter")
			const view: View = { kind: "body", id: "jupiter" }
			expect(h.snapshot().distance / framing(view, h.frame)).toBeCloseTo(3, 9)
		})

		it("keeps the whole system in the overview when the scale changes", () => {
			const h = new Harness()
			h.step()
			setSimFrameScale(h.frame, visible)
			h.step()
			expectSettled(h, "overview", "sun")
			expect(h.snapshot().distance / framing(OVERVIEW, h.frame)).toBeCloseTo(
				1,
				9,
			)
		})

		it("lands on the new framing when the scale changes mid-flight", () => {
			const h = new Harness()
			h.step()
			store().setFocus("saturn")
			h.step(10)
			setSimFrameScale(h.frame, visible)
			h.settle()
			expectSettled(h, "focused", "saturn")
			const view: View = { kind: "body", id: "saturn" }
			expect(h.snapshot().distance / framing(view, h.frame)).toBeCloseTo(1, 9)
		})
	})

	it("publishes the camera when it comes to rest after the user moved it", () => {
		const h = new Harness()
		store().jumpTo({ kind: "body", id: "earth" })
		h.step()
		void h.controls.rotate(Math.PI / 2, 0, false)
		h.step()
		h.controls.dispatchEvent({ type: "rest" })
		expect(store().shot?.azimuthDeg).toBeCloseTo(90, 6)
		expect(store().shot?.elevationDeg).toBeCloseTo(45, 6)
	})
})
