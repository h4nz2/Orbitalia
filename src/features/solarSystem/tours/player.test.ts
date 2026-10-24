/**
 * The tour player (#28) on the real stores: a tour drives the navigation
 * model's sequence, the clock, the scale, the layers and the frame, survives
 * the visitor looking around or pressing Escape, and restores its stop on
 * the way back.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { Tour } from "@/data/tours"
import { dateToJD } from "@/sim"
import { useFlightStore } from "@/store/flight"
import { useScaleStore } from "@/store/scale"
import { WARP_PRESETS, useSimStore } from "@/store/sim"
import { useSpacecraftStore } from "@/store/spacecraft"
import { useTourStore } from "@/store/tour"
import { useTrailStore } from "@/store/trails"

import {
	exitTour,
	followSequence,
	goToStop,
	nextStop,
	previousStop,
	resumeTour,
	setTourAuto,
	startTour,
	tourStatus,
} from "./player"

const tour: Tour = {
	id: "test",
	order: 0,
	stops: [
		{ id: "start", view: "overview", scale: "everythingVisible", speed: "day" },
		{ id: "earth", view: "earth", time: { date: "2025-01-16" } },
		{
			id: "held",
			view: "earth",
			frame: "earth",
			trails: "restart",
			fit: { au: 2.5 },
			select: "mars",
			speed: "paused",
		},
		{
			id: "truth",
			view: "overview",
			scale: "trueScale",
			layers: { markers: false },
		},
		{ id: "jupiter", view: "jupiter" },
	],
}

const sim = () => useSimStore.getState()
const tours = () => useTourStore.getState()
const status = () => tourStatus(sim().sequence, tours())

/** The camera rig arriving at the running transition. */
const arrive = () => {
	const { transition, settle } = sim()
	if (transition !== null) settle(transition.id, 0)
}

/** The clock after its glide has landed. */
const landedJD = () => {
	const { clock } = sim()
	return clock.glide === null ? sim().simTimeJD : clock.anchorJD
}

beforeEach(() => {
	useScaleStore.getState().setPreset("everythingVisible")
})

afterEach(() => {
	exitTour()
	useSimStore.setState(useSimStore.getInitialState(), true)
	useScaleStore.setState(useScaleStore.getInitialState(), true)
	useTourStore.setState(useTourStore.getInitialState(), true)
	useTrailStore.setState(useTrailStore.getInitialState(), true)
	useFlightStore.setState(useFlightStore.getInitialState(), true)
	useSpacecraftStore.setState(useSpacecraftStore.getInitialState(), true)
})

describe("starting a tour", () => {
	it("plays its first stop as a camera sequence and sets the scene", () => {
		startTour(tour)
		expect(tours().tour).toBe(tour)
		expect(tours().index).toBe(0)
		expect(sim().sequence?.steps).toBe(tours().steps)
		expect(sim().sequence?.index).toBe(0)
		expect(sim().timeWarp).toBe(WARP_PRESETS[3])
		expect(sim().paused).toBe(false)
		expect(status()).toBe("playing")
		arrive()
		// stops wait for the presenter
		expect(sim().sequence?.phase).toBe("waiting")
	})

	it("ignores unknown tours", () => {
		startTour("noSuchTour")
		expect(tours().tour).toBeNull()
		expect(sim().sequence).toBeNull()
	})

	it("opens a link on its stop without animation", () => {
		startTour(tour, { startAt: 3, jump: true })
		expect(tours().index).toBe(3)
		expect(useScaleStore.getState().presetId).toBe("trueScale")
		expect(useScaleStore.getState().transition).toBeNull()
		expect(sim().showMarkers).toBe(false)
		// the latest date of the tour, jumped to
		expect(sim().clock.glide).toBeNull()
		expect(sim().simTimeJD).toBeCloseTo(
			dateToJD(new Date("2025-01-16T12:00:00Z")),
			6,
		)
		expect(sim().transition?.durationMs).toBe(0)
	})
})

describe("stepping through", () => {
	it("goes forward stop by stop, travelling to the dates stops set", () => {
		startTour(tour)
		arrive()
		nextStop()
		expect(tours().index).toBe(1)
		expect(sim().view).toEqual({ kind: "body", id: "earth" })
		expect(sim().selectedId).toBe("earth")
		expect(landedJD()).toBeCloseTo(
			dateToJD(new Date("2025-01-16T12:00:00Z")),
			6,
		)
		arrive()
		nextStop()
		// the body held still, the selection, trails growing from the stop
		expect(sim().frameId).toBe("earth")
		expect(sim().selectedId).toBe("mars")
		expect(sim().paused).toBe(true)
		expect(sim().transition?.fit?.around).toBe("sun")
		expect(useTrailStore.getState().sinceJD).not.toBeNull()
		arrive()
		nextStop()
		// the frame belongs to its stop: the next one is Sun-centred again
		expect(sim().frameId).toBe("sun")
		expect(useScaleStore.getState().targetId).toBe("trueScale")
		expect(useScaleStore.getState().transition).not.toBeNull()
		expect(sim().showMarkers).toBe(false)
		expect(useTrailStore.getState().sinceJD).toBeNull()
	})

	it("flies from body to body, and descends from the overview", () => {
		startTour({ ...tour, stops: [tour.stops[1], tour.stops[4]] })
		arrive()
		nextStop()
		expect(sim().transition?.profile).toBe("fly")
		startTour(tour, { startAt: 3 })
		arrive()
		nextStop()
		expect(sim().transition?.profile).toBeNull()
	})

	it("going back restores the earlier stop's scale and layers", () => {
		startTour(tour, { startAt: 3 })
		arrive()
		previousStop()
		expect(tours().index).toBe(2)
		expect(useScaleStore.getState().targetId).toBe("everythingVisible")
		expect(sim().showMarkers).toBe(true)
		expect(sim().frameId).toBe("earth")
	})

	it("jumps to any stop, which looks as it did in order", () => {
		startTour(tour)
		goToStop(3)
		expect(tours().index).toBe(3)
		expect(sim().showMarkers).toBe(false)
		expect(landedJD()).toBeCloseTo(
			dateToJD(new Date("2025-01-16T12:00:00Z")),
			6,
		)
		goToStop(0)
		expect(sim().showMarkers).toBe(true)
		expect(useScaleStore.getState().targetId).toBe("everythingVisible")
		goToStop(99)
		expect(tours().index).toBe(4)
	})

	it("ends after the last stop", () => {
		startTour(tour, { startAt: 4 })
		arrive()
		nextStop()
		expect(tours().tour).toBeNull()
		expect(sim().sequence).toBeNull()
		expect(status()).toBeNull()
	})

	it("stays on the first stop when going back from it", () => {
		startTour(tour)
		previousStop()
		expect(tours().index).toBe(0)
	})
})

describe("leaving and coming back", () => {
	it("looking at another body is exploring, and resuming restores the stop", () => {
		startTour(tour)
		arrive()
		nextStop()
		arrive()
		sim().setFocus("saturn")
		expect(status()).toBe("exploring")
		useScaleStore.getState().setPreset("trueScale")
		sim().setShowMarkers(false)
		resumeTour()
		expect(status()).toBe("playing")
		expect(tours().index).toBe(1)
		expect(sim().view).toEqual({ kind: "body", id: "earth" })
		expect(useScaleStore.getState().targetId).toBe("everythingVisible")
		expect(sim().showMarkers).toBe(true)
	})

	it("dragging the camera at a waiting stop is part of the lesson", () => {
		startTour(tour)
		arrive()
		sim().userInput()
		expect(status()).toBe("playing")
	})

	it("Escape ends the camera sequence but not the tour", () => {
		startTour(tour, { startAt: 2 })
		arrive()
		sim().reset()
		expect(sim().frameId).toBe("sun")
		expect(status()).toBe("left")
		expect(tours().tour).toBe(tour)
		resumeTour()
		expect(status()).toBe("playing")
		expect(sim().frameId).toBe("earth")
		expect(sim().selectedId).toBe("mars")
	})

	it("the next stop is reachable from a tour that was left", () => {
		startTour(tour)
		sim().reset()
		nextStop()
		expect(status()).toBe("playing")
		expect(tours().index).toBe(1)
	})

	it("closing the tour stops its sequence and leaves the scene", () => {
		startTour(tour, { startAt: 3 })
		exitTour()
		expect(tours().tour).toBeNull()
		expect(sim().sequence).toBeNull()
		expect(useScaleStore.getState().targetId).toBe("trueScale")
	})
})

describe("a sequence moved by someone else", () => {
	it("gives the stop the camera is heading to its scene", () => {
		const unfollow = followSequence()
		try {
			startTour(tour, { startAt: 2 })
			arrive()
			sim().nextStep()
			expect(tours().index).toBe(3)
			expect(useScaleStore.getState().targetId).toBe("trueScale")
			expect(sim().frameId).toBe("sun")
			expect(sim().sequence?.steps).toBe(tours().steps)
		} finally {
			unfollow()
		}
	})
})

describe("the spacecraft layer (#70)", () => {
	const ride = (returnOnExit?: boolean): Tour => ({
		id: "ride",
		order: 0,
		returnOnExit,
		stops: [
			{ id: "start", view: "overview" },
			{ id: "voyager", view: "jupiter", follow: "voyager1" },
			{ id: "saturn", view: "saturn" },
		],
	})
	const craft = () => useSpacecraftStore.getState()

	it("is in the baseline, and a stop riding along with a craft shows it", () => {
		startTour(ride())
		expect(tours().baseline?.spacecraft).toBe(false)
		expect(craft().showSpacecraft).toBe(false)
		nextStop()
		expect(craft().showSpacecraft).toBe(true)
		expect(craft().selectedCraftId).toBe("voyager1")
		// it stays on for the rest of the tour, and after it, like the other layers
		nextStop()
		expect(craft().showSpacecraft).toBe(true)
		exitTour()
		expect(craft().showSpacecraft).toBe(true)
	})

	it("a tour that returns on exit puts it back as it was", () => {
		startTour(ride(true), { startAt: 1 })
		expect(craft().showSpacecraft).toBe(true)
		exitTour()
		expect(craft().showSpacecraft).toBe(false)
		expect(craft().selectedCraftId).toBeNull()
	})
})

it("autoplay is a switch on the tour", () => {
	startTour(tour, { auto: true })
	expect(tours().auto).toBe(true)
	setTourAuto(false)
	expect(tours().auto).toBe(false)
})
