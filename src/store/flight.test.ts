import { afterEach, describe, expect, it } from "vitest"

import {
	FLIGHT_PROFILE,
	flightStep,
	travelledAt,
	useFlightStore,
	type Departure,
} from "./flight"
import { useSimStore } from "./sim"

const store = () => useSimStore.getState()
const flights = () => useFlightStore.getState()

afterEach(() => {
	useSimStore.setState(useSimStore.getInitialState(), true)
	useFlightStore.setState(useFlightStore.getInitialState(), true)
})

const arrive = () => {
	const { transition, settle } = store()
	if (transition !== null) settle(transition.id, 0)
}

const departure: Departure = {
	id: 7,
	toId: "jupiter",
	durationMs: 4000,
	travelStart: 0.1,
	travelEnd: 0.9,
}

describe("which moves are flights", () => {
	it("flies from one body to another, and from a point near one to another body", () => {
		store().jumpTo({ kind: "body", id: "earth" })
		arrive()
		store().setFocus("jupiter")
		expect(store().transition?.profile).toBe(FLIGHT_PROFILE)
		arrive()
		store().jumpTo({
			kind: "point",
			anchorId: "jupiter",
			offsetKm: [1e6, 0, 0],
		})
		arrive()
		store().setFocus("saturn")
		expect(store().transition?.profile).toBe(FLIGHT_PROFILE)
	})

	it("only descends from the overview, and only re-centres from a point to its own body", () => {
		store().setFocus("mars")
		expect(store().transition?.profile).toBeNull()
		arrive()
		store().jumpTo({ kind: "point", anchorId: "mars", offsetKm: [1e5, 0, 0] })
		arrive()
		store().setFocus("mars")
		expect(store().transition?.profile).toBeNull()
	})

	it("is what a scripted flight step asks for", () => {
		expect(flightStep("neptune", { holdMs: 3000 })).toEqual({
			view: { kind: "body", id: "neptune" },
			profile: FLIGHT_PROFILE,
			holdMs: 3000,
		})
		store().playSequence([flightStep("earth"), flightStep("neptune")])
		expect(store().transition).toMatchObject({
			view: { kind: "body", id: "earth" },
			profile: FLIGHT_PROFILE,
		})
	})
})

describe("finishMove (a tour's jump)", () => {
	it("lands the running move at once", () => {
		store().setFocus("mars")
		const flying = store().transition!
		store().finishMove()
		expect(store().transition).toMatchObject({
			view: flying.view,
			durationMs: 0,
		})
		expect(store().transition!.id).not.toBe(flying.id)
		arrive()
		store().finishMove()
		expect(store().transition).toBeNull()
	})

	it("stays in a running tour: the stop then waits or holds as usual", () => {
		store().playSequence([flightStep("earth"), flightStep("mars")])
		store().finishMove()
		expect(store().sequence).toMatchObject({ index: 0, phase: "moving" })
		arrive()
		expect(store().sequence).toMatchObject({ index: 0, phase: "waiting" })
		store().nextStep()
		expect(store().view).toEqual({ kind: "body", id: "mars" })
	})
})

describe("the flight record", () => {
	it("departs, arrives, and is kept by a skip onto the same destination", () => {
		flights().depart(departure)
		expect(flights().flight).toMatchObject({ toId: "jupiter", arrived: false })
		flights().transitionStarted(8, { kind: "body", id: "jupiter" })
		expect(flights().flight).toMatchObject({ id: 7, arrived: true })
	})

	it("arrives only for its own transition", () => {
		flights().depart(departure)
		flights().arrive(3)
		expect(flights().flight?.arrived).toBe(false)
		flights().arrive(7)
		expect(flights().flight?.arrived).toBe(true)
	})

	it("goes with any move elsewhere", () => {
		flights().depart(departure)
		flights().transitionStarted(8, { kind: "overview" })
		expect(flights().flight).toBeNull()
		flights().depart(departure)
		flights().transitionStarted(9, { kind: "body", id: "saturn" })
		expect(flights().flight).toBeNull()
	})

	it("crosses the gap with the camera's easing", () => {
		expect(travelledAt(0, 0.1, 0.9)).toBe(0)
		expect(travelledAt(0.1, 0.1, 0.9)).toBe(0)
		expect(travelledAt(0.5, 0.1, 0.9)).toBeCloseTo(0.5, 12)
		expect(travelledAt(0.9, 0.1, 0.9)).toBe(1)
		// slow start, fast middle
		expect(travelledAt(0.2, 0.1, 0.9)).toBeLessThan(0.05)
	})
})
