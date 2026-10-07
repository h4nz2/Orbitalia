/**
 * What a tour stop means for the scene (#28), as pure functions of the tour
 * data: the camera step it becomes in the navigation model's sequence, the
 * scale, speed, layers and date in force at a stop, and how long autoplay
 * stays. The player (`player.ts`) applies the result through the stores.
 *
 * Settings carry forward: a stop's scale, speed and layer switches hold until
 * a later stop changes them, and anything no stop has set yet is what the scene
 * had before the tour (`TourBaseline`). So any stop can be entered on its own
 * (going back, a deep link, coming back after looking around) and looks the
 * same as when the tour reached it in order. The body held still and the
 * selection belong to their stop alone; a date is travelled to when a stop
 * sets one, and restored from the latest one when a stop is re-entered.
 */
import { bodies, bodyById, type Body } from "@/data"
import { spacecraftById } from "@/data/spacecraft"
import type { Tour, TourSpeed, TourStop, TourTime } from "@/data/tours"
import { AU_KM, dateToJD, isScalePresetId, type ScalePresetId } from "@/sim"
import { truePositionAt } from "@/sim/light"
import { FLIGHT_PROFILE } from "@/store/flight"
import {
	HOME_SHOT,
	OVERVIEW,
	OVERVIEW_BODY_ID,
	followedCraftId,
	type CameraShot,
	type SequenceStep,
	type View,
	type ViewRequest,
} from "@/store/navigation"
import { WARP_PRESETS } from "@/store/sim"
import {
	TOUR_LAYER_FIELDS,
	type TourBaseline,
	type TourLayerKey,
} from "@/store/tour"

import { skyEventById } from "@/data/skyEvents"

import { eventJDById, observerKm } from "../events/instant"
import { MOMENTS, momentJD } from "../ui/moments"
import { arrivalJD } from "../ui/timeTravel"

/** Simulated seconds per real second of each named speed (the #14 presets); null: paused. */
export const SPEED_WARP: Readonly<Record<TourSpeed, number | null>> = {
	paused: null,
	realTime: WARP_PRESETS[0],
	minute: WARP_PRESETS[1],
	hour: WARP_PRESETS[2],
	day: WARP_PRESETS[3],
	week: WARP_PRESETS[4],
	month: WARP_PRESETS[5],
	year: WARP_PRESETS[6],
	decade: WARP_PRESETS[7],
}

/** Degrees between the Sun's direction and the camera's, seen from the body, per `camera.light`. */
export const LIGHT_ANGLE_DEG = {
	full: 20,
	/** the default: mostly lit, with the terminator in view so the body looks round */
	gibbous: 50,
	half: 90,
	crescent: 145,
} as const

/** Height of the camera above the planets' plane at a body stop that does not say. */
export const DEFAULT_ELEVATION_DEG = 15

const RAD = 180 / Math.PI

/**
 * The view a stop shows: a spacecraft followed (#57, its `follow`), the
 * overview, or a known body (unknown ids: the overview).
 */
export function stopView(stop: Pick<TourStop, "view" | "follow">): View {
	if (stop.follow !== undefined && spacecraftById.has(stop.follow)) {
		return {
			kind: "craft",
			id: stop.follow,
			anchorId: bodyById.has(stop.view) ? stop.view : OVERVIEW_BODY_ID,
		}
	}
	return stop.view !== "overview" && bodyById.has(stop.view)
		? { kind: "body", id: stop.view }
		: OVERVIEW
}

/** The spacecraft a stop follows (#57), if any. */
export const stopCraft = (
	stop: Pick<TourStop, "view" | "follow">,
): string | null => followedCraftId(stopView(stop))

/** The body a stop is centred on (the Sun for the overview). */
export const stopBodyId = (stop: Pick<TourStop, "view">): string => {
	const view = stopView(stop)
	return view.kind === "body" ? view.id : OVERVIEW_BODY_ID
}

/** The body a stop holds still: its `frame` when that is the body in view, else the Sun (Sun-centred). */
export function stopFrame(stop: Pick<TourStop, "view" | "frame">): string {
	const body = stopBodyId(stop)
	return stop.frame !== undefined && stop.frame === body
		? body
		: OVERVIEW_BODY_ID
}

/** The body a stop selects: its `select` (null: nothing), else the body in view (nothing in the overview). */
export function stopSelection(
	stop: Pick<TourStop, "view" | "select" | "follow">,
): string | null {
	if (stop.select === null) return null
	if (stop.select !== undefined) {
		return bodyById.has(stop.select) ? stop.select : null
	}
	const view = stopView(stop)
	return view.kind === "body" ? view.id : null
}

const positionScratch = new Float64Array(3)
const bodyIndex: ReadonlyMap<string, number> = new Map(
	bodies.map((body: Body, i) => [body.id, i]),
)

/**
 * Camera azimuth (degrees, camera-controls: 0 = scene +Z) that sees body `id`
 * lit as asked at `jd`: the direction of the Sun from the body, turned by
 * `angleDeg`. Null for the Sun itself or an unknown body. Directions from a
 * body to its parent's parent are true in every scale preset, so the light
 * on screen matches.
 */
export function sunlitAzimuthDeg(
	id: string,
	jd: number,
	angleDeg: number,
): number | null {
	const i = bodyIndex.get(id)
	if (i === undefined || id === OVERVIEW_BODY_ID) return null
	const p = truePositionAt(bodies, bodyIndex, i, jd, positionScratch)
	// the Sun sits at the origin: its direction from the body is -p (x, z in the plane)
	const toSun = Math.atan2(-p[0], -p[2]) * RAD
	const azimuth = toSun + angleDeg
	return ((((azimuth + 180) % 360) + 360) % 360) - 180
}

/** The move to a stop: its `move`, else a flight from one body to another, else a glide. */
function stopMove(tour: Tour, index: number): TourStop["move"] {
	const stop = tour.stops[index]
	if (stop.move !== undefined) return stop.move
	const previous = index > 0 ? tour.stops[index - 1] : undefined
	const view = stopView(stop)
	if (
		previous !== undefined &&
		view.kind === "body" &&
		stopView(previous).kind === "body" &&
		stopBodyId(previous) !== view.id
	) {
		return "fly"
	}
	return "glide"
}

/**
 * The camera request of stop `index`: its view, the camera (the lighting
 * turned into an azimuth for `jd`, the date the stop is seen at), the region
 * to fit, and the move that gets there.
 */
export function stopStep(tour: Tour, index: number, jd: number): SequenceStep {
	const stop = tour.stops[index]
	const view = stopView(stop)
	const camera = stop.camera ?? {}
	const shot: Partial<CameraShot> = {}
	if (view.kind === "overview") Object.assign(shot, HOME_SHOT)
	else shot.elevationDeg = DEFAULT_ELEVATION_DEG
	if (camera.elevation !== undefined) shot.elevationDeg = camera.elevation
	if (camera.distance !== undefined) shot.distance = camera.distance
	if (camera.azimuth !== undefined) {
		shot.azimuthDeg = camera.azimuth
	} else if (view.kind === "body") {
		const azimuth = sunlitAzimuthDeg(
			view.id,
			jd,
			LIGHT_ANGLE_DEG[camera.light ?? "gibbous"],
		)
		if (azimuth !== null) shot.azimuthDeg = azimuth
	}
	const request: ViewRequest = { shot }
	if (stop.fit !== undefined) {
		const around =
			stop.fit.around ??
			(stop.fit.au !== undefined ? OVERVIEW_BODY_ID : stopBodyId(stop))
		const km = stop.fit.au !== undefined ? stop.fit.au * AU_KM : stop.fit.km
		if (km !== undefined) request.fit = { km, around }
	}
	if (camera.fov !== undefined) request.lensDeg = camera.fov
	if (camera.from === "earth" && view.kind === "body") {
		// stand on the Earth (#41): at a sky event, where it is seen best
		const event = stopEvent(tour, index)
		request.eye = {
			anchorId: "earth",
			offsetKm: observerKm(
				view.id,
				event === undefined ? jd : (eventJDById(event.id) ?? jd),
				event,
			),
		}
	}
	const move = stopMove(tour, index)
	if (move === "fly") request.profile = FLIGHT_PROFILE
	if (move === "jump") request.durationMs = 0
	return { ...request, view }
}

/** The sky event (#41) whose time is in force at stop `index`, if any. */
function stopEvent(tour: Tour, index: number) {
	for (let i = Math.min(index, tour.stops.length - 1); i >= 0; i--) {
		const time = tour.stops[i].time
		if (time === undefined) continue
		return typeof time === "object" && "event" in time
			? skyEventById.get(time.event)
			: undefined
	}
	return undefined
}

/** The camera steps of every stop, seen at `jd`. */
export const tourSteps = (tour: Tour, jd: number): SequenceStep[] =>
	tour.stops.map((_, i) => stopStep(tour, i, jd))

/** The Julian Date a stop's `time` travels to; null for an unknown moment. */
export function timeJD(time: TourTime, now: Date = new Date()): number | null {
	if (time === "now") return dateToJD(now)
	if ("event" in time) return eventJDById(time.event)
	if ("moment" in time) {
		const moment = MOMENTS.find((m) => m.id === time.moment)
		return moment === undefined ? null : momentJD(moment)
	}
	return arrivalJD(time.date)
}

/** What is in force at a stop: its own settings plus everything carried from earlier stops and the baseline. */
export interface StopSettings {
	scale: ScalePresetId | null
	/** Simulated seconds per real second while playing (kept while paused). */
	warp: number
	paused: boolean
	layers: Record<TourLayerKey, boolean>
	/** The latest date set at or before the stop, and the stop that set it. */
	time: { time: TourTime; index: number } | null
}

export function stopSettings(
	tour: Tour,
	index: number,
	baseline: TourBaseline,
): StopSettings {
	const settings: StopSettings = {
		scale: baseline.scale,
		warp: baseline.warp,
		paused: baseline.paused,
		layers: { ...baseline.layers },
		time: null,
	}
	const last = Math.max(0, Math.min(tour.stops.length - 1, index))
	for (let i = 0; i <= last; i++) {
		const stop = tour.stops[i]
		if (isScalePresetId(stop.scale)) settings.scale = stop.scale
		if (stop.speed !== undefined) {
			const warp = SPEED_WARP[stop.speed]
			settings.paused = warp === null
			if (warp !== null) settings.warp = warp
		}
		for (const key of Object.keys(TOUR_LAYER_FIELDS) as TourLayerKey[]) {
			const value = stop.layers?.[key]
			if (value !== undefined) settings.layers[key] = value
		}
		if (stop.time !== undefined) settings.time = { time: stop.time, index: i }
	}
	return settings
}

/** Reading speed autoplay allows for: about 180 words a minute, read aloud to a class. */
export const AUTO_MS_PER_WORD = 330
/** Time to look at the scene besides reading. */
export const AUTO_LOOK_MS = 3000
export const AUTO_MIN_MS = 7000
export const AUTO_MAX_MS = 40_000

/**
 * How long autoplay stays at a stop after arriving: the stop's `autoSeconds`,
 * else long enough to read `narration` aloud and look at the scene.
 */
export function autoHoldMs(
	stop: Pick<TourStop, "autoSeconds">,
	narration: string,
): number {
	if (stop.autoSeconds !== undefined) return stop.autoSeconds * 1000
	const words = narration.split(/\s+/).filter(Boolean).length
	return Math.min(
		AUTO_MAX_MS,
		Math.max(AUTO_MIN_MS, words * AUTO_MS_PER_WORD + AUTO_LOOK_MS),
	)
}

/** Rough length of a whole tour at autoplay pace (moves included), ms. */
export function tourDurationMs(
	tour: Tour,
	narration: (stop: TourStop) => string,
): number {
	const MOVE_MS = 3500
	return tour.stops.reduce(
		(total, stop) => total + MOVE_MS + autoHoldMs(stop, narration(stop)),
		0,
	)
}
