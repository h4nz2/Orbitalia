import { afterEach, describe, expect, it } from "vitest"
import { PerspectiveCamera } from "three"

import { belts, bodies } from "@/data"
import { J2000_JD, SCALE_PRESETS } from "@/sim"
import { useSimStore } from "@/store/sim"

import { overviewDistance } from "../camera/framing"
import {
	MAX_LABEL_SPOTS,
	createLabelLayout,
	setKeepOut,
	staticLabelRanks,
	type LabelLayout,
} from "../labels/layout"
import {
	fillLabelLayout,
	labelSlotCount,
	type LabelFrameState,
} from "../labels/project"
import { createSimFrame, updateSimFrame } from "../scene/simFrame"
import {
	BELT_LABEL_MAX_VIEWPORTS,
	BELT_LABEL_MIN_PX,
	BELT_SPOTS,
	beltLabelRank,
	beltNameShown,
	createBeltLabels,
} from "./beltLabels"

const n = bodies.length
const firstSlot = labelSlotCount(n)
const ranks = staticLabelRanks(bodies)
const WIDTH = 1366
const HEIGHT = 768
const state: LabelFrameState = {
	focusId: "sun",
	selectedId: null,
	hoverId: null,
	showMoons: true,
	showAllMoons: false,
	showMarkers: true,
	showOrbits: true,
	showOrbitLabels: false,
}

const frame = createSimFrame(bodies, J2000_JD, SCALE_PRESETS.everythingVisible)
updateSimFrame(frame, J2000_JD, 0)
const extension = createBeltLabels(frame, belts, firstSlot)

/** The camera `factor` x the overview's distance from the Sun, 45° above the planets. */
function lay(factor: number, layout?: LabelLayout): LabelLayout {
	const out = layout ?? createLabelLayout(firstSlot + belts.length)
	if (layout === undefined) {
		out.width.fill(70)
		out.height.fill(18)
	}
	const camera = new PerspectiveCamera(45, WIDTH / HEIGHT, 1e-5, 1e9)
	const d = overviewDistance(frame.scale, 45, WIDTH / HEIGHT) * factor
	camera.position.set(0, d * Math.SQRT1_2, d * Math.SQRT1_2)
	camera.lookAt(0, 0, 0)
	camera.updateMatrixWorld()
	fillLabelLayout(out, frame, camera, WIDTH, HEIGHT, state, ranks, undefined, [
		extension,
	])
	return out
}

const beltSlots = belts.map((_, k) => firstSlot + k)
const overlaps = (layout: LabelLayout, a: number, b: number) =>
	layout.x[a] < layout.x[b] + layout.width[b] &&
	layout.x[a] + layout.width[a] > layout.x[b] &&
	layout.y[a] < layout.y[b] + layout.height[b] &&
	layout.y[a] + layout.height[a] > layout.y[b]

afterEach(() => useSimStore.setState({ showSmallBodies: false }))

describe("the belts' names in the layout (#74)", () => {
	it("keeps their rule: the middle circle 70 px .. 1.2 viewports on screen", () => {
		expect(beltNameShown(BELT_LABEL_MIN_PX - 1, HEIGHT)).toBe(false)
		expect(beltNameShown(BELT_LABEL_MIN_PX, HEIGHT)).toBe(true)
		expect(beltNameShown(BELT_LABEL_MAX_VIEWPORTS * HEIGHT, HEIGHT)).toBe(true)
		expect(beltNameShown(BELT_LABEL_MAX_VIEWPORTS * HEIGHT + 1, HEIGHT)).toBe(
			false,
		)
	})

	it("rank after the Sun's and the planets' names, before every other body's", () => {
		const planets = bodies
			.map((body, i) => ({ body, rank: ranks[i] }))
			.filter(({ body }) => body.kind === "star" || body.kind === "planet")
		const others = bodies
			.map((body, i) => ({ body, rank: ranks[i] }))
			.filter(({ body }) => body.kind !== "star" && body.kind !== "planet")
		for (let k = 0; k < belts.length; k++) {
			const rank = beltLabelRank(k, planets.length)
			expect(Math.max(...planets.map((p) => p.rank))).toBeLessThan(rank)
			expect(Math.min(...others.map((o) => o.rank))).toBeGreaterThan(rank)
		}
	})

	it("are written centred on the belt only while the Small bodies layer is on", () => {
		expect(beltSlots.every((slot) => lay(1).eligible[slot] === 0)).toBe(true)
		useSimStore.setState({ showSmallBodies: true })
		const wide = lay(1)
		const named = beltSlots.filter((slot) => wide.eligible[slot] === 1)
		expect(named.length).toBeGreaterThan(0)
		for (const slot of named) {
			expect(wide.centred[slot]).toBe(BELT_SPOTS.length)
		}
	})

	it("have their spots on the circle: left and right of the Sun, then its far and near side", () => {
		useSimStore.setState({ showSmallBodies: true })
		const layout = lay(1)
		const sun = bodies.findIndex((body) => body.id === "sun")
		const slot = beltSlots.find((s) => layout.eligible[s] === 1)!
		const spot = (s: number) => {
			if (s === 0) return { x: layout.cx[slot], y: layout.cy[slot] }
			const k = slot * (MAX_LABEL_SPOTS - 1) + s - 1
			return { x: layout.spotX[k], y: layout.spotY[k] }
		}
		const [left, right, far, near] = [0, 1, 2, 3].map(spot)
		const { cx, cy } = { cx: layout.cx[sun], cy: layout.cy[sun] }
		expect(left.x).toBeLessThan(cx - BELT_LABEL_MIN_PX)
		expect(right.x).toBeGreaterThan(cx + BELT_LABEL_MIN_PX)
		expect(Math.abs(left.y - cy)).toBeLessThan(1)
		expect(Math.abs(right.y - cy)).toBeLessThan(1)
		// seen from 45° above, the far side is up the screen and nearer the Sun than the near side
		expect(far.y).toBeLessThan(cy)
		expect(near.y).toBeGreaterThan(cy)
		expect(Math.abs(far.x - cx)).toBeLessThan(1)
		expect(cy - far.y).toBeLessThan(near.y - cy)
	})

	it("move along the circle when their spot is under a panel", () => {
		useSimStore.setState({ showSmallBodies: true })
		// zoomed out: the Kuiper belt's name on the viewer's left
		const free = lay(2)
		const slot = beltSlots.find((s) => free.placed.includes(s))!
		expect(free.spot[slot]).toBe(0)
		// a panel over that spot
		const layout = createLabelLayout(firstSlot + belts.length)
		layout.width.fill(70)
		layout.height.fill(18)
		const [x, y] = [free.cx[slot], free.cy[slot]]
		setKeepOut(layout, [{ x: x - 10, y: y - 10, width: 20, height: 20 }])
		lay(2, layout)
		expect(Number.isNaN(layout.cx[slot])).toBe(true)
		expect(layout.visible[slot]).toBe(1)
		expect(layout.spot[slot]).toBeGreaterThan(0)
	})

	it("never lie over a planet's name", () => {
		useSimStore.setState({ showSmallBodies: true })
		let named = 0
		for (const factor of [0.4, 0.7, 1, 1.5, 3]) {
			const layout = lay(factor)
			const placed = [...layout.placed.slice(0, layout.placedLength)]
			for (const belt of placed.filter((slot) => slot >= firstSlot)) {
				named++
				for (const other of placed) {
					if (other === belt) continue
					expect(overlaps(layout, belt, other)).toBe(false)
				}
			}
		}
		expect(named).toBeGreaterThan(2)
	})
})
