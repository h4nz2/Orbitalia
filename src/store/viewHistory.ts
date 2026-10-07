/**
 * The view history: Back returns to where you just were (#46;
 * docs/ARCHITECTURE.md, "Back: the view history").
 *
 * A step is a change of what is in view that Back can undo: choosing a body or
 * a spacecraft, a flight, the way out, a tour stop, a milestone, a sky event, a
 * hunt's "Show me", holding a body still. Each one is marked in the navigation
 * slice (`markStep()`, which bumps `step`) before it changes anything, and adds
 * an entry to the browser's history; everything else (dragging, zooming, time
 * passing, layers, the scale) keeps rewriting the entry on screen. So the
 * browser's and the phone's back do exactly what the Back button does, and
 * Forward re-applies a step.
 *
 * The address of every entry still describes its view, as it always did. What
 * an address cannot carry (the spacecraft chosen, whether the camera was on a
 * tour's stop) is kept here with the view and the camera exactly as they were
 * when the entry was left: one `Waypoint` per entry, by its place in the
 * browser history (TanStack's `__TSR_index`), for the entries of this visit.
 * An entry without one (after a reload) is read from its address instead.
 *
 * `createRecorder` is the bookkeeping the URL sync (`./urlSync.ts`) drives;
 * going to a waypoint is the solar system's (`features/solarSystem/back`),
 * registered with `onArrive`.
 */
import { create } from "zustand"

import {
	sameShot,
	sameView,
	type CameraShot,
	type NavigationSlice,
	type View,
} from "./navigation"
import { isListedTour, type TourState } from "./tour"

/** A stop of a guided tour or a sky event: the tour's id and the stop, counted from 0. */
export interface TourAt {
	readonly id: string
	readonly index: number
}

/**
 * Where an entry of the history returns to. A new kind of view (#57: following
 * a spacecraft) is one more member here, a case in `sameWaypoint` and
 * `waypointOf`, and one in the solar system's `returnTo`.
 */
export type Waypoint =
	/**
	 * A stop of a menu tour or a sky event, with the camera on it: going there
	 * is the tour's own move (#28), which restores the stop's whole scene.
	 */
	| { readonly kind: "tourStop"; readonly tour: TourAt }
	/** What was in view, and from where. */
	| {
			readonly kind: "view"
			/** The overview, a body, or a point in space (#15). */
			readonly view: View
			/** The camera round it as it last came to rest; null: not known (it was moving). */
			readonly shot: CameraShot | null
			/** The body held still (#31), the Sun for the Sun-centred frame. */
			readonly frameId: string
			readonly selectedId: string | null
			/** The spacecraft chosen (#35), which the address does not carry. */
			readonly craftId: string | null
			/** The tour open meanwhile (looking around during a tour), if any. */
			readonly tour: TourAt | null
	  }

const sameTourAt = (a: TourAt | null, b: TourAt | null): boolean =>
	a === b || (a !== null && b !== null && a.id === b.id && a.index === b.index)

export function sameWaypoint(a: Waypoint, b: Waypoint): boolean {
	if (a.kind === "tourStop" || b.kind === "tourStop") {
		return a.kind === b.kind && sameTourAt(a.tour, b.tour)
	}
	return (
		sameView(a.view, b.view) &&
		sameShot(a.shot, b.shot) &&
		a.frameId === b.frameId &&
		a.selectedId === b.selectedId &&
		a.craftId === b.craftId &&
		sameTourAt(a.tour, b.tour)
	)
}

/** The scene as a waypoint: a tour stop while the camera is on a menu tour or sky event, else the view. */
export function waypointOf(
	sim: Pick<
		NavigationSlice,
		"view" | "shot" | "frameId" | "selectedId" | "sequence"
	>,
	tour: Pick<TourState, "tour" | "index" | "steps">,
	craftId: string | null,
): Waypoint {
	const open: TourAt | null =
		tour.tour !== null && isListedTour(tour.tour.id)
			? { id: tour.tour.id, index: tour.index }
			: null
	const onTour =
		open !== null &&
		sim.sequence !== null &&
		sim.sequence.steps === tour.steps &&
		sim.sequence.phase !== "interrupted"
	if (open !== null && onTour) return { kind: "tourStop", tour: open }
	return {
		kind: "view",
		view: sim.view,
		shot: sim.shot,
		frameId: sim.frameId,
		selectedId: sim.selectedId,
		craftId,
		tour: open,
	}
}

export interface ViewHistoryState {
	/** The place in the browser history of the entry on screen (TanStack's `__TSR_index`). */
	index: number
	/** Where each entry of this visit that showed the solar system returns to, by place. */
	entries: Readonly<Record<number, Waypoint>>
	/**
	 * Each entry's key as last seen (a new one on every rewrite), so an entry
	 * that is no longer the one recorded (another page wrote over it) is told apart.
	 */
	keys: Readonly<Record<number, string>>
}

export const useViewHistoryStore = create<ViewHistoryState>()(() => ({
	index: 0,
	entries: {},
	keys: {},
}))

/** True when the entry behind the one on screen is a view of the solar system to go back to. */
export const canGoBack = (
	state: Pick<ViewHistoryState, "index" | "entries">,
): boolean => state.entries[state.index - 1] !== undefined

/** The waypoint Back returns to, if any. */
export const entryBehind = (
	state: Pick<ViewHistoryState, "index" | "entries">,
): Waypoint | null => state.entries[state.index - 1] ?? null

/** The entries from `index` on are gone (a new entry was written there). */
function dropFrom(
	state: ViewHistoryState,
	index: number,
): Pick<ViewHistoryState, "entries" | "keys"> {
	const keep = <T>(record: Readonly<Record<number, T>>) =>
		Object.fromEntries(
			Object.entries(record).filter(([at]) => Number(at) < index),
		) as Record<number, T>
	return { entries: keep(state.entries), keys: keep(state.keys) }
}

/** A notification of the browser history (TanStack's `history.subscribe`). */
export interface HistoryNote {
	readonly action: "PUSH" | "REPLACE" | "BACK" | "FORWARD" | "GO"
	/** The place of the entry now on screen. */
	readonly index: number
	readonly key: string | undefined
	/** The entry now on screen shows the solar system (not another page). */
	readonly solarSystem: boolean
}

export interface RecorderDeps {
	/** The scene now, as a waypoint. */
	now: () => Waypoint
	/** Writes the address: as a new entry (`push`, a step) or over the one on screen. */
	write: (push: boolean) => void
	/**
	 * Back or forward landed on an entry of the solar system: go there.
	 * `recorded` is its waypoint, null for an entry of an earlier visit (read
	 * its address). No step is made meanwhile.
	 */
	arrive: (recorded: Waypoint | null) => void
	/** Runs `fn` once the current task is over (a microtask by default). */
	defer?: (fn: () => void) => void
}

export interface Recorder {
	/** The page appeared on the entry at `index` (with `key`). */
	open: (index: number, key: string | undefined) => void
	/** A step began (`step` moved): the view being left is kept, and the address waits for the step's end. */
	step: () => void
	/** True while a step is open: a change for the address waits for its end, which writes it once. */
	holds: () => boolean
	/** A notification of the browser history. */
	note: (note: HistoryNote) => void
	/** The page is gone: a step still open is dropped, nothing more is written. */
	dispose: () => void
}

/**
 * The bookkeeping of the view history for one mounted solar system page. A
 * step is everything that changes in the task that marked it: at its end the
 * address is written once, as a new entry when the waypoint changed (with the
 * view left recorded behind it), else in place.
 */
export function createRecorder(
	deps: RecorderDeps,
	store = useViewHistoryStore,
): Recorder {
	const defer = deps.defer ?? queueMicrotask
	let leaving: Waypoint | null = null
	let disposed = false

	const end = () => {
		const left = leaving
		leaving = null
		if (left === null || disposed) return
		const push = !sameWaypoint(left, deps.now())
		if (push) {
			const { index, entries } = store.getState()
			store.setState({ entries: { ...entries, [index]: left } })
		}
		deps.write(push)
	}

	const withKey = (
		keys: Readonly<Record<number, string>>,
		at: number,
		key?: string,
	) => (key === undefined ? keys : { ...keys, [at]: key })

	return {
		open: (index, key) => {
			const state = store.getState()
			const known = key !== undefined && state.keys[index] === key
			const kept = known ? state : { ...state, ...dropFrom(state, index) }
			store.setState({
				index,
				entries: kept.entries,
				keys: withKey(kept.keys, index, key),
			})
		},
		step: () => {
			if (leaving !== null || quiet > 0 || disposed) return
			leaving = deps.now()
			defer(end)
		},
		holds: () => leaving !== null,
		note: ({ action, index, key, solarSystem }) => {
			const state = store.getState()
			if (action === "PUSH") {
				// a new entry (a step, or another page): whatever lay ahead is gone
				const kept = dropFrom(state, index)
				store.setState({ index, ...kept, keys: withKey(kept.keys, index, key) })
				return
			}
			if (action === "REPLACE") {
				store.setState({ index, keys: withKey(state.keys, index, key) })
				return
			}
			// back, forward or a jump: the entry left keeps the scene exactly as it was left
			store.setState({
				index,
				entries: { ...state.entries, [state.index]: deps.now() },
				keys: withKey(state.keys, index, key),
			})
			if (solarSystem)
				withoutSteps(() => deps.arrive(state.entries[index] ?? null))
		},
		dispose: () => {
			disposed = true
			leaving = null
		},
	}
}

/** Nesting depth of `withoutSteps`. */
let quiet = 0

/**
 * Runs `fn` without making a step of whatever it marks: going back or
 * forward to an entry, a link opening on a tour stop, a tour another feature
 * plays (the quick look, #44).
 */
export function withoutSteps<T>(fn: () => T): T {
	quiet += 1
	try {
		return fn()
	} finally {
		quiet -= 1
	}
}

let goBackInHistory: (() => void) | null = null

/** The URL sync: how to go one entry back in the browser history (null when the page is gone). */
export function setHistoryBack(back: (() => void) | null): void {
	goBackInHistory = back
}

/**
 * One entry back in the browser history, when that entry is a view of the
 * solar system (`canGoBack`); false otherwise, and nothing happens.
 */
export function historyBack(): boolean {
	if (goBackInHistory === null || !canGoBack(useViewHistoryStore.getState())) {
		return false
	}
	goBackInHistory()
	return true
}

let arriveAt: ((target: Waypoint) => void) | null = null

/** The solar system: what going to a waypoint does. Returns the function that removes it again. */
export function onArrive(handler: (target: Waypoint) => void): () => void {
	arriveAt = handler
	return () => {
		if (arriveAt === handler) arriveAt = null
	}
}

/** Goes to `target` with the solar system's handler, if one is there. */
export function arrive(target: Waypoint): void {
	arriveAt?.(target)
}
