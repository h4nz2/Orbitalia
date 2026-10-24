/**
 * The URL sync's bookkeeping of a live clock (#69), end to end: the sync as
 * the page runs it (`connectSimUrl`, the body of `useSimUrlSync`) on a memory
 * history, with the real stores, a fake `performance.now()` and a pinned wall
 * clock, so every write the address gets is under the test's eye.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	createMemoryHistory,
	defaultParseSearch,
	defaultStringifySearch,
	type HistoryState,
	type RouterHistory,
} from "@tanstack/react-router"

import { J2000_JD, dateToJD } from "@/sim"

import { useBirthdayStore } from "./birthday"
import { usePresentationStore } from "./presentation"
import { useScaleStore } from "./scale"
import { useSimStore } from "./sim"
import { simSearchSchema, type SimSearch } from "./simSearch"
import { useSpacecraftStore } from "./spacecraft"
import { useTourStore } from "./tour"
import {
	TIME_SYNC_INTERVAL_MS,
	TIME_SYNC_MAX_WARP,
	connectSimUrl,
	roundJD,
	type UrlSyncRouter,
} from "./urlSync"

const WALL = new Date("2026-03-20T09:30:00Z")

let realMs = 0
let history: RouterHistory
let writes = 0
let disconnect: () => void = () => {}

const sim = () => useSimStore.getState()
/** The address's search params as the router would read them. */
const address = (): SimSearch =>
	simSearchSchema.parse(defaultParseSearch(history.location.search))

/** Opens the page on `search`: the sync starts, as the page's layout effect starts it. */
function open(search = "?lang=en") {
	history = createMemoryHistory({ initialEntries: [`/solar_system${search}`] })
	// what `useNavigate()` does for the sync: the address, in place or as a new entry
	const navigate = (options: {
		search: SimSearch
		replace?: boolean
		state?: (previous: HistoryState) => HistoryState
	}) => {
		writes += 1
		const path = `/solar_system${defaultStringifySearch(options.search)}`
		const state = options.state?.(history.location.state) ?? {}
		if (options.replace === true) history.replace(path, state)
		else history.push(path, state)
		return Promise.resolve()
	}
	const searchRef = { current: address() }
	disconnect = connectSimUrl(
		{ history, navigate: navigate as unknown as UrlSyncRouter["navigate"] },
		searchRef,
	)
}

/** `ms` of real time in frames of `frameMs`, ticking like SimClock; the wall clock and timers move along. */
function run(ms: number, frameMs = 100) {
	for (let left = ms; left > 0; left -= frameMs) {
		const step = Math.min(frameMs, left)
		realMs += step
		vi.advanceTimersByTime(step)
		sim().tick(realMs, Date.now())
	}
}

/** Lets the task end: a step closes in a microtask (viewHistory.ts). */
const taskEnd = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
	vi.useFakeTimers({
		toFake: ["Date", "setTimeout", "clearTimeout"],
		now: WALL,
	})
	realMs = 10_000
	vi.spyOn(performance, "now").mockImplementation(() => realMs)
	writes = 0
})

afterEach(() => {
	disconnect()
	disconnect = () => {}
	vi.useRealTimers()
	vi.restoreAllMocks()
	useSimStore.setState(useSimStore.getInitialState(), true)
	useSpacecraftStore.setState(useSpacecraftStore.getInitialState(), true)
	usePresentationStore.setState(usePresentationStore.getInitialState(), true)
	useScaleStore.setState(useScaleStore.getInitialState(), true)
	useTourStore.setState(useTourStore.getInitialState(), true)
	useBirthdayStore.setState(useBirthdayStore.getInitialState(), true)
})

describe("the URL sync and a live clock (#69)", () => {
	it("writes nothing while the clock shows now, however long it runs", () => {
		open()
		const entries = history.length
		const before = writes
		run(5000)
		expect(address().t).toBeUndefined()
		expect(writes).toBe(before)
		expect(history.length).toBe(entries)
	})

	it("crossing out of now writes `t` at once, in place; crossing back takes it out", () => {
		open()
		const entries = history.length
		// a pause: the moment, without waiting for the throttle
		sim().setPaused(true)
		expect(address().t).toBe(roundJD(dateToJD(WALL)))
		sim().setPaused(false)
		expect(address().t).toBeUndefined()
		// a jump at 1x leaves now: written at once, not a second later
		sim().setSimTime(J2000_JD)
		expect(address().t).toBe(roundJD(J2000_JD))
		// back on the wall clock (where the time bar's Now lands): out again
		sim().setSimTime(dateToJD(new Date()))
		expect(address().t).toBeUndefined()
		expect(history.length).toBe(entries)
	})

	it("a clock that is not live is written at most once per interval", () => {
		open()
		sim().setTimeWarp(TIME_SYNC_MAX_WARP)
		const left = address().t
		expect(left).toBe(roundJD(dateToJD(WALL)))
		const before = writes
		// the first frame starts the interval; the frames in it wait for its one write
		run(TIME_SYNC_INTERVAL_MS)
		expect(writes).toBe(before)
		expect(address().t).toBe(left)
		run(100)
		expect(writes).toBe(before + 1)
		// the moment of the last frame before the write: a minute of simulated time on
		expect(address().t).toBeGreaterThan(left!)
		expect(address().t).toBeCloseTo(sim().simTimeJD, 3)
		run(3 * TIME_SYNC_INTERVAL_MS)
		expect(writes).toBe(before + 4)
	})

	it("a step holds the crossing for its end, which writes it once, as a new entry", async () => {
		open()
		const entries = history.length
		const before = writes
		// choosing a body and a date in one step (a milestone, a tour stop)
		sim().markStep()
		sim().select("mars")
		sim().setSimTime(J2000_JD)
		expect(writes).toBe(before)
		expect(address().t).toBeUndefined()
		await taskEnd()
		expect(writes).toBe(before + 1)
		expect(history.length).toBe(entries + 1)
		expect(address()).toMatchObject({ sel: "mars", t: roundJD(J2000_JD) })
		// the sync knows the clock is no longer live: the next frames are throttled
		run(TIME_SYNC_INTERVAL_MS - 100)
		expect(writes).toBe(before + 1)
	})

	it("a laptop that slept through the night opens on now, with no `t` written", () => {
		open()
		run(1000)
		// performance.now() stood still; the wall clock moved on nine hours
		vi.setSystemTime(WALL.getTime() + 9 * 3600_000)
		const before = writes
		run(100)
		expect(sim().simTimeJD).toBeCloseTo(dateToJD(new Date()), 6)
		expect(address().t).toBeUndefined()
		expect(writes).toBe(before)
	})
})
