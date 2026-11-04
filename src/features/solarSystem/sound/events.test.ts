import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { useFlightStore, type Departure } from "@/store/flight"
import { useHuntStore } from "@/store/hunt"
import { useLightStore } from "@/store/light"
import { useSimStore } from "@/store/sim"

import { pulseArrivals } from "../light/lightTravel"
import {
	MAX_ARRIVALS_PER_FRAME,
	watchSoundEvents,
	type SoundCues,
} from "./events"

type Call = [keyof SoundCues, ...unknown[]]

let calls: Call[] = []
let stop: () => void = () => undefined

const recorder: SoundCues = {
	flightStart: (flight) => calls.push(["flightStart", flight.toId]),
	flightEnd: () => calls.push(["flightEnd"]),
	arrived: (id) => calls.push(["arrived", id]),
	paused: (paused) => calls.push(["paused", paused]),
	timeTravel: (forward) => calls.push(["timeTravel", forward]),
	found: () => calls.push(["found"]),
	finished: () => calls.push(["finished"]),
	lightReached: (id) => calls.push(["lightReached", id]),
}

const sim = () => useSimStore.getState()
const names = () => calls.map((call) => call[0])

beforeEach(() => {
	calls = []
	stop = watchSoundEvents(recorder)
})

afterEach(() => {
	stop()
	useSimStore.setState(useSimStore.getInitialState(), true)
	useFlightStore.setState(useFlightStore.getInitialState(), true)
	useHuntStore.setState(useHuntStore.getInitialState(), true)
	useLightStore.setState(useLightStore.getInitialState(), true)
})

const departure: Departure = {
	id: 7,
	toId: "jupiter",
	durationMs: 3500,
	travelStart: 0.2,
	travelEnd: 0.8,
}

describe("flights (#18)", () => {
	it("whooshes on departure and stops on arrival", () => {
		useFlightStore.getState().depart(departure)
		expect(calls).toEqual([["flightStart", "jupiter"]])
		useFlightStore.getState().arrive(7)
		expect(names()).toEqual(["flightStart", "flightEnd"])
	})

	it("stops the whoosh on a skip, and starts a new one on a retarget", () => {
		const flights = useFlightStore.getState()
		flights.depart(departure)
		flights.transitionStarted(8, { kind: "body", id: "jupiter" }) // landed at once
		expect(names()).toEqual(["flightStart", "flightEnd"])
		calls = []
		flights.depart({ ...departure, id: 9, toId: "saturn" })
		flights.depart({ ...departure, id: 10, toId: "mars" }) // mid-flight retarget
		expect(calls).toEqual([
			["flightStart", "saturn"],
			["flightEnd"],
			["flightStart", "mars"],
		])
		flights.transitionStarted(11, { kind: "overview" }) // Escape
		expect(calls.at(-1)).toEqual(["flightEnd"])
	})
})

describe("arrivals", () => {
	it("rings the body the camera settles on, never the overview", () => {
		sim().setFocus("mars")
		expect(calls).toEqual([])
		sim().settle(sim().transition!.id, 0)
		expect(calls).toEqual([["arrived", "mars"]])
		sim().overview()
		sim().settle(sim().transition!.id, 0)
		expect(calls).toEqual([["arrived", "mars"]])
	})

	it("stays silent for a move that is replaced before it lands", () => {
		sim().setFocus("mars")
		sim().setFocus("venus")
		expect(calls).toEqual([])
	})
})

describe("time (#14)", () => {
	it("ticks on pause and play", () => {
		sim().setPaused(true)
		sim().setPaused(false)
		expect(calls).toEqual([
			["paused", true],
			["paused", false],
		])
	})

	it("sweeps up into the future and down into the past", () => {
		const now = sim().simTimeJD
		sim().travelTo(now + 3650)
		sim().travelTo(now - 36500)
		expect(calls).toContainEqual(["timeTravel", true])
		sim().setSimTime(now)
		sim().travelTo(now - 3650)
		expect(calls.at(-1)).toEqual(["timeTravel", false])
	})
})

describe("the scavenger hunt (#34)", () => {
	it("rings each find and the finish, never a miss", () => {
		const hunt = useHuntStore.getState()
		hunt.start("walkedOn.redPlanet")
		hunt.setGuess({ bodyId: "venus", kind: "other" })
		expect(calls).toEqual([])
		hunt.solve("moon")
		expect(names()).toEqual(["found"])
		hunt.next()
		hunt.solve("mars")
		hunt.next()
		expect(names()).toEqual(["found", "found", "finished"])
	})

	it("stays silent when a hunt is resumed or another one starts", () => {
		const hunt = useHuntStore.getState()
		hunt.start("walkedOn")
		hunt.start("redPlanet")
		expect(calls).toEqual([])
	})
})

describe("light arrivals (#27)", () => {
	it("rings each body the flash reaches, in order", () => {
		sim().setPaused(true)
		calls = []
		useLightStore.getState().send("sun")
		const arrivals = pulseArrivals(useLightStore.getState().pulse!)
		calls = []
		for (const arrival of arrivals.slice(0, 3)) {
			sim().setSimTime(arrival.jd + 1e-9)
		}
		expect(calls).toEqual(
			arrivals.slice(0, 3).map((arrival) => ["lightReached", arrival.id]),
		)
	})

	it("rings at most a few at once, and time running back is silent", () => {
		useLightStore.getState().send("sun")
		const arrivals = pulseArrivals(useLightStore.getState().pulse!)
		calls = []
		sim().setSimTime(arrivals.at(-1)!.jd + 1)
		expect(calls).toHaveLength(MAX_ARRIVALS_PER_FRAME)
		calls = []
		sim().setSimTime(arrivals[0].jd - 1e-3)
		expect(calls).toEqual([])
		sim().setSimTime(arrivals[0].jd + 1e-9)
		expect(calls).toEqual([["lightReached", arrivals[0].id]])
	})
})
