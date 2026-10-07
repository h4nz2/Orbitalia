/**
 * What going back does on the scene (#46), on the real stores: a view is
 * flown to with the camera it was left with (the flight of #18 between two
 * bodies), its selection, spacecraft and held body come back, and a tour stop
 * is the tour's own move. The browser's back is faked: the view history's
 * entries are set by hand.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { Tour } from "@/data/tours"
import { FLIGHT_PROFILE, useFlightStore } from "@/store/flight"
import { HOME_SHOT, OVERVIEW, type CameraShot } from "@/store/navigation"
import { useScaleStore } from "@/store/scale"
import { useSimStore } from "@/store/sim"
import { useSpacecraftStore } from "@/store/spacecraft"
import { useTourStore } from "@/store/tour"
import { useTrailStore } from "@/store/trails"
import {
	createRecorder,
	setHistoryBack,
	useViewHistoryStore,
	waypointOf,
	withoutSteps,
	type Waypoint,
} from "@/store/viewHistory"

import { showBody } from "../present/commands"
import { restoreStart } from "../present/restoreStart"
import { exitTour, nextStop, startTour } from "../tours/player"
import { wayOut } from "../ui/OverviewButton"
import { canStepBack, goBack, returnRequest, returnTo, tourBack } from "./back"

const sim = () => useSimStore.getState()
const tours = () => useTourStore.getState()

/** A menu tour's id with stops of our own: the view history treats it as listed. */
const tour: Tour = {
	id: "grandTour",
	order: 0,
	stops: [
		{ id: "system", view: "overview" },
		{ id: "earth", view: "earth" },
		{ id: "mars", view: "mars" },
	],
}

const shot: CameraShot = { azimuthDeg: 40, elevationDeg: 15, distance: 3 }

const view = (extra: Partial<Waypoint>): Waypoint =>
	({
		kind: "view",
		view: OVERVIEW,
		shot: null,
		frameId: "sun",
		selectedId: null,
		craftId: null,
		tour: null,
		...extra,
	}) as Waypoint

/** The camera rig arriving at the running transition. */
const arrive = () => {
	const { transition, settle } = sim()
	if (transition !== null) settle(transition.id, 0)
}

let backs = 0

beforeEach(() => {
	backs = 0
	setHistoryBack(() => {
		backs += 1
	})
})

afterEach(() => {
	exitTour()
	setHistoryBack(null)
	useSimStore.setState(useSimStore.getInitialState(), true)
	useScaleStore.setState(useScaleStore.getInitialState(), true)
	useTourStore.setState(useTourStore.getInitialState(), true)
	useTrailStore.setState(useTrailStore.getInitialState(), true)
	useFlightStore.setState(useFlightStore.getInitialState(), true)
	useSpacecraftStore.setState(useSpacecraftStore.getInitialState(), true)
	useViewHistoryStore.setState(useViewHistoryStore.getInitialState(), true)
})

describe("going back to a view", () => {
	it("flies from body to body, landing with the camera it was left with", () => {
		sim().setFocus("mars")
		arrive()
		returnTo(
			view({ view: { kind: "body", id: "moon" }, shot, selectedId: "moon" }),
		)
		expect(sim().view).toEqual({ kind: "body", id: "moon" })
		expect(sim().transition).toMatchObject({ profile: FLIGHT_PROFILE, shot })
		expect(sim().selectedId).toBe("moon")
	})

	it("glides back to the overview from its home camera when none was kept", () => {
		sim().setFocus("mars")
		arrive()
		returnTo(view({ view: OVERVIEW, selectedId: "mars" }))
		expect(sim().view).toEqual(OVERVIEW)
		expect(sim().transition).toMatchObject({ profile: null, shot: HOME_SHOT })
		// the card that was open comes back with it
		expect(sim().selectedId).toBe("mars")
	})

	it("holds the body still again, or lets go of it", () => {
		returnTo(view({ view: { kind: "body", id: "earth" }, frameId: "earth" }))
		expect(sim().frameId).toBe("earth")
		expect(sim().view).toEqual({ kind: "body", id: "earth" })
		const point = {
			kind: "point" as const,
			anchorId: "earth",
			offsetKm: [2e5, 0, 0] as const,
		}
		returnTo(view({ view: point, frameId: "earth" }))
		expect(sim().frameId).toBe("earth")
		expect(sim().view).toEqual(point)
		returnTo(view({ view: { kind: "body", id: "jupiter" } }))
		expect(sim().frameId).toBe("sun")
		expect(sim().view).toEqual({ kind: "body", id: "jupiter" })
	})

	it("chooses the spacecraft again", () => {
		returnTo(view({ craftId: "voyager1" }))
		expect(useSpacecraftStore.getState().selectedCraftId).toBe("voyager1")
		returnTo(view({ view: { kind: "body", id: "mars" }, selectedId: "mars" }))
		expect(useSpacecraftStore.getState().selectedCraftId).toBeNull()
		expect(sim().selectedId).toBe("mars")
	})

	it("from inside a tour to before it began leaves the tour", () => {
		startTour(tour)
		returnTo(view({ view: { kind: "body", id: "venus" }, selectedId: "venus" }))
		expect(tours().tour).toBeNull()
		expect(sim().view).toEqual({ kind: "body", id: "venus" })
	})

	it("jumps for a viewer who prefers less motion", () => {
		const request = returnRequest(
			{ kind: "body", id: "mars" },
			{ kind: "body", id: "moon" },
			shot,
			true,
		)
		expect(request).toEqual({ shot, profile: FLIGHT_PROFILE, durationMs: 0 })
		expect(
			returnRequest(OVERVIEW, { kind: "body", id: "moon" }, null, false),
		).toEqual({ shot: undefined, profile: undefined, durationMs: undefined })
	})
})

describe("going back to a tour stop", () => {
	it("is the tour's previous stop while it is open", () => {
		startTour(tour)
		nextStop()
		nextStop()
		expect(tours().index).toBe(2)
		returnTo({ kind: "tourStop", tour: { id: "grandTour", index: 1 } })
		expect(tours().index).toBe(1)
		expect(sim().view).toEqual({ kind: "body", id: "earth" })
	})

	it("begins the tour on that stop again once it was closed (Forward, too)", () => {
		returnTo({ kind: "tourStop", tour: { id: "grandTour", index: 2 } })
		expect(tours().tour?.id).toBe("grandTour")
		expect(tours().index).toBe(2)
	})
})

describe("Back", () => {
	it("is the browser's back to the view before, and nothing on the first view", () => {
		expect(canStepBack(useViewHistoryStore.getState(), null, tours())).toBe(
			false,
		)
		expect(goBack()).toBe(false)
		expect(backs).toBe(0)
		useViewHistoryStore.setState({ index: 1, entries: { 0: view({}) } })
		expect(canStepBack(useViewHistoryStore.getState(), null, tours())).toBe(
			true,
		)
		expect(goBack()).toBe(true)
		expect(backs).toBe(1)
	})

	it("during a tour goes to the stop before", () => {
		startTour(tour)
		nextStop()
		nextStop()
		const enabled = () =>
			canStepBack(useViewHistoryStore.getState(), sim().sequence, tours())
		expect(enabled()).toBe(true)
		// the stop before is the entry behind: through the browser's history
		useViewHistoryStore.setState({
			index: 2,
			entries: { 1: { kind: "tourStop", tour: { id: "grandTour", index: 1 } } },
		})
		expect(goBack()).toBe(true)
		expect(backs).toBe(1)
		expect(tours().index).toBe(2)
		// the tour began elsewhere (a link on its last stop): the tour's own step back
		useViewHistoryStore.setState({ index: 0, entries: {} })
		tourBack()
		expect(backs).toBe(1)
		expect(tours().index).toBe(1)
	})

	it("on a tour's first stop goes back to before the tour", () => {
		startTour(tour)
		expect(
			canStepBack(useViewHistoryStore.getState(), sim().sequence, tours()),
		).toBe(false)
		useViewHistoryStore.setState({ index: 1, entries: { 0: view({}) } })
		expect(goBack()).toBe(true)
		expect(backs).toBe(1)
	})
})

/**
 * The view history wired to the real stores as the URL sync wires it, with
 * the end of the task driven by hand: how many entries `act` adds.
 */
function entriesAdded(act: () => void): number {
	const writes: boolean[] = []
	const tasks: (() => void)[] = []
	const recorder = createRecorder({
		now: () =>
			waypointOf(
				useSimStore.getState(),
				useTourStore.getState(),
				useSpacecraftStore.getState().selectedCraftId,
			),
		write: (push) => writes.push(push),
		arrive: () => undefined,
		defer: (fn) => tasks.push(fn),
	})
	const unsubscribe = useSimStore.subscribe((state, previous) => {
		if (state.step !== previous.step) recorder.step()
	})
	act()
	tasks.splice(0).forEach((fn) => fn())
	unsubscribe()
	return writes.filter(Boolean).length
}

describe("what is a step", () => {
	it("choosing a body, the way out and holding a body still", () => {
		expect(entriesAdded(() => sim().setFocus("moon"))).toBe(1)
		arrive()
		// choosing it again changes nothing: no entry
		expect(entriesAdded(() => sim().setFocus("moon"))).toBe(0)
		expect(entriesAdded(() => showBody("mars", true))).toBe(1)
		expect(entriesAdded(() => sim().anchorFrame("mars"))).toBe(1)
		expect(entriesAdded(() => wayOut())).toBe(1)
		expect(entriesAdded(() => restoreStart({ focus: "saturn" }, true))).toBe(1)
	})

	it("not dragging, zooming, time or layers", () => {
		sim().setFocus("moon")
		arrive()
		expect(
			entriesAdded(() =>
				sim().publishShot({ azimuthDeg: 5, elevationDeg: 5, distance: 3 }),
			),
		).toBe(0)
		expect(
			entriesAdded(() =>
				sim().settleAt({
					kind: "point",
					anchorId: "moon",
					offsetKm: [5e4, 0, 0],
				}),
			),
		).toBe(0)
		expect(entriesAdded(() => sim().setTimeWarp(3600))).toBe(0)
		expect(entriesAdded(() => sim().setShowOrbits(false))).toBe(0)
	})

	it("a stop of a menu tour, but not a link opening on one or another feature's tour", () => {
		expect(entriesAdded(() => startTour(tour))).toBe(1)
		expect(entriesAdded(() => nextStop())).toBe(1)
		exitTour()
		expect(
			entriesAdded(() => startTour(tour, { startAt: 2, jump: true })),
		).toBe(0)
		exitTour()
		const quickLook = { ...tour, id: "quickLook" }
		expect(entriesAdded(() => startTour(quickLook))).toBe(0)
		expect(entriesAdded(() => nextStop())).toBe(0)
		expect(entriesAdded(() => withoutSteps(() => sim().setFocus("io")))).toBe(0)
	})
})
