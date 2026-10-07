import { afterEach, describe, expect, it } from "vitest"

import { J2000_JD, dateToJD } from "@/sim"

import { WARP_PRESETS, allMoonsShown, isBodyShown, useSimStore } from "./sim"

const reset = () => useSimStore.setState(useSimStore.getInitialState(), true)

afterEach(reset)

describe("sim store", () => {
	it("starts at the wall clock, 1x, playing, in the Sun-centred overview", () => {
		const { simTimeJD, timeWarp, paused, focusId, hoverId, view, transition } =
			useSimStore.getInitialState()
		expect(Math.abs(simTimeJD - dateToJD(new Date()))).toBeLessThan(1 / 24)
		expect(timeWarp).toBe(1)
		expect(paused).toBe(false)
		expect(view).toEqual({ kind: "overview" })
		expect(focusId).toBe("sun")
		expect(hoverId).toBeNull()
		expect(transition).toBeNull()
		expect(useSimStore.getState().showOrbits).toBe(true)
		expect(useSimStore.getState().showLabels).toBe(true)
		expect(useSimStore.getState().showMoons).toBe(true)
		expect(useSimStore.getState().showMarkers).toBe(true)
	})

	// focus, selection and transitions: navigation.test.ts

	it("sets the warp and ignores non-finite values", () => {
		const { setTimeWarp } = useSimStore.getState()
		setTimeWarp(3600)
		expect(useSimStore.getState().timeWarp).toBe(3600)
		setTimeWarp(Number.NaN)
		setTimeWarp(Number.POSITIVE_INFINITY)
		expect(useSimStore.getState().timeWarp).toBe(3600)
		for (const value of WARP_PRESETS) {
			setTimeWarp(value)
			expect(useSimStore.getState().timeWarp).toBe(value)
		}
	})

	it("setSimTime ignores non-finite values", () => {
		const { setSimTime } = useSimStore.getState()
		setSimTime(J2000_JD)
		setSimTime(Number.NaN)
		expect(useSimStore.getState().simTimeJD).toBe(J2000_JD)
	})

	it("tracks hover and the scene toggles", () => {
		const state = useSimStore.getState()
		state.setHover("europa")
		expect(useSimStore.getState().hoverId).toBe("europa")
		state.setHover(null)
		expect(useSimStore.getState().hoverId).toBeNull()
		state.setShowOrbits(false)
		state.setShowLabels(false)
		state.setShowMoons(false)
		state.setShowMarkers(false)
		expect(useSimStore.getState().showOrbits).toBe(false)
		expect(useSimStore.getState().showLabels).toBe(false)
		expect(useSimStore.getState().showMoons).toBe(false)
		expect(useSimStore.getState().showMarkers).toBe(false)
	})

	it("shows the featured moons by default and the long tail only on request (#17)", () => {
		const titan = { id: "titan", kind: "moon", featured: true } as const
		const ymir = { id: "ymir", kind: "moon" } as const
		const saturn = { id: "saturn", kind: "planet" } as const
		const story = { showMoons: true, showAllMoons: false, focusId: "saturn" }
		const all = { ...story, showAllMoons: true }
		expect(isBodyShown(titan, story)).toBe(true)
		expect(isBodyShown(ymir, story)).toBe(false)
		expect(isBodyShown(saturn, story)).toBe(true)
		expect(isBodyShown(ymir, all)).toBe(true)
		// the long tail needs the moons switch as well
		expect(isBodyShown(ymir, { ...all, showMoons: false })).toBe(false)
		// a focused long-tail moon is always drawn
		expect(isBodyShown(ymir, { ...story, focusId: "ymir" })).toBe(true)
		expect(useSimStore.getState().showAllMoons).toBe(false)
	})

	it("hides the long tail while the scale does, All moons or not (#54, Poster)", () => {
		const titan = { id: "titan", kind: "moon", featured: true } as const
		const ymir = { id: "ymir", kind: "moon" } as const
		const poster = {
			showMoons: true,
			showAllMoons: true,
			focusId: "saturn",
			longTailHidden: true,
		}
		expect(isBodyShown(ymir, poster)).toBe(false)
		expect(isBodyShown(titan, poster)).toBe(true)
		// the focus is always drawn
		expect(isBodyShown(ymir, { ...poster, focusId: "ymir" })).toBe(true)
		expect(allMoonsShown(poster)).toBe(false)
		expect(allMoonsShown({ ...poster, longTailHidden: false })).toBe(true)
		// the choice is kept for when the scale lets the long tail back
		useSimStore.getState().setShowAllMoons(true)
		useSimStore.getState().setLongTailHidden(true)
		expect(useSimStore.getState().showAllMoons).toBe(true)
		expect(allMoonsShown(useSimStore.getState())).toBe(false)
		useSimStore.getState().setLongTailHidden(false)
		expect(allMoonsShown(useSimStore.getState())).toBe(true)
	})

	it("keeps the focus visible while the moons are hidden", () => {
		const io = { id: "io", kind: "moon", featured: true } as const
		const europa = { id: "europa", kind: "moon", featured: true } as const
		const jupiter = { id: "jupiter", kind: "planet" } as const
		const shown = { showMoons: true, showAllMoons: false, focusId: "sun" }
		const hidden = { showMoons: false, showAllMoons: true, focusId: "io" }
		expect(isBodyShown(io, shown)).toBe(true)
		expect(isBodyShown(europa, shown)).toBe(true)
		expect(isBodyShown(io, hidden)).toBe(true)
		expect(isBodyShown(europa, hidden)).toBe(false)
		expect(isBodyShown(jupiter, hidden)).toBe(true)
		// through the store: focusing Io and hiding the moons leaves Io rendered
		useSimStore.getState().setFocus("io")
		useSimStore.getState().setShowMoons(false)
		expect(isBodyShown(io, useSimStore.getState())).toBe(true)
		expect(isBodyShown(europa, useSimStore.getState())).toBe(false)
	})

	it("offers the warp presets from the architecture", () => {
		expect(WARP_PRESETS).toEqual([
			1, 60, 3600, 86400, 604800, 2629800, 31557600, 315576000,
		])
	})
})
