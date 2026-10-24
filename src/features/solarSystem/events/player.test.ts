/**
 * Playing a sky event (#41) through the tour player (#28), store level: one
 * action sets time, scale and view; the view from Earth stands the camera on
 * the Earth; leaving restores the view, time, speed and scale from before.
 */
import { afterEach, describe, expect, it } from "vitest"

import { skyEventById } from "@/data/skyEvents"
import { useScaleStore } from "@/store/scale"
import { useSimStore } from "@/store/sim"
import { useSpacecraftStore } from "@/store/spacecraft"
import { useTourStore } from "@/store/tour"

import { exitTour } from "../tours/player"
import { eventJD } from "./instant"
import { leaveEvent, showEventView, startEvent } from "./player"

const sim = () => useSimStore.getState()
/** The clock after its glide has landed. */
const landedJD = () => {
	const { clock } = sim()
	return clock.glide === null ? sim().simTimeJD : clock.anchorJD
}

afterEach(() => {
	exitTour()
	useSimStore.setState(useSimStore.getInitialState(), true)
	useScaleStore.setState(useScaleStore.getInitialState(), true)
	useTourStore.setState(useTourStore.getInitialState(), true)
	useSpacecraftStore.setState(useSpacecraftStore.getInitialState(), true)
})

describe("a sky event", () => {
	it("sets the whole scene in one action and goes back in one", () => {
		sim().setSimTime(2451545)
		sim().setTimeWarp(86400)
		sim().focus("mars")
		sim().select("mars")
		useScaleStore.getState().setPreset("textbook")

		startEvent("solar2024")
		const event = skyEventById.get("solar2024")!
		expect(useTourStore.getState().tour?.id).toBe("event-solar2024")
		expect(useScaleStore.getState().targetId).toBe("trueScale")
		expect(sim().paused).toBe(true)
		expect(landedJD()).toBe(eventJD(event))
		expect(sim().view).toEqual({ kind: "body", id: "earth" })
		// from Mars to the Earth: the flight (#18)
		expect(sim().transition?.profile).toBe("fly")

		showEventView("earth")
		expect(sim().view).toEqual({ kind: "body", id: "moon" })
		expect(sim().transition?.eye?.anchorId).toBe("earth")
		expect(sim().transition?.lensDeg).toBe(2)
		expect(sim().showOrbits).toBe(false)

		// another event keeps the way back to where it all began
		startEvent("lunar2025mar")
		leaveEvent()
		expect(useTourStore.getState().tour).toBeNull()
		expect(useScaleStore.getState().targetId).toBe("textbook")
		expect(sim().timeWarp).toBe(86400)
		expect(sim().paused).toBe(false)
		expect(landedJD()).toBeCloseTo(2451545, 6)
		expect(sim().view).toEqual({ kind: "body", id: "mars" })
		expect(sim().selectedId).toBe("mars")
		expect(sim().showOrbits).toBe(true)
		expect(sim().transition?.lensDeg).toBeNull()
	})

	it("shows a mission with its spacecraft selected", () => {
		startEvent("voyagerNeptune")
		expect(sim().view).toEqual({ kind: "body", id: "neptune" })
		expect(useSpacecraftStore.getState().selectedCraftId).toBe("voyager2")
	})

	it("an event about a spacecraft shows the hidden layer, and leaving puts it back (#70)", () => {
		expect(useSpacecraftStore.getState().showSpacecraft).toBe(false)
		startEvent("voyagerNeptune")
		expect(useSpacecraftStore.getState().showSpacecraft).toBe(true)
		expect(useTourStore.getState().baseline?.spacecraft).toBe(false)
		leaveEvent()
		expect(useSpacecraftStore.getState().showSpacecraft).toBe(false)
		expect(useSpacecraftStore.getState().selectedCraftId).toBeNull()

		// shown before the event, it stays shown after it
		useSpacecraftStore.getState().setShowSpacecraft(true)
		startEvent("voyagerNeptune")
		leaveEvent()
		expect(useSpacecraftStore.getState().showSpacecraft).toBe(true)
	})

	it("ignores unknown events", () => {
		startEvent("noSuchEvent")
		expect(useTourStore.getState().tour).toBeNull()
	})
})
