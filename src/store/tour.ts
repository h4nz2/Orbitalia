/**
 * The guided tour in progress (#28; docs/ARCHITECTURE.md, "Guided tours").
 *
 * Plain state only: which tour runs, at which stop, whether it advances by
 * itself, and what the scene looked like before it began. The player
 * (`features/solarSystem/tours/player.ts`: `startTour`, `nextStop`,
 * `previousStop`, `resumeTour`, `exitTour`, ...) is the only writer; it moves
 * the camera through the navigation model's scripted sequence (`playSequence`,
 * #10) and everything else through the store actions, so the tour survives the
 * visitor looking around, and a tour left with Escape can be taken up again.
 *
 * The tour is in the URL (`?tour=<id>&stop=<n>`, see urlSync.ts), so a stop
 * can be shared as a link.
 */
import { create } from "zustand"

import { eventOfTourId } from "@/data/skyEvents"
import { tourById, type Tour } from "@/data/tours"
import type { ScalePresetId } from "@/sim"

import type { CameraShot, SequenceStep, View } from "./navigation"

/** The layer switches a tour may set: store field per tour-file key. */
export const TOUR_LAYER_FIELDS = {
	orbits: "showOrbits",
	labels: "showLabels",
	moons: "showMoons",
	markers: "showMarkers",
	orbitNames: "showOrbitLabels",
	allMoons: "showAllMoons",
} as const

export type TourLayerKey = keyof typeof TOUR_LAYER_FIELDS

/**
 * The scene before the tour began: what a stop falls back to for anything no
 * earlier stop has set, so going back to a stop restores it exactly.
 */
export interface TourBaseline {
	readonly scale: ScalePresetId | null
	readonly warp: number
	readonly paused: boolean
	readonly layers: Readonly<Record<TourLayerKey, boolean>>
	/**
	 * Where the viewer was when a tour that returns on exit began (a sky
	 * event, #41): leaving it goes back there.
	 */
	readonly scene?: TourScene
}

/** The view and time a tour with `returnOnExit` goes back to. */
export interface TourScene {
	readonly view: View
	readonly shot: CameraShot | null
	readonly frameId: string
	readonly selectedId: string | null
	readonly jd: number
	/** The clock was showing the present at 1x: leaving goes back to now, not to that instant. */
	readonly atNow: boolean
}

export interface TourState {
	/** The tour in progress (a menu tour, or any other `Tour` a feature plays, #30); null: none. */
	tour: Tour | null
	/** The current stop. */
	index: number
	/**
	 * The camera sequence the player last handed to the navigation model: while
	 * `sequence.steps` is this array, the camera is on the tour.
	 */
	steps: readonly SequenceStep[] | null
	/** Stops advance by themselves after their narration (kiosk, solo use); manual by default. */
	auto: boolean
	baseline: TourBaseline | null
	/** The narration card is folded to one line. */
	collapsed: boolean
	setCollapsed: (collapsed: boolean) => void
}

export const useTourStore = create<TourState>()((set) => ({
	tour: null,
	index: 0,
	steps: null,
	auto: false,
	baseline: null,
	collapsed: false,
	setCollapsed: (collapsed) => set({ collapsed }),
}))

/**
 * A tour of the menu (src/data/tours) or a sky event (#41): the tours a link
 * can carry and the view history (#46) can return to. Any other `Tour` a
 * feature plays (the quick look, #44) is neither.
 */
export const isListedTour = (id: string): boolean =>
	tourById.has(id) || eventOfTourId(id) !== null

/** What the URL carries of the tour: its id, the stop counted from 1, and autoplay. */
export interface TourSearch {
	tour?: string
	stop?: number
	autoplay?: boolean
}

/**
 * The URL fields of `state`; nothing without a tour. A tour that is not a
 * menu tour (`isListed` false, e.g. an opening sequence) is never linked.
 */
export function tourSearch(
	state: Pick<TourState, "tour" | "index" | "auto">,
	isListed: (id: string) => boolean,
): TourSearch {
	const { tour } = state
	if (tour === null || !isListed(tour.id)) return {}
	return {
		tour: tour.id,
		stop: state.index + 1,
		autoplay: state.auto ? true : undefined,
	}
}
