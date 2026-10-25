import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { PerspectiveCamera } from "three"

import { bodies } from "@/data"
import { SCALE_PRESETS } from "@/sim"
import { isoToJD } from "@/sim/spacecraft"
import { useSpacecraftStore } from "@/store/spacecraft"

import { overviewDistance } from "../camera/framing"
import {
	SMALL_SCREEN_CRAFT_NAMES,
	createLabelLayout,
	staticLabelRanks,
	type LabelLayout,
} from "../labels/layout"
import { fillLabelLayout, labelSlotCount } from "../labels/project"
import { createSimFrame, updateSimFrame } from "../scene/simFrame"
import { createCraftFrame, updateCraftFrame } from "./craftFrame"
import {
	CRAFT_PICK_HYSTERESIS,
	createCraftLabels,
	nearestFirst,
} from "./craftLabels"
import { loadTrajectories } from "./trajectories"

const JD = isoToJD("2026-09-25T00:00Z")

beforeAll(async () => {
	await loadTrajectories()
})

afterEach(() =>
	useSpacecraftStore.setState({
		showSpacecraft: false,
		selectedCraftId: null,
		hoverCraftId: null,
	}),
)

describe("nearestFirst", () => {
	it("puts the nearest first and names at most the limit", () => {
		const waiting = Int32Array.from([0, 1, 2, 3])
		const distance = Float64Array.from([5, 1, 9, 3])
		const named = new Uint8Array(4)
		expect(nearestFirst(waiting, 4, distance, 2, named)).toBe(2)
		expect([...waiting]).toEqual([1, 3, 0, 2])
		expect([...named]).toEqual([0, 1, 0, 1])
		expect(nearestFirst(waiting, 4, distance, Infinity, named.fill(0))).toBe(4)
		expect(nearestFirst(waiting, 1, distance, 2, named)).toBe(1)
	})

	it("keeps last frame's names unless another craft is nearer by more than the hysteresis", () => {
		const waiting = Int32Array.from([0, 1, 2])
		const named = new Uint8Array(3)
		// craft 0 and 1 are named; craft 2 comes a little nearer than craft 1
		nearestFirst(waiting, 3, Float64Array.from([1, 10, 20]), 2, named)
		expect([...named]).toEqual([1, 1, 0])
		const nearer = 10 * (1 - CRAFT_PICK_HYSTERESIS / 2)
		nearestFirst(waiting, 3, Float64Array.from([1, 10, nearer]), 2, named)
		expect([...named]).toEqual([1, 1, 0])
		// clearly nearer: it takes the name over
		const clearly = 10 * (1 - 2 * CRAFT_PICK_HYSTERESIS)
		nearestFirst(waiting, 3, Float64Array.from([1, 10, clearly]), 2, named)
		expect([...named]).toEqual([1, 0, 1])
		// and keeps it when craft 1 comes back to about the same distance
		nearestFirst(waiting, 3, Float64Array.from([1, clearly, clearly]), 2, named)
		expect([...named]).toEqual([1, 0, 1])
	})
})

describe("spacecraft names by screen size (#74)", () => {
	const frame = createSimFrame(bodies, JD, SCALE_PRESETS.everythingVisible)
	updateSimFrame(frame, JD, 0)
	const firstSlot = labelSlotCount(bodies.length)
	const ranks = staticLabelRanks(bodies)

	/** The names a `width` x `height` screen gives the craft, from `factor` x the overview's distance. */
	function craftNamed(width: number, height: number, factor: number) {
		const craftFrame = createCraftFrame(frame)
		updateCraftFrame(craftFrame, frame)
		const layout: LabelLayout = createLabelLayout(
			firstSlot + craftFrame.craft.length,
		)
		layout.width.fill(60)
		layout.height.fill(16)
		const camera = new PerspectiveCamera(45, width / height, 1e-5, 1e9)
		const d = overviewDistance(frame.scale, 45, width / height) * factor
		camera.position.set(0, d * Math.SQRT1_2, d * Math.SQRT1_2)
		camera.lookAt(0, 0, 0)
		camera.updateMatrixWorld()
		fillLabelLayout(
			layout,
			frame,
			camera,
			width,
			height,
			{
				focusId: "sun",
				selectedId: null,
				hoverId: null,
				showMoons: true,
				showAllMoons: false,
				showMarkers: true,
				showOrbits: true,
				showOrbitLabels: false,
			},
			ranks,
			undefined,
			[createCraftLabels(frame, craftFrame, firstSlot)],
		)
		return craftFrame.craft
			.filter((_, k) => layout.eligible[firstSlot + k] === 1)
			.map((craft) => craft.id)
	}

	it("a laptop names every craft on screen; a phone the two nearest the focus", () => {
		useSpacecraftStore.setState({ showSpacecraft: true })
		// wide enough for the far probes
		const laptop = craftNamed(1366, 768, 5)
		const phone = craftNamed(360, 640, 5)
		expect(laptop.length).toBeGreaterThan(SMALL_SCREEN_CRAFT_NAMES)
		expect(phone.length).toBe(SMALL_SCREEN_CRAFT_NAMES)
		expect(laptop).toEqual(expect.arrayContaining(phone))
	})

	it("a phone names the selected craft on top of the two", () => {
		useSpacecraftStore.setState({ showSpacecraft: true })
		const nearest = craftNamed(360, 640, 5)
		const far = craftNamed(1366, 768, 5).find((id) => !nearest.includes(id))!
		useSpacecraftStore.setState({ selectedCraftId: far })
		const phone = craftNamed(360, 640, 5)
		expect(phone).toContain(far)
		expect(phone.length).toBe(SMALL_SCREEN_CRAFT_NAMES + 1)
	})
})
