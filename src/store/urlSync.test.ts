import { describe, expect, it } from "vitest"

import { J2000_JD, dateToJD } from "@/sim"

import { HOME_SHOT, OVERVIEW } from "./navigation"
import { simSearchSchema } from "./simSearch"
import {
	LAYER_PARAMS,
	TIME_SYNC_MAX_WARP,
	layersFromSearch,
	mountState,
	roundJD,
	sameSearch,
	searchFromState,
	shouldMirrorTime,
	stateFromSearch,
	viewFromSearch,
	waypointFromSearch,
} from "./urlSync"

type Mirrored = Parameters<typeof searchFromState>[0]

/** The mirrored store fields: the overview, nothing selected, paused at J2000 at 1x, every layer on unless overridden. */
const state = (partial: Partial<Mirrored> = {}): Mirrored => ({
	view: OVERVIEW,
	selectedId: null,
	shot: null,
	timeWarp: 1,
	paused: true,
	simTimeJD: J2000_JD,
	showOrbits: true,
	showLabels: true,
	showMoons: true,
	showMarkers: true,
	showOrbitLabels: false,
	...partial,
})

describe("simSearchSchema", () => {
	it("accepts the mirrored params and coerces numeric strings", () => {
		expect(
			simSearchSchema.parse({ focus: "io", t: "2451545.1234", warp: "60" }),
		).toEqual({ focus: "io", t: 2451545.1234, warp: 60 })
		expect(simSearchSchema.parse({ t: 2451545, warp: 3600 })).toEqual({
			t: 2451545,
			warp: 3600,
		})
		expect(simSearchSchema.parse({ warp: 3.7 }).warp).toBe(3.7)
		expect(simSearchSchema.parse({})).toEqual({})
	})

	it("drops invalid values instead of failing the whole search", () => {
		expect(simSearchSchema.parse({ focus: 42, t: "abc", warp: "x" })).toEqual({
			focus: undefined,
			t: undefined,
			warp: undefined,
		})
		expect(simSearchSchema.parse({ t: "Infinity", warp: 0 })).toEqual({
			t: undefined,
			warp: undefined,
		})
		expect(simSearchSchema.parse({ focus: "planet-x" }).focus).toBe("planet-x")
	})

	it("accepts a negative warp (the clock running backwards) but not 0", () => {
		expect(simSearchSchema.parse({ warp: "-86400" }).warp).toBe(-86400)
		expect(simSearchSchema.parse({ warp: -1 }).warp).toBe(-1)
		expect(simSearchSchema.parse({ warp: "0" }).warp).toBeUndefined()
		expect(simSearchSchema.parse({ warp: "-0" }).warp).toBeUndefined()
	})

	it("reads the layer switches as booleans and drops anything else", () => {
		for (const [param] of LAYER_PARAMS) {
			expect(simSearchSchema.parse({ [param]: false })[param]).toBe(false)
			expect(simSearchSchema.parse({ [param]: true })[param]).toBe(true)
			for (const value of [0, "off", "", null]) {
				expect(simSearchSchema.parse({ [param]: value })[param]).toBeUndefined()
			}
		}
	})

	it("treats blank and non-numeric values as absent, never as 0", () => {
		// `?t=` and `?t=%20` reach the schema as "" and " "; `?t=null` / `?t=true` as null / true
		for (const value of ["", " ", null, true, false, {}, []]) {
			expect(simSearchSchema.parse({ t: value, warp: value })).toEqual({
				t: undefined,
				warp: undefined,
			})
		}
	})
})

describe("urlSync helpers", () => {
	it("rounds Julian Dates to 4 decimals", () => {
		expect(roundJD(2451545.123456789)).toBe(2451545.1235)
		expect(roundJD(J2000_JD)).toBe(J2000_JD)
	})

	it("mirrors time only while paused or at a slow warp", () => {
		expect(shouldMirrorTime(false, 1)).toBe(true)
		expect(shouldMirrorTime(false, TIME_SYNC_MAX_WARP)).toBe(true)
		expect(shouldMirrorTime(false, 3600)).toBe(false)
		expect(shouldMirrorTime(true, 31557600)).toBe(true)
		// backwards counts by its speed
		expect(shouldMirrorTime(false, -TIME_SYNC_MAX_WARP)).toBe(true)
		expect(shouldMirrorTime(false, -3600)).toBe(false)
	})

	it("builds the search from the store, omitting the defaults", () => {
		expect(
			searchFromState(
				state({ timeWarp: 1, paused: false, simTimeJD: J2000_JD }),
				{},
			),
		).toEqual({
			focus: undefined,
			sel: undefined,
			cam: undefined,
			t: J2000_JD,
			warp: undefined,
		})
		expect(
			searchFromState(
				state({
					view: { kind: "body", id: "io" },
					selectedId: "io",
					timeWarp: 60,
					paused: false,
					simTimeJD: 2451545.123456,
				}),
				{},
			),
		).toEqual({ focus: "io", t: 2451545.1235, warp: 60 })
	})

	it("keeps the time out of the link while a birth date is entered (#26)", () => {
		const paused = state({ paused: true, simTimeJD: 2456000.5 })
		expect(searchFromState(paused, {}).t).toBe(2456000.5)
		expect(searchFromState(paused, {}, true).t).toBeUndefined()
		// not even the last written value survives
		expect(searchFromState(paused, { t: 2456000.5 }, true).t).toBeUndefined()
	})

	it("writes the view, a selection that differs from it and the camera shot", () => {
		const search = (partial: Partial<Mirrored>) => {
			const { focus, sel, cam } = searchFromState(state(partial), {})
			return { focus, sel, cam }
		}
		// the focused Sun is not the overview
		expect(search({ view: { kind: "body", id: "sun" } }).focus).toBe("sun")
		expect(search({ selectedId: "saturn" })).toEqual({
			focus: undefined,
			sel: "saturn",
			cam: undefined,
		})
		expect(
			search({
				view: { kind: "body", id: "jupiter" },
				selectedId: "io",
				shot: { azimuthDeg: -30, elevationDeg: 12.5, distance: 2.5 },
			}),
		).toEqual({ focus: "jupiter", sel: "io", cam: "-30_12.5_2.5" })
		// the home camera is the default and stays out of the URL
		expect(search({ shot: HOME_SHOT }).cam).toBeUndefined()
		// a point in space: its anchor in `focus`, its offset in `at` (pointView.test.ts)
		expect(
			search({
				view: { kind: "point", anchorId: "mars", offsetKm: [1, 2, 3] },
			}).focus,
		).toBe("mars")
	})

	it("keeps the last written t while the clock runs too fast to mirror", () => {
		const previous = { focus: "io", t: 2451545.5, warp: 60 }
		const mars: Partial<Mirrored> = {
			view: { kind: "body", id: "mars" },
			selectedId: "mars",
		}
		expect(
			searchFromState(
				state({ ...mars, timeWarp: 86400, paused: false, simTimeJD: 2460000 }),
				previous,
			),
		).toEqual({ focus: "mars", t: 2451545.5, warp: 86400 })
		// pausing pins the current time again
		expect(
			searchFromState(
				state({ ...mars, timeWarp: 86400, paused: true, simTimeJD: 2460000 }),
				previous,
			).t,
		).toBe(2460000)
	})

	it("writes a non-integer warp as it is, so a link runs at the speed it was taken at", () => {
		const mirrored = (timeWarp: number) =>
			searchFromState(
				state({ timeWarp, paused: true, simTimeJD: J2000_JD }),
				{},
			)
		expect(mirrored(59.6).warp).toBe(59.6)
		expect(mirrored(3.7).warp).toBe(3.7)
		expect(mirrored(0.5).warp).toBe(0.5)
		// the round trip through the schema and back into the store is exact
		for (const warp of [3.7, 0.5]) {
			const parsed = simSearchSchema.parse(mirrored(warp))
			expect(stateFromSearch(parsed).timeWarp).toBe(warp)
		}
		// a reversed clock is shared as it is; only 0 (rejected by the schema) is left out
		expect(mirrored(-60).warp).toBe(-60)
		expect(stateFromSearch(simSearchSchema.parse(mirrored(-60))).timeWarp).toBe(
			-60,
		)
		expect(mirrored(0).warp).toBeUndefined()
	})

	it("writes a layer switch only when it is off", () => {
		const allOn = {
			showOrbits: true,
			showLabels: true,
			showMoons: true,
			showMarkers: true,
			showOrbitLabels: false,
			showSmallBodies: false,
			showAllMoons: false,
		}
		const { orbits, labels, moons, markers } = searchFromState(state(), {})
		expect([orbits, labels, moons, markers]).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
		])
		expect(layersFromSearch({})).toEqual(allOn)
		for (const [param, field] of LAYER_PARAMS) {
			const off = state({ [field]: false })
			const search = searchFromState(off, {})
			expect(search[param]).toBe(false)
			// only that one is written
			expect(
				LAYER_PARAMS.filter(([other]) => search[other] !== undefined),
			).toHaveLength(1)
			expect(layersFromSearch({ [param]: false })).toEqual({
				...allOn,
				[field]: false,
			})
			expect(layersFromSearch({ [param]: true })).toEqual(allOn)
			// the round trip through the schema and back into the store
			expect(layersFromSearch(simSearchSchema.parse(search))[field]).toBe(false)
		}
	})

	it("writes the orbit names only when they are on (off by default)", () => {
		expect(searchFromState(state(), {}).orbitNames).toBeUndefined()
		const on = searchFromState(state({ showOrbitLabels: true }), {})
		expect(on.orbitNames).toBe(true)
		expect(layersFromSearch(simSearchSchema.parse(on)).showOrbitLabels).toBe(
			true,
		)
		expect(layersFromSearch({}).showOrbitLabels).toBe(false)
		expect(sameSearch({ orbitNames: true }, {})).toBe(false)
	})

	it("writes all moons only when they are on (off by default, #17)", () => {
		expect(searchFromState(state(), {}).allMoons).toBeUndefined()
		const on = searchFromState(state({ showAllMoons: true }), {})
		expect(on.allMoons).toBe(true)
		expect(layersFromSearch(simSearchSchema.parse(on)).showAllMoons).toBe(true)
		expect(layersFromSearch({}).showAllMoons).toBe(false)
		expect(sameSearch({ allMoons: true }, {})).toBe(false)
	})

	it("compares searches field by field", () => {
		expect(
			sameSearch(
				{ focus: "io", t: 1, warp: 2 },
				{ focus: "io", t: 1, warp: 2 },
			),
		).toBe(true)
		expect(sameSearch({}, { focus: undefined })).toBe(true)
		expect(sameSearch({ t: 1 }, { t: 1.0001 })).toBe(false)
		expect(sameSearch({ cam: "0_10_1" }, { cam: "0_10_2" })).toBe(false)
		expect(sameSearch({ sel: "io" }, {})).toBe(false)
		expect(sameSearch({ markers: false }, {})).toBe(false)
		expect(sameSearch({ moons: false }, { moons: false })).toBe(true)
		expect(sameSearch({ orbits: false }, { labels: false })).toBe(false)
	})

	it("seeds the clock from the search, skipping absent params", () => {
		expect(stateFromSearch({})).toEqual({})
		expect(stateFromSearch({ focus: "io", t: J2000_JD, warp: 3600 })).toEqual({
			simTimeJD: J2000_JD,
			timeWarp: 3600,
		})
	})

	it("reads the view, its camera and the selection, skipping unknown bodies", () => {
		expect(viewFromSearch({})).toEqual({
			view: { kind: "overview" },
			shot: null,
			selectedId: null,
		})
		expect(viewFromSearch({ focus: "planet-x", sel: "vulcan" })).toEqual({
			view: { kind: "overview" },
			shot: null,
			selectedId: null,
		})
		// a focused body is selected unless the link selects another one
		expect(viewFromSearch({ focus: "io" }).selectedId).toBe("io")
		expect(
			viewFromSearch({ focus: "jupiter", sel: "europa", cam: "-30_12.5_2.5" }),
		).toEqual({
			view: { kind: "body", id: "jupiter" },
			shot: { azimuthDeg: -30, elevationDeg: 12.5, distance: 2.5 },
			selectedId: "europa",
		})
		// a malformed camera is ignored, never an error
		expect(viewFromSearch({ focus: "io", cam: "up_high" }).shot).toBeNull()
	})

	it("round-trips a view through the URL", () => {
		const taken = state({
			view: { kind: "body", id: "saturn" },
			selectedId: "titan",
			shot: { azimuthDeg: 123.4, elevationDeg: -5, distance: 0.75 },
		})
		const parsed = simSearchSchema.parse(searchFromState(taken, {}))
		expect(viewFromSearch(parsed)).toEqual({
			view: taken.view,
			shot: taken.shot,
			selectedId: taken.selectedId,
		})
	})

	it("writes and reads following a spacecraft (#57): craft, follow and its neighbourhood", () => {
		const taken = state({
			view: { kind: "craft", id: "voyager1", anchorId: "jupiter" },
			shot: { azimuthDeg: -27.5, elevationDeg: 68.4, distance: 3.21 },
			timeWarp: 172800,
		})
		const search = searchFromState(taken, {})
		expect(search).toMatchObject({
			craft: "voyager1",
			follow: true,
			focus: "jupiter",
			cam: "-27.5_68.4_3.21",
			warp: 172800,
		})
		expect(search.at).toBeUndefined()
		const parsed = simSearchSchema.parse(search)
		expect(viewFromSearch(parsed)).toEqual({
			view: taken.view,
			shot: taken.shot,
			selectedId: null,
		})
		expect(waypointFromSearch(parsed)).toEqual({
			kind: "follow",
			craftId: "voyager1",
			shot: taken.shot,
		})
		// a follow link without its neighbourhood waits at the Sun
		expect(viewFromSearch({ craft: "juno", follow: true }).view).toEqual({
			kind: "craft",
			id: "juno",
			anchorId: "sun",
		})
		// `craft` alone is only an instruction (select and show), unknown craft nothing
		expect(viewFromSearch({ craft: "voyager1" }).view).toEqual(OVERVIEW)
		expect(viewFromSearch({ craft: "enterprise", follow: true }).view).toEqual(
			OVERVIEW,
		)
		expect(simSearchSchema.parse({ follow: "yes" }).follow).toBeUndefined()
		// not following: neither is written
		const body = searchFromState(
			state({ view: { kind: "body", id: "io" } }),
			{},
		)
		expect(body.craft).toBeUndefined()
		expect(body.follow).toBeUndefined()
		expect(sameSearch(search, { ...search, follow: undefined })).toBe(false)
		expect(sameSearch(search, { ...search, craft: "juno" })).toBe(false)
	})

	it("seeds the wall clock on mount when the URL carries no t", () => {
		const now = new Date("2026-09-24T12:00:00Z")
		expect(mountState({}, now)).toEqual({ simTimeJD: dateToJD(now) })
		expect(mountState({ focus: "io", warp: 60 }, now)).toEqual({
			timeWarp: 60,
			simTimeJD: dateToJD(now),
		})
		// an explicit t wins
		expect(mountState({ t: J2000_JD }, now)).toEqual({ simTimeJD: J2000_JD })
		// without a clock argument it is the real wall clock
		const before = dateToJD(new Date())
		const seeded = mountState({}).simTimeJD
		expect(seeded).toBeGreaterThanOrEqual(before)
		expect(seeded).toBeLessThanOrEqual(dateToJD(new Date()))
	})

	it("reads a waypoint from an address the view history has no record of (#46)", () => {
		expect(
			waypointFromSearch({
				focus: "earth",
				frame: "earth",
				sel: "mars",
				cam: "0_89.9_120",
			}),
		).toEqual({
			kind: "view",
			view: { kind: "body", id: "earth" },
			shot: { azimuthDeg: 0, elevationDeg: 89.9, distance: 120 },
			frameId: "earth",
			selectedId: "mars",
			craftId: null,
			tour: null,
		})
		expect(waypointFromSearch({})).toMatchObject({
			kind: "view",
			view: OVERVIEW,
			frameId: "sun",
		})
		// a menu tour's stop is the tour's, counted from 1 in the address
		expect(waypointFromSearch({ tour: "grandTour", stop: 3 })).toEqual({
			kind: "tourStop",
			tour: { id: "grandTour", index: 2 },
		})
		// an unknown tour is only its view
		expect(waypointFromSearch({ tour: "nope", focus: "mars" })).toMatchObject({
			kind: "view",
			view: { kind: "body", id: "mars" },
		})
	})
})
