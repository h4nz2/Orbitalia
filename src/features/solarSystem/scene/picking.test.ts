import { describe, expect, it } from "vitest"
import { PerspectiveCamera, Vector3 } from "three"

import { bodies, type Body } from "@/data"
import { AU_KM, J2000_JD, TRUE_SCALE, toUnits } from "@/sim"
import { OVERVIEW, type View } from "@/store/navigation"

import {
	NEAR_MISS_FACTOR,
	REFRAME_DISTANCE,
	TARGET_RADIUS_PX,
	bodyClickAction,
	emptyClickAction,
	hasGenerousTarget,
	isNearAnyBody,
	pickBody,
	pixelsPerUnitAtDistanceOne,
	type PickFrame,
} from "./picking"
import { createSimFrame, updateSimFrame } from "./simFrame"

const HEIGHT_PX = 800
const camera = new PerspectiveCamera(45, 1.5, 1e-5, 1e9)
const PX_PER_UNIT = pixelsPerUnitAtDistanceOne(camera, HEIGHT_PX)
const index = (id: string): number => bodies.findIndex((b) => b.id === id)
const everything = () => true

/** A hand-made frame: bodies at given render positions and radii (scene units). */
const toyFrame = (
	entries: { id: string; at: [number, number, number]; radius: number }[],
): PickFrame => {
	const list = entries.map(({ id }) => bodies[index(id)])
	return {
		bodies: list,
		renderPosition: (i, out) => out.set(...entries[i].at),
		renderRadius: (i) => entries[i].radius,
	}
}

const origin = new Vector3(0, 0, 0)
/** A ray from the origin towards the point `px` pixels right of the -Z axis at distance `d`. */
const rayAtPx = (px: number, d = 100) =>
	new Vector3((px / PX_PER_UNIT) * d, 0, -d).normalize()

const pick = (frame: PickFrame, direction: Vector3, targetRadiusPx = 12) =>
	pickBody(frame, origin, direction, {
		pxPerUnit: PX_PER_UNIT,
		targetRadiusPx,
		isShown: everything,
	})

/** 1 px at distance 100, in scene units. */
const px = 100 / PX_PER_UNIT

describe("pickBody", () => {
	it("hits a sub-pixel body anywhere within the target radius", () => {
		const frame = toyFrame([
			{ id: "mercury", at: [0, 0, -100], radius: 0.01 * px },
		])
		expect(pick(frame, rayAtPx(0))?.index).toBe(0)
		expect(pick(frame, rayAtPx(11))?.index).toBe(0)
		expect(pick(frame, rayAtPx(13))).toBeNull()
		// a finger gets a bigger target than a mouse
		expect(pick(frame, rayAtPx(20), TARGET_RADIUS_PX.touch)?.index).toBe(0)
		expect(TARGET_RADIUS_PX.touch).toBeGreaterThan(TARGET_RADIUS_PX.mouse)
	})

	it("hits a big body on its disc only, nearest disc first", () => {
		const frame = toyFrame([
			{ id: "jupiter", at: [0, 0, -100], radius: 100 * px },
			{ id: "saturn", at: [0, 0, -1000], radius: 2000 * px },
		])
		const hit = pick(frame, rayAtPx(50))
		expect(hit).toMatchObject({ index: 0, onDisc: true })
		expect(hit!.distance).toBeLessThan(100)
		// just beside Jupiter's disc, Saturn (behind, still bigger) is hit
		expect(pick(frame, rayAtPx(105))?.index).toBe(1)
	})

	it("prefers a planet within reach over a nearer moon", () => {
		const frame = toyFrame([
			{ id: "jupiter", at: [0, 0, -100], radius: 0.5 * px },
			{ id: "io", at: [5 * px, 0, -100], radius: 0.1 * px },
			{ id: "europa", at: [30 * px, 0, -100], radius: 0.1 * px },
		])
		// aimed exactly at Io: Jupiter is 5 px away and still wins
		expect(pick(frame, rayAtPx(5))?.index).toBe(0)
		// aimed near Europa, out of Jupiter's reach
		expect(pick(frame, rayAtPx(26))?.index).toBe(2)
	})

	it("lets a moon's visible disc under the pointer beat a planet nearby", () => {
		const frame = toyFrame([
			{ id: "jupiter", at: [0, 0, -100], radius: 4 * px },
			{ id: "io", at: [10 * px, 0, -100], radius: 3 * px },
		])
		expect(pick(frame, rayAtPx(10))?.index).toBe(1)
		// between them, off both discs: the planet
		expect(pick(frame, rayAtPx(5))?.index).toBe(0)
	})

	it("lets a small body in front of a disc win, and hides one behind it", () => {
		const front = toyFrame([
			{ id: "jupiter", at: [0, 0, -100], radius: 50 * px },
			{ id: "io", at: [10 * px * 0.5, 0, -50], radius: 0.2 * px },
		])
		// Io at 50 units is 10 px right of centre; the pointer 3 px from it
		expect(pick(front, rayAtPx(13, 100))?.index).toBe(1)
		const behind = toyFrame([
			{ id: "jupiter", at: [0, 0, -100], radius: 50 * px },
			{ id: "io", at: [10 * px * 2, 0, -200], radius: 0.2 * px },
		])
		expect(pick(behind, rayAtPx(10))?.index).toBe(0)
	})

	it("skips hidden bodies and bodies without a generous target", () => {
		const frame = toyFrame([{ id: "io", at: [0, 0, -100], radius: 0.01 * px }])
		const direction = rayAtPx(3)
		const options = { pxPerUnit: PX_PER_UNIT, targetRadiusPx: 12 }
		expect(
			pickBody(frame, origin, direction, { ...options, isShown: () => false }),
		).toBeNull()
		expect(
			pickBody(frame, origin, direction, {
				...options,
				isShown: everything,
				hasTarget: () => false,
			}),
		).toBeNull()
	})

	it("ignores bodies behind the eye", () => {
		const frame = toyFrame([{ id: "mars", at: [0, 0, 100], radius: 1 }])
		expect(pick(frame, new Vector3(0, 0, -1))).toBeNull()
	})

	it("at true scale, 7 AU above the Sun, a click near sub-pixel Jupiter picks Jupiter", () => {
		const frame = createSimFrame(bodies, J2000_JD, TRUE_SCALE)
		updateSimFrame(frame, J2000_JD)
		const eye = new Vector3(0, toUnits(7 * AU_KM), 0)
		const jupiter = index("jupiter")
		const target = frame.renderPosition(jupiter, new Vector3())
		const distance = target.distanceTo(eye)
		// Jupiter is well under a pixel wide from here
		expect((frame.renderRadius(jupiter) / distance) * PX_PER_UNIT).toBeLessThan(
			1,
		)
		const direction = target.clone().sub(eye).normalize()
		// 8 px off
		direction.x += 8 / PX_PER_UNIT
		direction.normalize()
		const hit = pickBody(frame, eye, direction, {
			pxPerUnit: PX_PER_UNIT,
			targetRadiusPx: TARGET_RADIUS_PX.mouse,
			isShown: everything,
		})
		expect(hit?.index).toBe(jupiter)
	})
})

describe("isNearAnyBody", () => {
	it("counts a click within reach of a drawn edge as a near miss", () => {
		const frame = toyFrame([{ id: "mars", at: [0, 0, -100], radius: 10 * px }])
		const reach = TARGET_RADIUS_PX.mouse * NEAR_MISS_FACTOR
		const near = (at: number) =>
			isNearAnyBody(frame, origin, rayAtPx(at), PX_PER_UNIT, reach, everything)
		expect(near(0)).toBe(true)
		expect(near(10 + reach - 1)).toBe(true)
		expect(near(10 + reach + 2)).toBe(false)
	})
})

describe("hasGenerousTarget", () => {
	const moon = { kind: "moon" } as Pick<Body, "kind">
	it("gives the Sun and planets a target always, moons only while visible", () => {
		expect(hasGenerousTarget({ kind: "planet" }, 0.01, false)).toBe(true)
		expect(hasGenerousTarget({ kind: "star" }, 0.01, false)).toBe(true)
		expect(hasGenerousTarget(moon, 0.01, true)).toBe(true)
		expect(hasGenerousTarget(moon, 2, false)).toBe(true)
		expect(hasGenerousTarget(moon, 0.01, false)).toBe(false)
	})
})

describe("bodyClickAction", () => {
	const mars: View = { kind: "body", id: "mars" }
	it("focuses anything but the framed, selected focus", () => {
		expect(bodyClickAction({ view: OVERVIEW, selectedId: null }, "mars")).toBe(
			"focus",
		)
		expect(bodyClickAction({ view: mars, selectedId: "earth" }, "mars")).toBe(
			"focus",
		)
		expect(bodyClickAction({ view: mars, selectedId: "mars" }, "phobos")).toBe(
			"focus",
		)
		expect(bodyClickAction({ view: mars, selectedId: "mars" }, "mars")).toBe(
			"none",
		)
		const shot = { azimuthDeg: 0, elevationDeg: 0, distance: 1 }
		expect(
			bodyClickAction({ view: mars, selectedId: "mars", shot }, "mars"),
		).toBe("none")
	})

	it("flies back to the close-up of a focus dollied far away", () => {
		const shot = {
			azimuthDeg: 0,
			elevationDeg: 0,
			distance: REFRAME_DISTANCE * 4,
		}
		expect(
			bodyClickAction(
				{ view: { kind: "body", id: "mars" }, selectedId: "mars", shot },
				"mars",
			),
		).toBe("reframe")
	})
})

describe("emptyClickAction", () => {
	const base = { selectedId: null, sequence: null }
	const mars: View = { kind: "body", id: "mars" }

	it("never leaves a focused or free view (#47)", () => {
		expect(emptyClickAction({ ...base, view: mars }, false)).toBe("none")
		// the focused body stays selected: its card stays, the planet is no click target
		expect(
			emptyClickAction({ ...base, selectedId: "mars", view: mars }, false),
		).toBe("none")
		expect(
			emptyClickAction(
				{
					...base,
					view: { kind: "point", anchorId: "mars", offsetKm: [1, 0, 0] },
				},
				false,
			),
		).toBe("none")
	})

	it("lets go of a body selected besides the one in view", () => {
		expect(
			emptyClickAction({ ...base, selectedId: "phobos", view: mars }, false),
		).toBe("deselect")
		// a free view shows the selection's card: it closes
		expect(
			emptyClickAction(
				{
					...base,
					selectedId: "mars",
					view: { kind: "point", anchorId: "mars", offsetKm: [1, 0, 0] },
				},
				false,
			),
		).toBe("deselect")
	})

	it("only clears the selection in the overview", () => {
		expect(emptyClickAction({ ...base, view: OVERVIEW }, false)).toBe("none")
		expect(
			emptyClickAction({ ...base, selectedId: "mars", view: OVERVIEW }, false),
		).toBe("deselect")
	})

	it("never acts on a near miss or during a tour", () => {
		const selected = { ...base, selectedId: "phobos", view: mars }
		expect(emptyClickAction(selected, true)).toBe("none")
		expect(
			emptyClickAction(
				{
					...selected,
					sequence: {
						steps: [{ view: mars }],
						index: 0,
						phase: "waiting",
						holdUntil: null,
						transitionId: 1,
					},
				},
				false,
			),
		).toBe("none")
	})
})
