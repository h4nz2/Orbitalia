import { afterEach, describe, expect, it } from "vitest"

import { J2000_JD } from "@/sim"
import { useScaleStore } from "@/store/scale"
import { useSimStore } from "@/store/sim"
import { simSearchSchema } from "@/store/simSearch"
import { useSpacecraftStore } from "@/store/spacecraft"
import { useTourStore } from "@/store/tour"

import { nextStop, startTour, tourStatus } from "../tours/player"
import { restoreStart } from "./restoreStart"

const sim = () => useSimStore.getState()

afterEach(() => {
	useSimStore.setState(useSimStore.getInitialState(), true)
	useScaleStore.setState(useScaleStore.getInitialState(), true)
	useTourStore.setState(useTourStore.getInitialState(), true)
	useSpacecraftStore.setState(useSpacecraftStore.getInitialState(), true)
})

/** Wanders away from any start: another body, a held frame, speed, layers, scale. */
const wander = () => {
	sim().anchorFrame("jupiter")
	sim().select("io")
	sim().setTimeWarp(-86400)
	sim().setPaused(false)
	sim().setSimTime(J2000_JD + 5000)
	sim().setShowLabels(false)
	sim().setShowMoons(false)
	useScaleStore.getState().setPreset("textbook")
}

describe("restoreStart", () => {
	it("restores a prepared link exactly: view, frame, selection, time, pause, speed, layers, scale", () => {
		const link = simSearchSchema.parse({
			focus: "earth",
			frame: "earth",
			sel: "mars",
			cam: "0_89.9_120",
			t: "2460691.5",
			warp: "2629800",
			paused: true,
			orbits: false,
			scale: "trueScale",
		})
		wander()
		restoreStart(link, true)
		const state = sim()
		expect(state.frameId).toBe("earth")
		expect(state.view).toEqual({ kind: "body", id: "earth" })
		expect(state.selectedId).toBe("mars")
		expect(state.transition?.shot).toMatchObject({
			azimuthDeg: 0,
			elevationDeg: 89.9,
			distance: 120,
		})
		expect(state.transition?.durationMs).toBe(0)
		expect(state.simTimeJD).toBe(2460691.5)
		expect(state.paused).toBe(true)
		expect(state.timeWarp).toBe(2629800)
		expect(state.showOrbits).toBe(false)
		expect(state.showLabels).toBe(true)
		expect(state.showMoons).toBe(true)
		expect(useScaleStore.getState().targetId).toBe("trueScale")
		expect(useScaleStore.getState().transition).toBeNull()
	})

	it("without a link it is the app's own opening: the overview, now, 1x, Sun-centred", () => {
		wander()
		const before = Date.now()
		restoreStart({}, true)
		const state = sim()
		expect(state.view).toEqual({ kind: "overview" })
		expect(state.frameId).toBe("sun")
		expect(state.selectedId).toBeNull()
		expect(state.timeWarp).toBe(1)
		expect(state.paused).toBe(false)
		// "now" glides to the present (setNow)
		expect(state.clock.glide).not.toBeNull()
		expect(before).toBeGreaterThan(0)
		expect(useScaleStore.getState().targetId).toBe("everythingVisible")
	})

	it("leaves a held body for a plain body view, and animates unless told not to", () => {
		wander()
		restoreStart({ focus: "saturn" }, false)
		const state = sim()
		expect(state.frameId).toBe("sun")
		expect(state.view).toEqual({ kind: "body", id: "saturn" })
		expect(state.selectedId).toBe("saturn")
		expect(state.transition?.durationMs).toBeNull()
		// the scale switch animates back to the default
		expect(useScaleStore.getState().targetId).toBe("everythingVisible")
		expect(useScaleStore.getState().transition).not.toBeNull()
	})

	it("puts the spacecraft layer back as the link had it (#70)", () => {
		const craft = () => useSpacecraftStore.getState()
		// shown since, hidden in the link: hidden again, nothing selected
		craft().selectCraft("juno")
		restoreStart({ focus: "saturn" }, true)
		expect(craft().showSpacecraft).toBe(false)
		expect(craft().selectedCraftId).toBeNull()
		// the link shows them: shown again
		restoreStart(simSearchSchema.parse({ spacecraft: true }), true)
		expect(craft().showSpacecraft).toBe(true)
		// a lesson riding along with a craft shows them without the switch
		craft().setShowSpacecraft(false)
		restoreStart(
			simSearchSchema.parse({
				craft: "voyager1",
				follow: true,
				focus: "jupiter",
			}),
			true,
		)
		expect(sim().view).toMatchObject({ kind: "craft", id: "voyager1" })
		expect(craft().showSpacecraft).toBe(true)
		expect(craft().selectedCraftId).toBe("voyager1")
	})

	it("stops a running tour", () => {
		sim().playSequence([{ view: { kind: "body", id: "mars" } }])
		restoreStart({}, true)
		expect(sim().sequence).toBeNull()
	})

	it("ends a guided tour opened since, rather than leaving it half-open (#28)", () => {
		startTour("grandTour", { startAt: 2, jump: true })
		expect(tourStatus(sim().sequence, useTourStore.getState())).toBe("playing")
		restoreStart({ focus: "saturn" }, true)
		expect(useTourStore.getState().tour).toBeNull()
		expect(tourStatus(sim().sequence, useTourStore.getState())).toBeNull()
		expect(sim().view).toEqual({ kind: "body", id: "saturn" })
	})

	it("opens a lesson link's own tour on its stop again (#28)", () => {
		const link = simSearchSchema.parse({ tour: "earthMoves", stop: "2" })
		startTour("earthMoves", { startAt: 1, jump: true })
		nextStop()
		nextStop()
		expect(useTourStore.getState().index).toBe(3)
		restoreStart(link, true)
		const tour = useTourStore.getState()
		expect(tour.tour?.id).toBe("earthMoves")
		expect(tour.index).toBe(1)
		expect(tourStatus(sim().sequence, tour)).toBe("playing")
	})
})
