import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createI18n } from "@/i18n"
import { bodyName } from "@/i18n/bodies"
import { flightStep } from "@/store/flight"
import { usePresentationStore } from "@/store/presentation"
import { useSimStore } from "@/store/sim"

import { runCommand } from "./commands"
import { watchFlights } from "./flightAnnouncer"

const sim = () => useSimStore.getState()
const land = () => {
	const { transition, settle } = sim()
	if (transition !== null) settle(transition.id, 0)
}

let said: string[] = []
let stop = () => {}

beforeEach(() => {
	said = []
	sim().jumpTo({ kind: "body", id: "earth" })
	land()
	stop = watchFlights((id) => said.push(id))
})

afterEach(() => {
	stop()
	useSimStore.setState(useSimStore.getInitialState(), true)
	usePresentationStore.setState(usePresentationStore.getInitialState(), true)
})

describe("what a flight says", () => {
	it("says the destination once, as the flight is asked for", () => {
		sim().setFocus("jupiter")
		expect(said).toEqual(["jupiter"])
		// handed over to a drag, landed at once, arrived: the same trip
		sim().userInput()
		sim().finishMove()
		land()
		expect(said).toEqual(["jupiter"])
	})

	it("says the new destination when retargeted, and a scripted flight's too", () => {
		sim().setFocus("neptune")
		sim().setFocus("mars")
		sim().playSequence([flightStep("moon")])
		expect(said).toEqual(["neptune", "mars", "moon"])
	})

	it("is quiet for every other move", () => {
		sim().overview()
		land()
		sim().setFocus("mars") // from the overview it only descends
		land()
		sim().jumpTo({ kind: "body", id: "venus" })
		sim().reset()
		expect(said).toEqual([])
	})

	it("leaves a presenter's key to speak for itself", () => {
		const i18n = createI18n({ locale: "en" })
		const text = runCommand(
			{ kind: "view", index: 5 },
			{ t: i18n.t, bodyName: (id) => bodyName(id, i18n.chain) },
		)
		expect(text).toBe("Now showing Jupiter")
		expect(sim().transition?.view).toEqual({ kind: "body", id: "jupiter" })
		expect(said).toEqual([])
	})

	it("stops when unsubscribed", () => {
		stop()
		sim().setFocus("jupiter")
		expect(said).toEqual([])
	})
})
