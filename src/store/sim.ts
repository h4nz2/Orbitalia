/**
 * The simulation store (docs/ARCHITECTURE.md, "Store").
 *
 * React UI subscribes through selectors (`useSimStore((s) => s.paused)`); code
 * inside `useFrame` reads `useSimStore.getState()` so no frame ever causes a
 * re-render.
 *
 * Time (issue #9): `clock` is the one time source, simulation time as a pure
 * function of real time (src/sim/clock.ts). The time actions below re-anchor it
 * at `performance.now()`; `scene/SimClock.tsx` samples it once per frame with
 * `tick()` into `simTimeJD`, which every consumer reads. Nothing else may write
 * `simTimeJD`, `timeWarp`, `paused` or `clock` directly (a bare `setState`
 * would bypass the clock); use the actions.
 *
 * Selection and the camera's view (`selectedId`, `focusId`, `setFocus`,
 * `goTo`, ...) are the navigation slice composed in from `./navigation`.
 */
import { create } from "zustand"

import { bodyById, isSmallBody, type Body } from "@/data"
import {
	MS_PER_DAY,
	createTimeline,
	dateToJD,
	glideDurationMs,
	glideTimeline,
	jumpTimeline,
	retimeTimeline,
	settleTimeline,
	skipFrameGap,
	timelineJD,
	type SimTimeline,
} from "@/sim"

import { createNavigationSlice, type NavigationSlice } from "./navigation"

export interface SimState extends NavigationSlice {
	/**
	 * Simulation time (Julian Date) of the current frame: the clock sampled by
	 * the last `tick()` or time action. React UI reads it via `useThrottledSimTime()`.
	 */
	simTimeJD: number
	/** Simulated seconds per real second while playing; negative runs backwards. Kept while paused. */
	timeWarp: number
	paused: boolean
	/**
	 * The clock: simulation time as a function of `performance.now()`, running
	 * at `paused ? 0 : timeWarp`. `clock.glide` is non-null while a `travelTo`
	 * glide is under way (cleared by the first tick after it lands), and
	 * `clock.anchorMs` is then its arrival time.
	 */
	clock: SimTimeline
	/** `performance.now()` of the last `tick()`; null before the first frame. */
	lastTickMs: number | null
	hoverId: string | null
	showOrbits: boolean
	showLabels: boolean
	showMoons: boolean
	/**
	 * The long tail (#17): every moon, not only the featured ones with a story
	 * (`Body.featured`). Off by default; needs `showMoons`.
	 */
	showAllMoons: boolean
	/**
	 * The active scale hides the long tail whatever `showAllMoons` says (#54:
	 * Poster packs moon systems too tight for it, `HIDES_LONG_TAIL`). Kept in
	 * step with the scale store's chosen preset by src/store/scale.ts; read it
	 * through `allMoonsShown`.
	 */
	longTailHidden: boolean
	/** Screen-sized dots for bodies too small to see (scene/Markers.tsx). */
	showMarkers: boolean
	/** Names written along the orbit lines (labels/, #20); off by default. */
	showOrbitLabels: boolean
	/**
	 * The "Small bodies" layer (#23): dwarf planets, asteroids, comets and the belts; off by
	 * default so the planets' overview stays legible. The focused small body's system shows anyway.
	 */
	showSmallBodies: boolean

	/**
	 * Speed in simulated seconds per real second; negative reverses. Nothing
	 * moves at the moment of the change. Non-finite values are ignored.
	 */
	setTimeWarp: (warp: number) => void
	togglePause: () => void
	/** Freezes (or resumes) every body at once, exactly where it is. */
	setPaused: (paused: boolean) => void
	/** Instant jump to a Julian Date (deep links, tests). Non-finite values are ignored. */
	setSimTime: (jd: number) => void
	/**
	 * Time travel: glides the clock to `jd` over `durationMs` (default
	 * `glideDurationMs` of the distance) so every body sweeps along its path,
	 * then runs on at the current speed (or stays paused). Works while paused.
	 * Non-finite values are ignored.
	 */
	travelTo: (jd: number, durationMs?: number) => void
	/** The clock sample for the frame at `realMs` (`performance.now()`). SimClock's job; nobody else calls it. */
	tick: (realMs: number) => void
	setHover: (id: string | null) => void
	setShowOrbits: (show: boolean) => void
	setShowLabels: (show: boolean) => void
	setShowMoons: (show: boolean) => void
	setShowAllMoons: (show: boolean) => void
	setLongTailHidden: (hidden: boolean) => void
	setShowMarkers: (show: boolean) => void
	setShowOrbitLabels: (show: boolean) => void
	setShowSmallBodies: (show: boolean) => void
	/** Travels (glides) to the wall clock, arriving on the present. */
	setNow: () => void
}

/** The store fields that decide which moons are drawn (`isBodyShown`). */
export type MoonVisibility = Pick<
	SimState,
	"showMoons" | "showAllMoons" | "focusId"
> &
	Partial<Pick<SimState, "showSmallBodies" | "longTailHidden">>

/** Whether the long tail of moons is asked for and allowed by the scale (#17, #54). */
export const allMoonsShown = (
	state: Pick<SimState, "showAllMoons"> &
		Partial<Pick<SimState, "longTailHidden">>,
): boolean => state.showAllMoons && state.longTailHidden !== true

/** The body a moon orbits, else the body itself: the system a body belongs to. */
const systemOf = (
	body: Pick<Body, "id" | "kind"> & Partial<Pick<Body, "parentId">>,
): string =>
	body.kind === "moon" && typeof body.parentId === "string"
		? body.parentId
		: body.id

/**
 * Whether a body is rendered at all (meshes, orbit line, marker, picking,
 * labels, shadows): the Sun and planets always; moons while `showMoons` is on,
 * the featured ones only unless `showAllMoons` asks for the long tail (#17,
 * docs/ARCHITECTURE.md, "Moons") and the scale allows it (`longTailHidden`,
 * #54); and always the focus, so hiding moons never
 * leaves the camera staring at nothing. Small bodies (#23: dwarf planets,
 * asteroids, comets and their moons) only while `showSmallBodies` is on, except
 * the focus's own system: picking Pluto shows Pluto and Charon.
 */
export const isBodyShown = (
	body: Pick<Body, "id" | "kind" | "featured"> &
		Partial<Pick<Body, "parentId">>,
	state: MoonVisibility,
): boolean => {
	if (
		body.kind === "moon" &&
		body.id !== state.focusId &&
		!(state.showMoons && (body.featured === true || allMoonsShown(state)))
	) {
		return false
	}
	if (state.showSmallBodies === true) return true
	if (!isSmallBody({ kind: body.kind, parentId: body.parentId ?? null })) {
		return true
	}
	const focus = bodyById.get(state.focusId)
	return focus !== undefined && systemOf(focus) === systemOf(body)
}

/**
 * The speed presets (simulated seconds per real second), slowest first: real
 * time, 1 min/s, 1 h/s, 1 day/s, 1 week/s, 1 month/s, 1 year/s, 10 years/s.
 * Each step multiplies the speed, so the list is a logarithmic scale; the HUD
 * names them from the value (`ui/warp.ts`) and applies the direction on top.
 */
export const WARP_PRESETS: readonly number[] = [
	1, 60, 3600, 86400, 604800, 2629800, 31557600, 315576000,
]

/** The store fields a changed clock sets: the clock and its sample at `realMs`. */
const clockAt = (clock: SimTimeline, realMs: number) => ({
	clock,
	simTimeJD: timelineJD(clock, realMs),
})

const initialJD = dateToJD(new Date())

export const useSimStore = create<SimState>()((set, get) => ({
	...createNavigationSlice(set, get),
	simTimeJD: initialJD,
	timeWarp: 1,
	paused: false,
	clock: createTimeline(initialJD, performance.now(), 1),
	lastTickMs: null,
	hoverId: null,
	showOrbits: true,
	showLabels: true,
	showMoons: true,
	showAllMoons: false,
	longTailHidden: false,
	showMarkers: true,
	showOrbitLabels: false,
	showSmallBodies: false,

	setTimeWarp: (warp) => {
		if (!Number.isFinite(warp)) return
		const { clock, paused } = get()
		const now = performance.now()
		set({
			timeWarp: warp,
			...clockAt(retimeTimeline(clock, now, paused ? 0 : warp), now),
		})
	},
	togglePause: () => get().setPaused(!get().paused),
	setPaused: (paused) => {
		const { clock, timeWarp } = get()
		const now = performance.now()
		set({
			paused,
			...clockAt(retimeTimeline(clock, now, paused ? 0 : timeWarp), now),
		})
	},
	setSimTime: (jd) => {
		if (!Number.isFinite(jd)) return
		const now = performance.now()
		set(clockAt(jumpTimeline(get().clock, now, jd), now))
	},
	travelTo: (jd, durationMs) => {
		if (!Number.isFinite(jd)) return
		const now = performance.now()
		set(clockAt(glideTimeline(get().clock, now, jd, durationMs), now))
	},
	tick: (realMs) => {
		const { clock, lastTickMs } = get()
		const gapped =
			lastTickMs === null ? clock : skipFrameGap(clock, lastTickMs, realMs)
		set({
			...clockAt(settleTimeline(gapped, realMs), realMs),
			lastTickMs: realMs,
		})
	},
	setHover: (id) => {
		if (get().hoverId !== id) set({ hoverId: id })
	},
	setShowOrbits: (show) => set({ showOrbits: show }),
	setShowLabels: (show) => set({ showLabels: show }),
	setShowMoons: (show) => set({ showMoons: show }),
	setShowAllMoons: (show) => set({ showAllMoons: show }),
	setLongTailHidden: (hidden) => {
		if (get().longTailHidden !== hidden) set({ longTailHidden: hidden })
	},
	setShowMarkers: (show) => set({ showMarkers: show }),
	setShowOrbitLabels: (show) => set({ showOrbitLabels: show }),
	setShowSmallBodies: (show) => set({ showSmallBodies: show }),
	setNow: () => {
		const { clock, travelTo } = get()
		const now = dateToJD(new Date())
		const durationMs = glideDurationMs(
			now - timelineJD(clock, performance.now()),
		)
		// aim at the present as it will be on arrival
		travelTo(now + durationMs / MS_PER_DAY, durationMs)
	},
}))

export default useSimStore
