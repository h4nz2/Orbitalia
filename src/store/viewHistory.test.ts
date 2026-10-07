/**
 * The view history's bookkeeping (#46): which waypoint each entry returns to,
 * when a step becomes a new entry, and what back and forward land on. The
 * recorder runs here on fake deps: a hand-driven "task end" and a log of the
 * addresses it writes.
 */
import { afterEach, describe, expect, it } from "vitest"

import type { Tour } from "@/data/tours"

import { HOME_SHOT, OVERVIEW, type Sequence } from "./navigation"
import {
	canGoBack,
	createRecorder,
	entryBehind,
	historyBack,
	sameWaypoint,
	setHistoryBack,
	useViewHistoryStore,
	waypointOf,
	withoutSteps,
	type HistoryNote,
	type Waypoint,
} from "./viewHistory"

afterEach(() => {
	useViewHistoryStore.setState(useViewHistoryStore.getInitialState(), true)
	setHistoryBack(null)
})

const view = (id: string, extra: Partial<Waypoint> = {}): Waypoint =>
	({
		kind: "view",
		view: id === "overview" ? OVERVIEW : { kind: "body", id },
		shot: null,
		frameId: "sun",
		selectedId: id === "overview" ? null : id,
		craftId: null,
		tour: null,
		...extra,
	}) as Waypoint

const scene = (
	sim: Partial<Parameters<typeof waypointOf>[0]> = {},
	tour: Partial<Parameters<typeof waypointOf>[1]> = {},
	craftId: string | null = null,
) =>
	waypointOf(
		{
			view: OVERVIEW,
			shot: null,
			frameId: "sun",
			selectedId: null,
			sequence: null,
			...sim,
		},
		{ tour: null, index: 0, steps: null, ...tour },
		craftId,
	)

describe("waypoints", () => {
	it("keep the view, its camera, the frame, the selection and the spacecraft", () => {
		const shot = { azimuthDeg: 30, elevationDeg: 10, distance: 2.5 }
		expect(
			scene(
				{ view: { kind: "body", id: "moon" }, shot, selectedId: "moon" },
				{},
				"voyager1",
			),
		).toEqual({
			kind: "view",
			view: { kind: "body", id: "moon" },
			shot,
			frameId: "sun",
			selectedId: "moon",
			craftId: "voyager1",
			tour: null,
		})
	})

	it("are a tour stop while the camera is on a menu tour, a view while looking around", () => {
		const steps = [{ view: OVERVIEW }]
		const tour = { id: "grandTour", order: 0, stops: [] } as unknown as Tour
		const on: Sequence = {
			steps,
			index: 0,
			phase: "waiting",
			holdUntil: null,
			transitionId: 1,
		}
		expect(scene({ sequence: on }, { tour, index: 3, steps })).toEqual({
			kind: "tourStop",
			tour: { id: "grandTour", index: 3 },
		})
		const away = scene(
			{ sequence: { ...on, phase: "interrupted" } },
			{ tour, index: 3, steps },
		)
		expect(away).toMatchObject({
			kind: "view",
			tour: { id: "grandTour", index: 3 },
		})
		// a tour of another feature (the quick look) is never one
		const other = { ...tour, id: "quickLook" }
		expect(scene({ sequence: on }, { tour: other, index: 3, steps })).toEqual(
			view("overview"),
		)
	})

	it("compare every field", () => {
		expect(sameWaypoint(view("mars"), view("mars"))).toBe(true)
		expect(sameWaypoint(view("mars"), view("moon"))).toBe(false)
		expect(sameWaypoint(view("mars"), view("mars", { shot: HOME_SHOT }))).toBe(
			false,
		)
		expect(sameWaypoint(view("mars"), view("mars", { craftId: "juno" }))).toBe(
			false,
		)
		expect(sameWaypoint(view("mars"), view("mars", { frameId: "mars" }))).toBe(
			false,
		)
		const stop: Waypoint = {
			kind: "tourStop",
			tour: { id: "grandTour", index: 1 },
		}
		expect(sameWaypoint(stop, { ...stop })).toBe(true)
		expect(
			sameWaypoint(stop, {
				kind: "tourStop",
				tour: { id: "grandTour", index: 2 },
			}),
		).toBe(false)
		expect(sameWaypoint(stop, view("mars"))).toBe(false)
	})
})

/** A recorder on fake deps, with the scene and the history driven by hand. */
function harness(start: Waypoint = view("earth")) {
	let now = start
	let tasks: (() => void)[] = []
	const writes: boolean[] = []
	const arrivals: (Waypoint | null)[] = []
	let index = 0
	let keys = 0
	const recorder = createRecorder({
		now: () => now,
		write: (push) => {
			writes.push(push)
			// the browser history answers at once, as TanStack's does
			if (push) recorder.note(note("PUSH", index + 1))
			else recorder.note(note("REPLACE", index))
		},
		arrive: (recorded) => arrivals.push(recorded),
		defer: (fn) => tasks.push(fn),
	})
	const note = (
		action: HistoryNote["action"],
		at: number,
		solarSystem = true,
	): HistoryNote => {
		index = at
		keys += 1
		return { action, index: at, key: `k${keys}`, solarSystem }
	}
	recorder.open(0, "k0")
	return {
		recorder,
		writes,
		arrivals,
		note,
		set scene(next: Waypoint) {
			now = next
		},
		/** The end of the current task: open steps are written. */
		endTask: () => {
			const run = tasks
			tasks = []
			run.forEach((fn) => fn())
		},
		/** A step: marked, the scene changes (writes wait), the task ends. */
		step(next: Waypoint) {
			recorder.step()
			now = next
			expect(recorder.holds()).toBe(true)
			this.endTask()
		},
	}
}

const history = () => useViewHistoryStore.getState()

describe("steps", () => {
	it("become new entries with the view they left behind", () => {
		const h = harness(view("earth"))
		expect(canGoBack(history())).toBe(false)
		h.step(view("moon"))
		expect(h.writes).toEqual([true])
		expect(history().index).toBe(1)
		expect(entryBehind(history())).toEqual(view("earth"))
		expect(canGoBack(history())).toBe(true)
	})

	it("are written once, however many changes and marks the task holds", () => {
		const h = harness(view("earth"))
		h.recorder.step()
		h.scene = view("earth", { selectedId: "moon" })
		h.recorder.step()
		h.scene = view("moon")
		expect(h.recorder.holds()).toBe(true)
		h.endTask()
		expect(h.writes).toEqual([true])
		expect(entryBehind(history())).toEqual(view("earth"))
		expect(h.recorder.holds()).toBe(false)
	})

	it("that change nothing add no entry", () => {
		const h = harness(view("overview", { shot: HOME_SHOT }))
		h.step(view("overview", { shot: HOME_SHOT }))
		expect(h.writes).toEqual([false])
		expect(history().index).toBe(0)
		expect(canGoBack(history())).toBe(false)
	})

	it("keep the camera the view was left with", () => {
		const shot = { azimuthDeg: 10, elevationDeg: 20, distance: 4 }
		const h = harness(view("earth"))
		h.step(view("moon"))
		// zooming out is no step: the entry on screen is rewritten
		h.scene = view("moon", { shot })
		h.step(view("mars"))
		expect(entryBehind(history())).toEqual(view("moon", { shot }))
	})

	it("still open when the page goes are dropped", () => {
		const h = harness(view("earth"))
		h.recorder.step()
		h.scene = view("moon")
		h.recorder.dispose()
		h.endTask()
		expect(h.writes).toEqual([])
	})

	it("are not made while going back or forward", () => {
		const h = harness(view("earth"))
		withoutSteps(() => h.recorder.step())
		expect(h.recorder.holds()).toBe(false)
		h.endTask()
		expect(h.writes).toEqual([])
	})
})

describe("back and forward", () => {
	it("land on the entry's waypoint, and the entry left keeps the scene as it was left", () => {
		const shot = { azimuthDeg: 10, elevationDeg: 20, distance: 4 }
		const h = harness(view("earth"))
		h.step(view("moon"))
		h.scene = view("moon", { shot })
		h.step(view("mars"))
		expect(history().index).toBe(2)

		// Back: the Moon, at the distance it was left at
		h.recorder.note(h.note("BACK", 1))
		expect(h.arrivals).toEqual([view("moon", { shot })])
		expect(history().index).toBe(1)
		h.scene = view("moon", { shot })
		// Back again: Earth, and then nothing is left
		h.recorder.note(h.note("BACK", 0))
		expect(h.arrivals.at(-1)).toEqual(view("earth"))
		expect(canGoBack(history())).toBe(false)
		h.scene = view("earth")
		// Forward re-applies the steps
		h.recorder.note(h.note("FORWARD", 1))
		expect(h.arrivals.at(-1)).toEqual(view("moon", { shot }))
		h.recorder.note(h.note("FORWARD", 2))
		expect(h.arrivals.at(-1)).toEqual(view("mars"))
	})

	it("on an entry without a record leave the scene to the address", () => {
		const h = harness(view("earth"))
		h.recorder.note(h.note("BACK", 0))
		expect(h.arrivals).toEqual([null])
	})

	it("to another page go nowhere in the scene", () => {
		const h = harness(view("earth"))
		h.step(view("moon"))
		h.recorder.note(h.note("BACK", 0, false))
		expect(h.arrivals).toEqual([])
	})

	it("a new step after going back drops what lay ahead", () => {
		const h = harness(view("earth"))
		h.step(view("moon"))
		h.step(view("mars"))
		h.recorder.note(h.note("BACK", 1))
		h.scene = view("moon")
		h.step(view("jupiter"))
		expect(history().index).toBe(2)
		expect(Object.keys(history().entries)).toEqual(["0", "1"])
		expect(entryBehind(history())).toEqual(view("moon"))
	})

	it("another page opened from here takes over the entries ahead", () => {
		const h = harness(view("earth"))
		h.step(view("moon"))
		h.step(view("mars"))
		h.recorder.note(h.note("BACK", 1))
		// the help page
		h.recorder.note(h.note("PUSH", 2, false))
		expect(Object.keys(history().entries)).toEqual(["0", "1"])
	})
})

describe("opening the page", () => {
	it("on an entry it knows keeps the way back", () => {
		const h = harness(view("earth"))
		h.step(view("moon"))
		const { index, keys } = history()
		// to the comparison and back again: the same entry, the same key
		h.recorder.note(h.note("PUSH", 2, false))
		const again = harness(view("moon"))
		again.recorder.open(index, keys[index])
		expect(canGoBack(history())).toBe(true)
		expect(entryBehind(history())).toEqual(view("earth"))
	})

	it("on an entry another page wrote over forgets it and what lay ahead", () => {
		const h = harness(view("earth"))
		h.step(view("moon"))
		h.step(view("mars"))
		h.recorder.open(1, "written-over")
		expect(Object.keys(history().entries)).toEqual(["0"])
		expect(history().index).toBe(1)
	})
})

describe("historyBack", () => {
	it("goes back only to a view of the solar system", () => {
		const backs: number[] = []
		setHistoryBack(() => backs.push(1))
		const h = harness(view("earth"))
		expect(historyBack()).toBe(false)
		h.step(view("moon"))
		expect(historyBack()).toBe(true)
		expect(backs).toEqual([1])
		setHistoryBack(null)
		expect(historyBack()).toBe(false)
	})
})
