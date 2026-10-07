/**
 * Selection and the camera navigation model (docs/ARCHITECTURE.md, "Navigation").
 *
 * This slice of the simulation store is the only way feature code moves the
 * camera: it asks for a *view* (the whole system, a body, a point in space)
 * and the camera rig (`features/solarSystem/camera/director.ts`, the single
 * owner of the camera) gets it there. Nothing here knows about three.js; the
 * state is plain data, so every transition can be driven and tested without a
 * canvas.
 *
 * View states: `overview` (the whole system, Sun-centred), `focused` (a body
 * framed and tracked), `free` (the pivot is a point in space, anchored to a
 * body so it keeps its place in that body's neighbourhood; the user gets
 * there by panning, #15), and `transit`
 * (a transition toward one of those is running). Every request starts from
 * wherever the camera is at that moment, so a second request, a reset or a
 * skip in the middle of a transition retargets instead of snapping back.
 *
 * Selection is separate app state: selecting a body never moves the camera by
 * itself (`setFocus` is the click gesture that does both).
 */
import { bodyById, sun } from "@/data"

import { FLIGHT_PROFILE } from "./flight"

/** A world-space offset in km, scene frame axes (see src/sim/kepler.ts). */
export type Vec3Km = readonly [number, number, number]

/** Where the camera looks: what its pivot (and the render origin) is attached to. */
export type View =
	| { readonly kind: "overview" }
	| { readonly kind: "body"; readonly id: string }
	| {
			readonly kind: "point"
			/**
			 * The body whose neighbourhood the point is in: the point moves
			 * with it, and the zoom limits and the name shown for the centre
			 * are its.
			 */
			readonly anchorId: string
			/**
			 * TRUE km from the anchor (scene axes). It is drawn through the
			 * scale engine like any non-body object near the anchor, so it
			 * keeps its place in the neighbourhood under every scale preset.
			 */
			readonly offsetKm: Vec3Km
	  }

export type ViewMode = "overview" | "focused" | "free" | "transit"

/**
 * The camera around a view's pivot. Angles are scale free; the distance is a
 * multiple of the view's default framing distance (6 rendered radii for a
 * body, the whole planetary system for the overview), so a shot survives scale
 * presets and different screen shapes.
 */
export interface CameraShot {
	/** Rotation about the ecliptic pole, degrees (camera-controls azimuth: 0 = scene +Z). */
	azimuthDeg: number
	/** Height above the ecliptic plane, degrees (-90..90). */
	elevationDeg: number
	/** Multiple of the view's default framing distance (> 0). */
	distance: number
}

/** Options of a view request. */
export interface ViewRequest {
	/**
	 * Camera on arrival. A missing direction keeps the current viewing
	 * direction, a missing distance frames the destination at 1x.
	 */
	shot?: Partial<CameraShot>
	/** 0 jumps; omitted, the camera rig derives it from the length of the move. */
	durationMs?: number
	/** A transit profile name (camera/profiles.ts); unknown names use the default. */
	profile?: string
	/**
	 * Frame a region on arrival instead of `shot.distance` (#31): a sphere of
	 * `km` TRUE km around the view's centre, drawn as a distance from body
	 * `around` is drawn at the active scale (`"sun"`: a distance between the
	 * planets; a planet: a distance in its moon system).
	 */
	fit?: FitRegion
	/**
	 * Stand the camera at this point and look at the view's centre from there
	 * (#41: the view from Earth). The director keeps the eye there while the
	 * bodies move, until the user takes the camera; overrides the shot.
	 */
	eye?: EyePoint
	/**
	 * Vertical field of view on arrival, degrees (#41: a telescope's narrow
	 * field); omitted: the normal lens. Any request without one goes back to it.
	 */
	lensDeg?: number
}

/**
 * Where a camera stands (#41): TRUE km from body `anchorId`, scene axes,
 * drawn through the scale engine like a point view (at true scale exactly
 * there), e.g. an observer on the Earth's surface.
 */
export interface EyePoint {
	readonly anchorId: string
	readonly offsetKm: Vec3Km
}

/** The narrowest and widest lens a request may ask for, degrees. */
export const LENS_MIN_DEG = 0.001
export const LENS_MAX_DEG = 160

/** A region the camera frames on arrival, see `ViewRequest.fit`. */
export interface FitRegion {
	readonly km: number
	readonly around: string
}

/** The transition the camera rig is executing (or about to start). */
export interface Transition {
	/** Unique per request; the rig starts a new move whenever it changes. */
	readonly id: number
	readonly view: View
	readonly shot: Partial<CameraShot> | null
	/** null: automatic (from the length of the move). 0: jump. */
	readonly durationMs: number | null
	readonly profile: string | null
	/** The region to frame on arrival (overrides the shot's distance), if any. */
	readonly fit: FitRegion | null
	/** Where the camera stands on arrival, if anywhere (#41). */
	readonly eye: EyePoint | null
	/** The lens on arrival, degrees; null: the normal one. */
	readonly lensDeg: number | null
	/**
	 * The user grabbed the camera mid-transition: the rig stops scripting the
	 * distance and direction (the user owns them from the current pose) while
	 * the pivot still glides to `view`, so nobody is stranded between bodies.
	 */
	readonly handedOver: boolean
}

/** One stop of a scripted camera sequence (tours, the opening sequence, fly-throughs). */
export interface SequenceStep extends ViewRequest {
	view: View
	/**
	 * Time to stay after arriving before moving on, ms. Omitted: wait for
	 * `nextStep()` (manual advance, e.g. a teacher presenting).
	 */
	holdMs?: number
}

export type SequencePhase =
	/** travelling to `steps[index]` */
	| "moving"
	/** arrived, auto-advancing at `holdUntil` */
	| "holding"
	/** arrived, waiting for `nextStep()` */
	| "waiting"
	/** the user took over or asked for another view; `resumeSequence()` flies back to the stop */
	| "interrupted"

export interface Sequence {
	readonly steps: readonly SequenceStep[]
	readonly index: number
	readonly phase: SequencePhase
	/** `performance.now()` time the hold of a "holding" step ends. */
	readonly holdUntil: number | null
	/** The transition that carries the current step. */
	readonly transitionId: number
}

export interface NavigationSlice {
	/** The selected body (drives info panels, labels, the URL); never moves the camera by itself. */
	selectedId: string | null
	/** The view the camera is in, or heading to while `transition` is set. */
	view: View
	/**
	 * The body the view is centred on: the Sun in the overview, the body when
	 * focused, the anchor of a point. The render origin, the moon family rule
	 * and the "always show the focus" rule follow it.
	 */
	focusId: string
	/**
	 * The body the reference frame is anchored to (#31): the Sun (the overview's
	 * body) for the Sun-centred frame, the default; otherwise a body held still
	 * while everything else moves around it. It is always either the Sun or
	 * `focusId`: an anchored frame follows the focus (centring another body
	 * holds that one still), and the overview or `reset()` return to the Sun.
	 */
	frameId: string
	/** The camera around `view` as it last came to rest (published by the camera rig), or null while unknown. */
	shot: CameraShot | null
	transition: Transition | null
	sequence: Sequence | null
	/**
	 * The user is moving the pivot itself right now (a pan gesture or its
	 * damping, until it comes to rest). The centre marker shows meanwhile.
	 */
	panning: boolean
	/**
	 * Counts the steps (#46): changes of what is in view that Back can undo.
	 * Bumped by `markStep()` before the step changes anything; the view
	 * history (`./viewHistory.ts`) then keeps the view being left and the
	 * address gets a new history entry. Camera gestures, time, layers and the
	 * scale never bump it.
	 */
	step: number

	/**
	 * Marks the start of a step (#46): call it before the changes that make
	 * one (choosing a body or spacecraft, the way out, a tour stop, a
	 * milestone, a hunt's "Show me"); everything that changes in the same task
	 * belongs to it. `setFocus`, `anchorFrame` and `releaseFrame` mark
	 * themselves.
	 */
	markStep: () => void
	/** Selects a body (unknown ids are ignored) or clears the selection. The camera stays where it is. */
	select: (id: string | null) => void
	/**
	 * The click gesture: select the body and focus it; from another body (or a
	 * point near one) the move is the flight of #18 (`FLIGHT_PROFILE`). A no-op
	 * for unknown ids or the current focus. A step (#46).
	 */
	setFocus: (id: string) => void
	/** Frame and track a body; unknown ids are ignored. */
	focus: (id: string, request?: ViewRequest) => void
	/** The whole system from the home direction (unless the request says otherwise). */
	overview: (request?: ViewRequest) => void
	/** Any view; invalid views (unknown bodies, non-finite offsets) are ignored. */
	goTo: (view: View, request?: ViewRequest) => void
	/** `goTo` without animation. */
	jumpTo: (view: View, shot?: Partial<CameraShot> | null) => void
	/**
	 * The way out, from any state: stops any sequence, clears the selection and
	 * returns to the overview. The camera rig jumps instead of animating when
	 * the camera state is broken.
	 */
	reset: () => void
	/** Finishes the running transition (or the whole sequence) at once. */
	skip: () => void
	/**
	 * Finishes the running transition at once but stays in a running sequence,
	 * whose stop then holds or waits as usual (the flight readout's Skip, #18).
	 */
	finishMove: () => void
	/**
	 * Holds body `id` still (#31): anchors the reference frame to it and
	 * centres the view on it (a request may set the camera and a region to
	 * fit). Unknown ids are ignored; the Sun releases the frame (`releaseFrame`).
	 * A step (#46).
	 */
	anchorFrame: (id: string, request?: ViewRequest) => void
	/** Back to the Sun-centred frame: the overview, keeping the selection. A step (#46). */
	releaseFrame: (request?: ViewRequest) => void

	/** Camera rig: the transition `id` arrived. Stale ids are ignored. */
	settle: (id: number, now?: number) => void
	/** Camera rig: the user moved the camera (drag, wheel, pinch). */
	userInput: () => void
	/** Camera rig: the camera came to rest here (rounded to URL precision; equal shots are ignored). */
	publishShot: (shot: CameraShot) => void
	/** Camera rig: the user moved the pivot itself (pan); the camera is already there, so no transition. */
	settleAt: (view: View) => void
	/** Camera rig: a pan started (true) or came to rest (false). */
	setPanning: (panning: boolean) => void

	/** Plays a scripted sequence from `startAt` (default 0); empty or invalid sequences are ignored. */
	playSequence: (steps: readonly SequenceStep[], startAt?: number) => void
	/** Jumps the sequence to step `index` (flying there); past the end finishes it. */
	goToStep: (index: number) => void
	nextStep: () => void
	/** After an interruption: flies back to the current stop and carries on. */
	resumeSequence: () => void
	stopSequence: () => void
	/** Camera rig, every frame while a step is holding: advances once the hold is over. */
	tickSequence: (now: number) => void
}

export const OVERVIEW: View = { kind: "overview" }
/** The body at the centre of the overview. */
export const OVERVIEW_BODY_ID = sun.id
/** The overview's camera, and the camera of a deep link without `cam`. */
export const HOME_SHOT: CameraShot = {
	azimuthDeg: 0,
	elevationDeg: 45,
	distance: 1,
}
export const MAX_ELEVATION_DEG = 89.9

/** The view states of the issue: overview, focused, free (a point in space), or in transit. */
export const viewMode = (
	state: Pick<NavigationSlice, "view" | "transition">,
): ViewMode => {
	if (state.transition !== null) return "transit"
	switch (state.view.kind) {
		case "overview":
			return "overview"
		case "body":
			return "focused"
		case "point":
			return "free"
	}
}

/** The body a view is centred on (the Sun for the overview, the anchor of a point). */
export const viewBodyId = (view: View): string => {
	switch (view.kind) {
		case "overview":
			return OVERVIEW_BODY_ID
		case "body":
			return view.id
		case "point":
			return view.anchorId
	}
}

/** True while the reference frame is anchored to a body other than the Sun (#31). */
export const isFrameAnchored = (state: Pick<NavigationSlice, "frameId">) =>
	state.frameId !== OVERVIEW_BODY_ID

/**
 * The frame a view gets (#31): the Sun-centred frame stays Sun-centred; an
 * anchored frame follows the view's centre, and the overview releases it.
 */
export const frameForView = (frameId: string, view: View): string =>
	frameId === OVERVIEW_BODY_ID || view.kind === "overview"
		? OVERVIEW_BODY_ID
		: viewBodyId(view)

const sanitizeFit = (fit: FitRegion | undefined): FitRegion | null =>
	fit !== undefined &&
	Number.isFinite(fit.km) &&
	fit.km > 0 &&
	bodyById.has(fit.around)
		? { km: fit.km, around: fit.around }
		: null

export const isValidView = (view: View): boolean => {
	switch (view.kind) {
		case "overview":
			return true
		case "body":
			return bodyById.has(view.id)
		case "point":
			return (
				bodyById.has(view.anchorId) &&
				view.offsetKm.length === 3 &&
				view.offsetKm.every(Number.isFinite)
			)
		default:
			return false
	}
}

export const sameView = (a: View, b: View): boolean => {
	if (a.kind === "overview" || b.kind === "overview") return a.kind === b.kind
	if (a.kind === "body" || b.kind === "body") {
		return a.kind === "body" && b.kind === "body" && a.id === b.id
	}
	return (
		a.anchorId === b.anchorId &&
		a.offsetKm[0] === b.offsetKm[0] &&
		a.offsetKm[1] === b.offsetKm[1] &&
		a.offsetKm[2] === b.offsetKm[2]
	)
}

const sanitizeEye = (eye: EyePoint | undefined): EyePoint | null =>
	eye !== undefined &&
	bodyById.has(eye.anchorId) &&
	eye.offsetKm.length === 3 &&
	eye.offsetKm.every(Number.isFinite)
		? { anchorId: eye.anchorId, offsetKm: [...eye.offsetKm] }
		: null

const sanitizeLens = (lensDeg: number | undefined): number | null =>
	lensDeg !== undefined && Number.isFinite(lensDeg)
		? Math.max(LENS_MIN_DEG, Math.min(LENS_MAX_DEG, lensDeg))
		: null

/** Keeps only the usable fields of a requested shot (finite angles, a positive finite distance). */
export function sanitizeShot(
	shot: Partial<CameraShot> | null | undefined,
): Partial<CameraShot> | null {
	if (shot === null || shot === undefined) return null
	const out: Partial<CameraShot> = {}
	if (Number.isFinite(shot.azimuthDeg)) out.azimuthDeg = shot.azimuthDeg
	if (Number.isFinite(shot.elevationDeg)) {
		out.elevationDeg = Math.max(
			-MAX_ELEVATION_DEG,
			Math.min(MAX_ELEVATION_DEG, shot.elevationDeg as number),
		)
	}
	if (Number.isFinite(shot.distance) && (shot.distance as number) > 0) {
		out.distance = shot.distance
	}
	return Object.keys(out).length === 0 ? null : out
}

export const isCompleteShot = (
	shot: Partial<CameraShot> | null,
): shot is CameraShot =>
	shot !== null &&
	shot.azimuthDeg !== undefined &&
	shot.elevationDeg !== undefined &&
	shot.distance !== undefined

/** Azimuth in (-180, 180]. */
const normalizeDeg = (deg: number): number => {
	const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180
	return wrapped === -180 ? 180 : wrapped
}

/** Three significant digits, never in exponent notation for the distances a camera can have. */
const roundDistance = (distance: number): number =>
	Number(distance.toPrecision(3))

/** A shot at the precision the URL carries: angles to 0.1 degree, the distance to 3 significant digits. */
export const roundShot = (shot: CameraShot): CameraShot => ({
	azimuthDeg: Math.round(normalizeDeg(shot.azimuthDeg) * 10) / 10 || 0,
	elevationDeg: Math.round(shot.elevationDeg * 10) / 10 || 0,
	distance: roundDistance(shot.distance),
})

export const sameShot = (a: CameraShot | null, b: CameraShot | null): boolean =>
	a === b ||
	(a !== null &&
		b !== null &&
		a.azimuthDeg === b.azimuthDeg &&
		a.elevationDeg === b.elevationDeg &&
		a.distance === b.distance)

/** URL form of a shot, `az_el_distance` (e.g. `-30_20_2.5`): short, and nothing in it needs escaping. */
export const formatShot = (shot: CameraShot): string => {
	const { azimuthDeg, elevationDeg, distance } = roundShot(shot)
	return `${azimuthDeg}_${elevationDeg}_${distance}`
}

/** Parses `formatShot` output; anything malformed is null (ignored, never an error). */
export function parseShot(text: string | undefined): CameraShot | null {
	if (text === undefined) return null
	const parts = text.split("_")
	if (parts.length !== 3 || parts.some((part) => part.trim() === "")) {
		return null
	}
	const [azimuthDeg, elevationDeg, distance] = parts.map(Number)
	const shot = sanitizeShot({ azimuthDeg, elevationDeg, distance })
	return isCompleteShot(shot) ? roundShot(shot) : null
}

/** `value` with at most `decimals` decimals, never in exponent notation and never "-0". */
const plainNumber = (value: number, decimals: number): string => {
	let text = value.toFixed(decimals)
	if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "")
	return text === "-0" ? "0" : text
}

/** Significant digits of a point's offset in the URL: about 1/10000 of its distance from the anchor. */
const OFFSET_DIGITS = 4

/**
 * URL form of a point's offset (#15), `x_y_z` in TRUE radii of its anchor
 * (e.g. `-12.5_0.03_215` from the Sun): short, free of the scale preset, and
 * nothing in it needs escaping. All three components are rounded to the
 * same absolute step, 4 significant digits of the largest one.
 */
export function formatOffset(offsetKm: Vec3Km, anchorRadiusKm: number): string {
	const radii = offsetKm.map((km) => km / anchorRadiusKm)
	const largest = Math.max(...radii.map(Math.abs))
	if (!(largest > 0) || !Number.isFinite(largest)) return "0_0_0"
	const step = 10 ** (Math.floor(Math.log10(largest)) - (OFFSET_DIGITS - 1))
	const decimals = Math.max(0, -Math.floor(Math.log10(step)))
	return radii
		.map((r) => plainNumber(Math.round(r / step) * step, decimals))
		.join("_")
}

/** Parses `formatOffset` output back into km; anything malformed is null (ignored, never an error). */
export function parseOffset(
	text: string | undefined,
	anchorRadiusKm: number,
): Vec3Km | null {
	if (text === undefined) return null
	const parts = text.split("_")
	if (parts.length !== 3 || parts.some((part) => part.trim() === "")) {
		return null
	}
	const radii = parts.map(Number)
	if (!radii.every(Number.isFinite)) return null
	return [
		radii[0] * anchorRadiusKm,
		radii[1] * anchorRadiusKm,
		radii[2] * anchorRadiusKm,
	]
}

/** The request a transition was made from (to finish it at once). */
const movedRequest = (transition: Transition): ViewRequest => ({
	shot: transition.shot ?? undefined,
	fit: transition.fit ?? undefined,
	eye: transition.eye ?? undefined,
	lensDeg: transition.lensDeg ?? undefined,
})

// Transition ids only need to be unique; a module counter survives store resets in tests.
let transitionCounter = 0

type SetNavigation = (partial: Partial<NavigationSlice>) => void
type GetNavigation = () => NavigationSlice

/**
 * The navigation slice. `set` and `get` may belong to a bigger store (the
 * simulation store composes it); the slice only touches its own fields.
 */
export function createNavigationSlice(
	set: SetNavigation,
	get: GetNavigation,
): NavigationSlice {
	/** Starts a transition; returns its id. The view must already be valid. */
	const start = (
		view: View,
		request: ViewRequest | undefined,
		extra: Partial<NavigationSlice> = {},
	): number => {
		const id = ++transitionCounter
		const duration = request?.durationMs
		const shot = sanitizeShot(request?.shot)
		set({
			frameId: frameForView(extra.frameId ?? get().frameId, view),
			...extra,
			view,
			focusId: viewBodyId(view),
			// a complete shot is where the camera will be; otherwise unknown until it arrives
			shot: isCompleteShot(shot) ? roundShot(shot) : null,
			transition: {
				id,
				view,
				shot,
				durationMs:
					duration !== undefined && Number.isFinite(duration)
						? Math.max(0, duration)
						: null,
				profile: request?.profile ?? null,
				fit: sanitizeFit(request?.fit),
				eye: sanitizeEye(request?.eye),
				lensDeg: sanitizeLens(request?.lensDeg),
				handedOver: false,
			},
		})
		return id
	}

	/** A request from outside the running sequence interrupts it (it can be resumed). */
	const interruptSequence = (): Partial<NavigationSlice> => {
		const { sequence } = get()
		if (sequence === null || sequence.phase === "interrupted") return {}
		return { sequence: { ...sequence, phase: "interrupted", holdUntil: null } }
	}

	const playStep = (steps: readonly SequenceStep[], index: number): void => {
		const step = steps[index]
		const id = start(step.view, step)
		set({
			sequence: {
				steps,
				index,
				phase: "moving",
				holdUntil: null,
				transitionId: id,
			},
		})
	}

	return {
		selectedId: null,
		view: OVERVIEW,
		focusId: OVERVIEW_BODY_ID,
		frameId: OVERVIEW_BODY_ID,
		shot: null,
		transition: null,
		sequence: null,
		panning: false,
		step: 0,

		markStep: () => set({ step: get().step + 1 }),
		select: (id) => {
			if (id !== null && !bodyById.has(id)) return
			if (get().selectedId !== id) set({ selectedId: id })
		},
		setFocus: (id) => {
			if (!bodyById.has(id)) return
			get().markStep()
			const { view, select, focus } = get()
			select(id)
			if (view.kind === "body" && view.id === id) return
			// from one body (or its neighbourhood) to another: the flight of #18
			const trip = view.kind !== "overview" && viewBodyId(view) !== id
			focus(id, trip ? { profile: FLIGHT_PROFILE } : undefined)
		},
		focus: (id, request) => get().goTo({ kind: "body", id }, request),
		overview: (request) =>
			get().goTo(OVERVIEW, {
				...request,
				shot: { ...HOME_SHOT, ...request?.shot },
			}),
		goTo: (view, request) => {
			if (!isValidView(view)) return
			start(view, request, interruptSequence())
		},
		jumpTo: (view, shot) => {
			if (!isValidView(view)) return
			start(
				view,
				{ shot: shot ?? undefined, durationMs: 0 },
				interruptSequence(),
			)
		},
		reset: () => {
			start(
				OVERVIEW,
				{ shot: HOME_SHOT },
				{ selectedId: null, sequence: null, frameId: OVERVIEW_BODY_ID },
			)
		},
		anchorFrame: (id, request) => {
			if (!bodyById.has(id)) return
			get().markStep()
			if (id === OVERVIEW_BODY_ID) {
				get().releaseFrame(request)
				return
			}
			const { view } = get()
			// a free centre already held with this body stays where it is
			const target: View =
				view.kind === "point" && view.anchorId === id
					? view
					: { kind: "body", id }
			start(target, request, { ...interruptSequence(), frameId: id })
		},
		releaseFrame: (request) => {
			get().markStep()
			start(
				OVERVIEW,
				{ ...request, shot: { ...HOME_SHOT, ...request?.shot } },
				{ ...interruptSequence(), frameId: OVERVIEW_BODY_ID },
			)
		},
		skip: () => {
			const { sequence, transition } = get()
			if (sequence !== null) {
				const last = sequence.steps[sequence.steps.length - 1]
				start(last.view, { ...last, durationMs: 0 }, { sequence: null })
				return
			}
			if (transition === null) return
			start(transition.view, { ...movedRequest(transition), durationMs: 0 })
		},

		finishMove: () => {
			const { transition, sequence } = get()
			if (transition === null) return
			const id = start(transition.view, {
				...movedRequest(transition),
				durationMs: 0,
			})
			if (sequence?.transitionId === transition.id) {
				set({ sequence: { ...sequence, transitionId: id } })
			}
		},

		settle: (id, now = performance.now()) => {
			const { transition, sequence } = get()
			if (transition === null || transition.id !== id) return
			if (
				sequence === null ||
				sequence.transitionId !== id ||
				sequence.phase !== "moving"
			) {
				set({ transition: null })
				return
			}
			const holdMs = sequence.steps[sequence.index].holdMs
			const hold = holdMs !== undefined && Number.isFinite(holdMs)
			set({
				transition: null,
				sequence: {
					...sequence,
					phase: hold ? "holding" : "waiting",
					holdUntil: hold ? now + Math.max(0, holdMs) : null,
				},
			})
		},
		userInput: () => {
			const { transition, sequence } = get()
			const next: Partial<NavigationSlice> = {}
			if (transition !== null && !transition.handedOver) {
				next.transition = { ...transition, handedOver: true }
			}
			// looking around while a stop waits for the presenter is part of the lesson;
			// only an automatic advance (moving, holding) is interrupted
			if (
				sequence !== null &&
				(sequence.phase === "moving" || sequence.phase === "holding")
			) {
				next.sequence = { ...sequence, phase: "interrupted", holdUntil: null }
			}
			if (Object.keys(next).length > 0) set(next)
		},
		publishShot: (shot) => {
			const sane = sanitizeShot(shot)
			if (!isCompleteShot(sane)) return
			const rounded = roundShot(sane)
			if (!sameShot(rounded, get().shot)) set({ shot: rounded })
		},
		settleAt: (view) => {
			if (!isValidView(view) || get().transition !== null) return
			if (sameView(view, get().view)) return
			set({
				view,
				focusId: viewBodyId(view),
				frameId: frameForView(get().frameId, view),
			})
		},
		setPanning: (panning) => {
			if (get().panning !== panning) set({ panning })
		},

		playSequence: (steps, startAt = 0) => {
			if (
				steps.length === 0 ||
				!steps.every((step) => isValidView(step.view))
			) {
				return
			}
			const index = Math.max(0, Math.min(steps.length - 1, Math.trunc(startAt)))
			playStep(steps, Number.isFinite(index) ? index : 0)
		},
		goToStep: (index) => {
			const { sequence } = get()
			if (sequence === null || !Number.isFinite(index)) return
			if (index >= sequence.steps.length) {
				set({ sequence: null })
				return
			}
			playStep(sequence.steps, Math.max(0, Math.trunc(index)))
		},
		nextStep: () => {
			const { sequence, goToStep } = get()
			if (sequence !== null) goToStep(sequence.index + 1)
		},
		resumeSequence: () => {
			const { sequence } = get()
			if (sequence === null || sequence.phase !== "interrupted") return
			playStep(sequence.steps, sequence.index)
		},
		stopSequence: () => {
			if (get().sequence !== null) set({ sequence: null })
		},
		tickSequence: (now) => {
			const { sequence, goToStep } = get()
			if (
				sequence === null ||
				sequence.phase !== "holding" ||
				sequence.holdUntil === null ||
				now < sequence.holdUntil
			) {
				return
			}
			goToStep(sequence.index + 1)
		},
	}
}
