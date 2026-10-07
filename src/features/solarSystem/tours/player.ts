/**
 * The tour player (#28): plays any `Tour` (a menu tour from `src/data/tours`,
 * or a sequence another feature builds, e.g. the opening of #30) on the
 * existing machinery. The camera moves only as a scripted sequence of the
 * navigation model (#10: `playSequence`, stops without holds wait for the
 * presenter); the clock goes through the time actions (#9, #14), the scale
 * through `useScaleStore` (#21), the body held still through `anchorFrame` /
 * `releaseFrame` (#31). Nothing here touches the camera or the clock directly.
 *
 * Leaving and coming back: a click on a body or a drag while the camera moves
 * interrupts the sequence (the card offers to go back to the stop), Escape or
 * the home button end the sequence but not the tour, and `resumeTour()`
 * restores the stop in both cases: its view, date, speed, scale, layers and
 * frame. Presentation mode (#29) and keyboard shortcuts call these functions.
 *
 * Entering a stop of a menu tour or a sky event is a step of the view history
 * (#46), so Back returns to the stop before; a link opening on a stop, and a
 * tour another feature plays (the quick look, #44), are not.
 */
import type { Tour } from "@/data/tours"
import { tourById } from "@/data/tours"
import { dateToJD } from "@/sim"
import { FLIGHT_PROFILE } from "@/store/flight"
import { HOME_SHOT, OVERVIEW_BODY_ID, type Sequence } from "@/store/navigation"
import { useScaleStore } from "@/store/scale"
import { useSimStore, type SimState } from "@/store/sim"
import {
	TOUR_LAYER_FIELDS,
	isListedTour,
	useTourStore,
	type TourBaseline,
	type TourLayerKey,
	type TourScene,
	type TourState,
} from "@/store/tour"
import { useTrailStore } from "@/store/trails"
import { withoutSteps } from "@/store/viewHistory"

import { arrivalJD } from "../ui/timeTravel"
import {
	stopFrame,
	stopSelection,
	stopSettings,
	timeJD,
	tourSteps,
} from "./plan"

/**
 * How a stop is entered:
 * - `forward`: the next stop in order; only the date it sets itself is travelled to.
 * - `restore`: any other entry (back, a jump, coming back after looking
 *   around): the stop as the tour first showed it, with the latest date.
 * - `jump`: `restore` without animation (a link opening on a stop).
 */
export type EnterMode = "forward" | "restore" | "jump"

/** The scene as it is now: what a tour falls back to for anything it has not set. */
export function currentBaseline(
	sim: Pick<
		SimState,
		| "timeWarp"
		| "paused"
		| "showOrbits"
		| "showLabels"
		| "showMoons"
		| "showMarkers"
		| "showOrbitLabels"
		| "showAllMoons"
	> = useSimStore.getState(),
	scale = useScaleStore.getState().targetId,
): TourBaseline {
	const layers = {} as Record<TourLayerKey, boolean>
	for (const [key, field] of Object.entries(TOUR_LAYER_FIELDS)) {
		layers[key as TourLayerKey] = sim[field]
	}
	return { scale, warp: sim.timeWarp, paused: sim.paused, layers }
}

const LAYER_SETTERS = {
	showOrbits: "setShowOrbits",
	showLabels: "setShowLabels",
	showMoons: "setShowMoons",
	showMarkers: "setShowMarkers",
	showOrbitLabels: "setShowOrbitLabels",
	showAllMoons: "setShowAllMoons",
} as const

/** Shows stop `index` of the running tour, as a step of the view history (#46) where it is one. */
function enterStop(index: number, mode: EnterMode): void {
	const { tour } = useTourStore.getState()
	if (tour === null) return
	if (mode === "jump" || !isListedTour(tour.id)) {
		withoutSteps(() => showStop(index, mode))
		return
	}
	useSimStore.getState().markStep()
	showStop(index, mode)
}

/** Shows stop `index` of the running tour: the scene first, then the camera. */
function showStop(index: number, mode: EnterMode): void {
	const { tour, baseline } = useTourStore.getState()
	if (tour === null || baseline === null) return
	const at = Math.max(0, Math.min(tour.stops.length - 1, Math.trunc(index)))
	const stop = tour.stops[at]
	const settings = stopSettings(tour, at, baseline)
	const sim = useSimStore.getState()
	const jump = mode === "jump"

	// scale: a switch the class watches, unless a link is opening
	const scaleStore = useScaleStore.getState()
	if (settings.scale !== null && scaleStore.targetId !== settings.scale) {
		if (jump) scaleStore.setPreset(settings.scale)
		else scaleStore.switchTo(settings.scale, performance.now())
	}

	for (const key of Object.keys(TOUR_LAYER_FIELDS) as TourLayerKey[]) {
		const field = TOUR_LAYER_FIELDS[key]
		if (sim[field] !== settings.layers[key]) {
			sim[LAYER_SETTERS[field]](settings.layers[key])
		}
	}

	// the clock: the speed first, so a date glide runs on at it (or lands paused)
	if (settings.paused) {
		if (!sim.paused) sim.setPaused(true)
	} else {
		if (sim.timeWarp !== settings.warp) sim.setTimeWarp(settings.warp)
		if (sim.paused) sim.setPaused(false)
	}
	const time = mode === "forward" ? (stop.time ?? null) : settings.time?.time
	const jd = time == null ? null : timeJD(time)
	if (jd !== null) {
		if (jump) sim.setSimTime(jd)
		else if (time === "now") sim.setNow()
		else sim.travelTo(jd)
	}
	const seenAt = jd ?? useSimStore.getState().simTimeJD

	// the body held still, before the camera: the sequence keeps the frame it finds
	const frame = stopFrame(stop)
	if (frame !== useSimStore.getState().frameId) {
		if (frame === OVERVIEW_BODY_ID) sim.releaseFrame()
		else sim.anchorFrame(frame)
	}
	const trails = useTrailStore.getState()
	const since =
		stop.trails === undefined
			? null
			: stop.trails === "restart"
				? seenAt
				: arrivalJD(stop.trails.since)
	if (frame !== OVERVIEW_BODY_ID && since !== null) trails.restartTrails(since)
	else trails.clearRestart()

	const steps = tourSteps(tour, seenAt)
	// recorded before the sequence starts, so watchers see the tour's own move
	useTourStore.setState({ index: at, steps })
	sim.playSequence(steps, at)
	if (jump) useSimStore.getState().finishMove()
	sim.select(stopSelection(stop))
}

export interface StartOptions {
	/** The stop to begin at (0-based). */
	startAt?: number
	/** Advance by itself after each stop's narration. */
	auto?: boolean
	/** Open on the stop without animation (a link). */
	jump?: boolean
}

/**
 * Starts `tour` (a `Tour` or the id of a menu tour) from `startAt`. The scene
 * as it is now becomes the tour's baseline. Unknown ids are ignored.
 */
export function startTour(
	tour: Tour | string,
	{ startAt = 0, auto = false, jump = false }: StartOptions = {},
): void {
	const resolved = typeof tour === "string" ? tourById.get(tour) : tour
	if (resolved === undefined || resolved.stops.length === 0) return
	const previous = useTourStore.getState()
	// one returning tour after another (event after event, #41) returns to where the first began
	const baseline =
		resolved.returnOnExit === true && previous.baseline?.scene !== undefined
			? previous.baseline
			: {
					...currentBaseline(),
					scene: resolved.returnOnExit === true ? currentScene() : undefined,
				}
	useTourStore.setState({
		tour: resolved,
		index: 0,
		steps: null,
		auto,
		baseline,
		collapsed: false,
	})
	enterStop(startAt, jump ? "jump" : "restore")
}

/** Goes to stop `index` of the running tour (restoring it); out-of-range indices are clamped. */
export function goToStop(index: number): void {
	enterStop(index, "restore")
}

/** The next stop; after the last one the tour ends. */
export function nextStop(): void {
	const { tour, index } = useTourStore.getState()
	if (tour === null) return
	if (index >= tour.stops.length - 1) {
		exitTour()
		return
	}
	enterStop(index + 1, "forward")
}

/** The previous stop (the first one stays). */
export function previousStop(): void {
	const { tour, index } = useTourStore.getState()
	if (tour === null) return
	enterStop(Math.max(0, index - 1), "restore")
}

/** Back to the current stop after looking around: the stop as the tour showed it. */
export function resumeTour(): void {
	const { tour, index } = useTourStore.getState()
	if (tour !== null) enterStop(index, "restore")
}

/** Autoplay on or off; the tour stays where it is. */
export function setTourAuto(auto: boolean): void {
	if (useTourStore.getState().auto !== auto) useTourStore.setState({ auto })
}

/**
 * Ends the tour; the scene stays as the last stop left it, to explore on. A
 * tour with `returnOnExit` (a sky event, #41) goes back to the view, time,
 * speed, scale and layers the viewer had before it began.
 */
export function exitTour(): void {
	const { tour, steps, baseline } = useTourStore.getState()
	const sim = useSimStore.getState()
	// going back to where a sky event began moves the camera: a step (#46)
	if (tour !== null && baseline?.scene !== undefined && isListedTour(tour.id)) {
		sim.markStep()
	}
	if (steps !== null && sim.sequence?.steps === steps) sim.stopSequence()
	useTourStore.setState({ tour: null, index: 0, steps: null, baseline: null })
	if (baseline?.scene !== undefined) restoreScene(baseline, baseline.scene)
}

/** The clock counts as showing the present within this many days of the wall clock (a minute). */
const NOW_TOLERANCE_DAYS = 1 / 1440

/** Where the viewer is now, for a tour that returns on exit. */
export function currentScene(
	sim: SimState = useSimStore.getState(),
	now: Date = new Date(),
): TourScene {
	return {
		view: sim.view,
		shot: sim.shot,
		frameId: sim.frameId,
		selectedId: sim.selectedId,
		jd: sim.simTimeJD,
		atNow:
			!sim.paused &&
			sim.timeWarp === 1 &&
			Math.abs(sim.simTimeJD - dateToJD(now)) < NOW_TOLERANCE_DAYS,
	}
}

/** Back to `scene` and the settings of `baseline`, through the store actions: animated, like any move. */
function restoreScene(baseline: TourBaseline, scene: TourScene): void {
	const scaleStore = useScaleStore.getState()
	if (baseline.scale !== null && scaleStore.targetId !== baseline.scale) {
		scaleStore.switchTo(baseline.scale, performance.now())
	}
	const sim = useSimStore.getState()
	for (const key of Object.keys(TOUR_LAYER_FIELDS) as TourLayerKey[]) {
		const field = TOUR_LAYER_FIELDS[key]
		if (sim[field] !== baseline.layers[key]) {
			sim[LAYER_SETTERS[field]](baseline.layers[key])
		}
	}
	if (scene.atNow) {
		sim.setTimeWarp(1)
		sim.setPaused(false)
		sim.setNow()
	} else {
		sim.setTimeWarp(baseline.warp)
		sim.setPaused(baseline.paused)
		sim.travelTo(scene.jd)
	}
	const request = {
		shot:
			scene.shot ?? (scene.view.kind === "overview" ? HOME_SHOT : undefined),
		// from one body to another: the flight (#18)
		profile:
			scene.view.kind === "body" && sim.view.kind === "body"
				? FLIGHT_PROFILE
				: undefined,
	}
	if (scene.frameId !== OVERVIEW_BODY_ID)
		sim.anchorFrame(scene.frameId, request)
	else if (sim.frameId !== OVERVIEW_BODY_ID) sim.releaseFrame(request)
	if (scene.frameId === OVERVIEW_BODY_ID) sim.goTo(scene.view, request)
	sim.select(scene.selectedId)
}

/**
 * Where the tour stands:
 * - `playing`: the camera is on the tour (moving to a stop, or at it);
 * - `exploring`: the visitor went off to look at something else, and the stop can be resumed;
 * - `left`: the camera sequence was ended (Escape, the home button, another sequence);
 * - null: no tour.
 */
export type TourStatus = "playing" | "exploring" | "left"

export function tourStatus(
	sequence: Sequence | null,
	tour: Pick<TourState, "tour" | "steps">,
): TourStatus | null {
	if (tour.tour === null) return null
	if (
		sequence === null ||
		tour.steps === null ||
		sequence.steps !== tour.steps
	) {
		return "left"
	}
	return sequence.phase === "interrupted" ? "exploring" : "playing"
}

/**
 * Keeps the tour in step when something else moved its sequence (a
 * `nextStep()` from a keyboard shortcut of another feature, say): the stop the
 * camera is heading to gets its scene too. Returns the unsubscribe function.
 */
export function followSequence(): () => void {
	return useSimStore.subscribe((state, previous) => {
		if (state.sequence === previous.sequence) return
		const { tour, steps, index } = useTourStore.getState()
		const sequence = state.sequence
		if (tour === null || sequence === null || sequence.steps !== steps) return
		if (sequence.index !== index) {
			enterStop(
				sequence.index,
				sequence.index === index + 1 ? "forward" : "restore",
			)
		}
	})
}
