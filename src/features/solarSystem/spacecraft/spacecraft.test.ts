/**
 * The spacecraft scene helpers (issue #35): craft frames against the real data,
 * path splitting, where "Show" sends the camera, and craft names in the body
 * labels' layout (never overlapping a body's name, ranked after the bodies).
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { PerspectiveCamera } from "three"

import { bodies } from "@/data"
import { spacecraftById } from "@/data/spacecraft"
import { SCALE_PRESETS, SCALE_PRESET_IDS, degToRad } from "@/sim"
import { isoToJD } from "@/sim/spacecraft"
import { useSimStore } from "@/store/sim"
import { useSpacecraftStore } from "@/store/spacecraft"

import { overviewDistance } from "../camera/framing"
import { createLabelLayout, staticLabelRanks } from "../labels/layout"
import { fillLabelLayout, labelSlotCount } from "../labels/project"
import { createSimFrame, updateSimFrame } from "../scene/simFrame"
import { createCraftFrame, updateCraftFrame } from "./craftFrame"
import { craftLabelRank, createCraftLabels } from "./craftLabels"
import { countUpTo, writeSplitPath, type PathSplit } from "./CraftPaths"
import {
	craftFacts,
	craftView,
	followCraft,
	showCraft,
	showEvent,
	watchEvent,
} from "./facts"
import { loadTrajectories } from "./trajectories"

const JD_2026 = isoToJD("2026-09-25T00:00Z")
const WIDTH = 1280
const HEIGHT = 800

beforeAll(async () => {
	await loadTrajectories()
})

describe("countUpTo / writeSplitPath", () => {
	const times = [1, 2, 3, 4]
	const display = [0, 0, 0, 1000, 0, 0, 2000, 0, 0, 3000, 0, 0]
	const out = new Float32Array(15)
	const split: PathSplit = { count: 0, flownCount: 0, futureStart: 0 }

	it("counts the times at or before a date", () => {
		expect(countUpTo(times, 0)).toBe(0)
		expect(countUpTo(times, 2)).toBe(2)
		expect(countUpTo(times, 2.5)).toBe(2)
		expect(countUpTo(times, 9)).toBe(4)
	})

	it("puts the craft between the flown and the future part, shared by both", () => {
		writeSplitPath(times, display, 4, 2.5, [1500, 0, 0], [0, 0, 0], out, split)
		expect(split).toEqual({ count: 5, flownCount: 3, futureStart: 2 })
		// scene units (1000 km), in time order with the craft inserted
		expect([...out.slice(0, 15)].filter((_, k) => k % 3 === 0)).toEqual([
			0, 1, 1.5, 2, 3,
		])
	})

	it("is all future before the path starts and all flown after it ends", () => {
		writeSplitPath(times, display, 4, 0, null, [0, 0, 0], out, split)
		expect(split.flownCount).toBe(0)
		expect(split.futureStart).toBe(0)
		writeSplitPath(times, display, 4, 9, null, [0, 0, 0], out, split)
		expect(split.flownCount).toBe(4)
		expect(split.count - split.futureStart).toBe(1)
	})

	it("subtracts the render origin before rounding to float32", () => {
		writeSplitPath(times, display, 4, 0, null, [1000, 0, 0], out, split)
		expect(out[0]).toBe(-1)
		expect(out[3]).toBe(0)
	})
})

describe("craft frame", () => {
	it("places every craft in space at the frame's time; Cassini is gone in 2026", () => {
		const frame = createSimFrame(
			bodies,
			JD_2026,
			SCALE_PRESETS.everythingVisible,
		)
		const craftFrame = createCraftFrame(frame)
		updateCraftFrame(craftFrame, frame)
		const present = Object.fromEntries(
			craftFrame.craft.map((craft, k) => [craft.id, craftFrame.present[k]]),
		)
		expect(present).toMatchObject({
			voyager1: 1,
			voyager2: 1,
			pioneer10: 1,
			newHorizons: 1,
			parker: 1,
			jwst: 1,
			juno: 1,
			europaClipper: 1,
			cassini: 0,
		})
		const juno = craftFrame.craft.findIndex((c) => c.id === "juno")
		expect(bodies[craftFrame.states[juno].anchorIndex].id).toBe("jupiter")
	})
})

describe("facts", () => {
	it("measures the true distance and signal time", () => {
		const facts = craftFacts(spacecraftById.get("jwst")!, JD_2026)!
		expect(facts.anchorId).toBe("earth")
		expect(facts.earthDistanceKm).toBeGreaterThan(1.2e6)
		expect(facts.signalSeconds).toBeGreaterThan(4)
		expect(facts.signalSeconds).toBeLessThan(6.5)
		expect(facts.phase).toBe("active")
	})

	it.each(SCALE_PRESET_IDS)(
		"sends the camera near the craft with its anchor in view (%s)",
		(presetId) => {
			const scale = SCALE_PRESETS[presetId]
			const juno = craftView(spacecraftById.get("juno")!, JD_2026, scale)!
			expect(juno.anchorId).toBe("jupiter")
			expect(juno.distance).toBeGreaterThanOrEqual(1)
			const voyager = craftView(
				spacecraftById.get("voyager1")!,
				JD_2026,
				scale,
			)!
			expect(voyager.anchorId).toBe("sun")
			// beyond the planets: the frame must be wider than the overview
			expect(voyager.distance).toBeGreaterThan(1)
			const parker = craftView(spacecraftById.get("parker")!, JD_2026, scale)!
			expect(parker.anchorId).toBe("sun")
			expect(parker.distance).toBeLessThan(1)
		},
	)
})

describe("choosing a craft shows the hidden layer (#70)", () => {
	const scale = SCALE_PRESETS.everythingVisible
	const voyager = spacecraftById.get("voyager1")!
	const jupiter = voyager.events.find((event) => event.target === "jupiter")!
	const shown = () => useSpacecraftStore.getState().showSpacecraft
	const hide = () => {
		useSimStore.setState(useSimStore.getInitialState(), true)
		useSimStore.getState().setSimTime(JD_2026)
		useSpacecraftStore.setState(useSpacecraftStore.getInitialState(), true)
		expect(shown()).toBe(false)
	}
	afterEach(() => {
		useSimStore.setState(useSimStore.getInitialState(), true)
		useSpacecraftStore.setState(useSpacecraftStore.getInitialState(), true)
	})

	it("Show (the list, the card, a ?craft= link)", () => {
		hide()
		showCraft("voyager1", scale)
		expect(shown()).toBe(true)
		expect(useSpacecraftStore.getState().selectedCraftId).toBe("voyager1")
	})

	it("Follow", () => {
		hide()
		followCraft("voyager1", scale)
		expect(shown()).toBe(true)
		expect(useSimStore.getState().view).toMatchObject({ kind: "craft" })
	})

	it("a milestone, and Watch", () => {
		hide()
		showEvent(voyager, jupiter, scale)
		expect(shown()).toBe(true)
		hide()
		expect(watchEvent(voyager, jupiter, scale)).toBe(true)
		expect(shown()).toBe(true)
	})
})

describe("craft names in the label layout", () => {
	it("rank after every body, unless pointed at or selected", () => {
		const n = bodies.length
		const ranks = staticLabelRanks(bodies)
		const plain = craftLabelRank(0, n, false, false)
		expect(plain).toBeGreaterThan(Math.max(...ranks))
		expect(plain).toBeLessThan(n) // before the orbit names
		expect(craftLabelRank(0, n, false, true)).toBeLessThan(-2 * n) // above a selected body
		expect(craftLabelRank(0, n, true, false)).toBeLessThan(-3 * n) // above a hovered body
	})

	it("never overlap a body's name, from anywhere around the Sun", () => {
		useSpacecraftStore.setState({
			showSpacecraft: true,
			selectedCraftId: null,
			hoverCraftId: null,
		})
		const scale = SCALE_PRESETS.everythingVisible
		const frame = createSimFrame(bodies, JD_2026, scale)
		updateSimFrame(frame, JD_2026, 0)
		const craftFrame = createCraftFrame(frame)
		const firstSlot = labelSlotCount(bodies.length)
		const extension = createCraftLabels(frame, craftFrame, firstSlot)
		const ranks = staticLabelRanks(bodies)
		let craftShown = 0
		for (const distanceFactor of [0.6, 1, 2.5, 5]) {
			for (const elevation of [15, 45, 80]) {
				const layout = createLabelLayout(firstSlot + craftFrame.craft.length)
				layout.width.fill(90)
				layout.height.fill(18)
				const camera = new PerspectiveCamera(45, WIDTH / HEIGHT, 1e-5, 1e9)
				const d = overviewDistance(scale, 45, WIDTH / HEIGHT) * distanceFactor
				camera.position.set(
					0,
					d * Math.sin(degToRad(elevation)),
					d * Math.cos(degToRad(elevation)),
				)
				camera.lookAt(0, 0, 0)
				camera.updateMatrixWorld()
				fillLabelLayout(
					layout,
					frame,
					camera,
					WIDTH,
					HEIGHT,
					{
						focusId: "sun",
						selectedId: null,
						hoverId: null,
						showMoons: true,
						showMarkers: true,
						showOrbits: true,
						showOrbitLabels: false,
						showAllMoons: false,
					},
					ranks,
					undefined,
					extension,
				)
				const placed = [...layout.placed.slice(0, layout.placedLength)]
				craftShown += placed.filter((slot) => slot >= firstSlot).length
				for (const a of placed) {
					for (const b of placed) {
						if (a >= b) continue
						const overlap =
							layout.x[a] < layout.x[b] + layout.width[b] &&
							layout.x[a] + layout.width[a] > layout.x[b] &&
							layout.y[a] < layout.y[b] + layout.height[b] &&
							layout.y[a] + layout.height[a] > layout.y[b]
						expect(overlap, `${a} / ${b}`).toBe(false)
					}
				}
			}
		}
		// the far probes are named once the view is wide enough
		expect(craftShown).toBeGreaterThan(10)
	})
})
