/**
 * The camera director: the one owner of the camera (docs/ARCHITECTURE.md,
 * "Navigation"). Feature code asks the navigation slice of the store for a
 * view; this class, ticked once per frame by `CameraRig`, is the only code
 * that moves the camera or the render origin.
 *
 * Invariant: the camera orbits its pivot, and the pivot is the render origin.
 * camera-controls' target sits at (0, 0, 0) and the SimFrame's `originKm` is
 * the pivot in world km: a body (focused, tracked every frame), the Sun (the
 * overview), a point anchored to a body (free), or during a transit a blend of
 * the start pivot and the destination, both re-read every frame so a moving
 * destination is met where it is, not where it was.
 *
 * Every transition starts from the camera as it is at that moment (pivot and
 * pose), so a new request, a reset or a skip mid-flight retargets and never
 * snaps back. User input mid-flight hands distance and direction to the user
 * while the pivot still arrives. A camera state that is not finite is
 * replaced by the overview.
 *
 * Plain TypeScript over camera-controls and the SimFrame, so the whole state
 * machine runs in unit tests without a canvas.
 */
import type { CameraControlsImpl } from "@react-three/drei"
import { Spherical, Vector3, type PerspectiveCamera } from "three"

import {
	KM_PER_UNIT,
	childDistanceCurve,
	degToRad,
	displayDistanceKm,
	radToDeg,
	toUnits,
} from "@/sim"
import {
	FLIGHT_PROFILE,
	useFlightStore,
	type FlightState,
} from "@/store/flight"
import {
	HOME_SHOT,
	OVERVIEW,
	isFrameAnchored,
	type EyePoint,
	type FitRegion,
	type Transition,
	type View,
	type ViewMode,
	viewBodyId,
	viewMode,
} from "@/store/navigation"
import { isBodyShown, type SimState } from "@/store/sim"

import { isMoonDotShown } from "../scene/Markers"
import type { SimFrame } from "../scene/simFrame"
import { isPressGrab } from "../scene/tap"
import {
	CAMERA_FOV_DEG,
	CAMERA_MAX_DISTANCE,
	defaultDistance,
	fitDistance,
	minDollyDistance,
	minViewDistance,
} from "./framing"
import {
	clamp01,
	createPose,
	isFinitePose,
	lerpAngle,
	poseToShot,
	resolveShot,
	shotToPose,
	transitDurationMs,
	type SphericalPose,
} from "./pose"
import {
	neighbourhoodOf,
	pointDisplayKm,
	pointOffsetKm,
	snapTarget,
} from "./recentre"
import {
	LIFT_ELEVATION_DEG,
	flightPlan,
	transitProfile,
	type TransitInput,
	type TransitProfile,
	type TransitSample,
} from "./profiles"

/**
 * useFrame priority of the director: after SimClock (-1, which computes the
 * positions it reads) and before everything that renders from the origin (0).
 */
export const CAMERA_FRAME_PRIORITY = -0.5

/** A target further than this (relative to the camera distance) from the origin is a moved pivot. */
const PIVOT_DRIFT_EPSILON = 1e-9

/** A pan's glide is over once the pivot is this close to where it is heading (relative to the camera distance). */
const PAN_REST_EPSILON = 1e-4

/** How long a released pan glides onto the body it landed on (#15), ms. */
export const SNAP_DURATION_MS = 450

export interface StoreLike {
	getState(): SimState
}

/** Where the director records flights for the readout (#18). */
export interface FlightLogLike {
	getState(): Pick<FlightState, "depart" | "transitionStarted" | "arrive">
}

/** Polar angle (from +Y) the camera rises to during a flight's lift. */
const LIFT_PHI = degToRad(90 - LIFT_ELEVATION_DEG)

/** With reduced motion asked for, flights jump (the readout still tells the story). */
const prefersReducedMotion = (): boolean =>
	typeof window !== "undefined" &&
	typeof window.matchMedia === "function" &&
	window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** What the director is doing, for tests and the debug handle. */
export interface CameraSnapshot {
	mode: ViewMode
	/** The transition being executed, if any. */
	transitionId: number | null
	/** Its planned duration (ms) and progress (0..1); null while settled. */
	durationMs: number | null
	progress: number | null
	/** Render origin (the pivot) in world km. */
	originKm: [number, number, number]
	/** camera-controls target, scene units relative to the origin (0 when the pivot is pinned). */
	targetUnits: [number, number, number]
	/** Camera position in world km. */
	cameraKm: [number, number, number]
	/** Camera distance from the pivot, scene units. */
	distance: number
	azimuthDeg: number
	elevationDeg: number
	/** The lens: vertical field of view, degrees (#41). */
	fovDeg: number
	/** The camera stands at a requested eye point and follows it (#41). */
	eyeHeld: boolean
	finite: boolean
}

interface Anchored {
	index: number
	offsetKm: Float64Array
}

const scratchTarget = new Vector3()
const scratchTargetEnd = new Vector3()
const scratchPosition = new Vector3()
const scratchSpherical = new Spherical()
const scratchPivot = new Float64Array(3)
const scratchEye = new Float64Array(3)
const scratchEyePivot = new Float64Array(3)

/** camera-controls' ACTION.NONE: no gesture in progress. */
const ACTION_NONE = 0

export class CameraDirector {
	private initialized = false
	private forceJump = false

	// the transition being executed
	private runningId: number | null = null
	private runningView: View = OVERVIEW
	private startedAt = 0
	private durationMs = 0
	private profile: TransitProfile = transitProfile(null)
	private readonly from: Anchored = { index: 0, offsetKm: new Float64Array(3) }
	private readonly fromPose: SphericalPose = createPose()
	private readonly toPose: SphericalPose = createPose()
	private readonly pose: SphericalPose = createPose()
	private readonly input: TransitInput = {
		fromDistance: 1,
		toDistance: 1,
		separation: 0,
		widthPerDistance: 1,
		aspect: 1,
	}
	private readonly sample: TransitSample = {
		pivot: 0,
		distance: 1,
		direction: 0,
	}

	/** Requested arrival distance, in multiples of the destination's default (re-read each frame: the scale may change mid-flight). */
	private toFactor = 1
	/** The scale version and default distance the settled camera was framed under (scale changes rescale it). */
	private followedVersion = -1
	private followedDefault = 0

	/** Body the current pivot is attached to (for the start of the next transition). */
	private heldIndex = 0
	/** A pivot the user moved (pan) that the store has not been told about yet. */
	private pendingPan: Anchored | null = null

	/**
	 * Where the camera stands while a view asked for an eye (#41): kept there
	 * as the bodies move, until the user takes the camera.
	 */
	private eye: Anchored | null = null
	private eyeHeld = false
	/** The lens at the start of the running move and on its arrival, degrees. */
	private fromFov = CAMERA_FOV_DEG
	private toFov = CAMERA_FOV_DEG

	private readonly fromKm = new Float64Array(3)
	private readonly toKm = new Float64Array(3)

	/** A pointer is pressed on the canvas (between camera-controls' controlstart and controlend). */
	private pressing = false

	private readonly onPress = () => {
		this.pressing = true
	}
	private readonly onRelease = () => {
		this.pressing = false
	}
	// a press is a tap until it moves past the tap allowance or a second finger lands:
	// a tap never takes the camera (#49: a tap pauses the opening), a drag, wheel or pinch does
	private readonly onUserInput = () => {
		if (this.pressing && !isPressGrab()) return
		this.userInput()
	}
	private readonly onRest = () => this.rest()

	constructor(
		readonly controls: CameraControlsImpl,
		readonly camera: PerspectiveCamera,
		readonly frame: SimFrame,
		readonly store: StoreLike,
		readonly flights: FlightLogLike = useFlightStore,
	) {}

	/** Starts listening to the controls (user input hands transitions over; rest publishes the shot). */
	attach(): void {
		this.controls.addEventListener("controlstart", this.onPress)
		this.controls.addEventListener("controlend", this.onRelease)
		this.controls.addEventListener("control", this.onUserInput)
		this.controls.addEventListener("rest", this.onRest)
	}

	detach(): void {
		this.controls.removeEventListener("controlstart", this.onPress)
		this.controls.removeEventListener("controlend", this.onRelease)
		this.controls.removeEventListener("control", this.onUserInput)
		this.controls.removeEventListener("rest", this.onRest)
		this.pressing = false
	}

	/** One frame: `now` in ms (performance.now()), `deltaS` the frame time in seconds. */
	tick(now: number, deltaS: number): void {
		// before the first frame the camera is wherever three.js put it; initialize replaces it
		if (this.initialized && !this.isHealthy()) this.recover()
		const transition = this.store.getState().transition
		if (!this.initialized) {
			this.initialize(now)
		} else if (transition !== null && transition.id !== this.runningId) {
			this.begin(now)
		}

		if (this.runningId !== null) {
			const current = this.store.getState().transition
			if (current === null || current.id !== this.runningId) {
				// replaced from outside without passing through begin (store reset)
				this.runningId = null
				this.follow(this.store.getState().view)
			} else {
				this.advance(now)
			}
		}
		if (this.runningId === null) this.hold()

		this.controls.update(deltaS)
		this.settlePan()

		const { sequence, tickSequence } = this.store.getState()
		if (
			sequence?.phase === "holding" &&
			sequence.holdUntil !== null &&
			now >= sequence.holdUntil
		) {
			tickSequence(now)
		}
	}

	/** Where the camera is and what it is doing; `now` (ms) only feeds `progress`. */
	snapshot(now: number = performance.now()): CameraSnapshot {
		const state = this.store.getState()
		const running = this.runningId !== null
		const finite = this.isHealthy()
		const target = this.controls.getTarget(new Vector3(), false)
		const origin = this.frame.originKm
		const pose = this.readPose(createPose(), false)
		const position = this.camera.position
		const cameraKm: [number, number, number] = [
			origin[0] + position.x * KM_PER_UNIT,
			origin[1] + position.y * KM_PER_UNIT,
			origin[2] + position.z * KM_PER_UNIT,
		]
		return {
			mode: viewMode(state),
			transitionId: this.runningId,
			durationMs: running ? this.durationMs : null,
			progress: running
				? this.durationMs > 0
					? clamp01((now - this.startedAt) / this.durationMs)
					: 1
				: null,
			originKm: [origin[0], origin[1], origin[2]],
			targetUnits: [target.x, target.y, target.z],
			cameraKm,
			distance: pose.radius,
			azimuthDeg: radToDeg(pose.theta),
			elevationDeg: 90 - radToDeg(pose.phi),
			fovDeg: this.camera.fov,
			eyeHeld: this.eye !== null && this.eyeHeld,
			finite,
		}
	}

	// --- frame steps -------------------------------------------------------

	/** First frame: put the camera where the store says, without animation. */
	private initialize(now: number): void {
		const state = this.store.getState()
		const pending = state.transition
		const view = pending?.view ?? state.view
		const index = this.anchorIndex(view)
		this.initialized = true
		if (index === undefined) {
			state.reset()
			this.forceJump = true
			this.begin(now)
			return
		}
		const fit = pending?.fit ?? null
		this.takeEye(pending?.eye ?? null)
		this.setFov(pending?.lensDeg ?? CAMERA_FOV_DEG)
		this.toFov = this.fromFov = this.camera.fov
		shotToPose(
			{
				...HOME_SHOT,
				...state.shot,
				...pending?.shot,
				...(fit === null ? {} : { distance: this.fitFactor(fit, view) }),
			},
			this.defaultDistance(view),
			this.pose,
		)
		this.pivotOf(view, this.toKm)
		this.setOrigin(this.toKm)
		if (this.eye !== null) this.eyePose(view, this.pose)
		this.applyPose(this.pose)
		this.heldIndex = index
		this.forceJump = false
		this.follow(view)
		if (pending !== null) state.settle(pending.id, now)
		this.publishShot()
	}

	/** A new transition: capture where the camera is now and plan the move. */
	private begin(now: number): void {
		const transition = this.store.getState().transition
		if (transition === null) return
		const view = transition.view
		const toIndex = this.anchorIndex(view)
		this.pendingPan = null
		this.store.getState().setPanning(false)
		if (toIndex === undefined) {
			// cannot happen for store-validated views; never leave a stuck transition behind
			this.runningId = null
			this.store.getState().reset()
			return
		}

		// the pivot right now: the origin plus any drift of the controls' target
		const target = this.controls.getTarget(scratchTarget, false)
		const origin = this.frame.originKm
		const from = this.from
		from.index = this.heldIndex
		const at = from.index * 3
		const positions = this.frame.displayKm
		from.offsetKm[0] = origin[0] + target.x * KM_PER_UNIT - positions[at]
		from.offsetKm[1] = origin[1] + target.y * KM_PER_UNIT - positions[at + 1]
		from.offsetKm[2] = origin[2] + target.z * KM_PER_UNIT - positions[at + 2]
		this.readPose(this.fromPose, false)

		const broken =
			this.forceJump ||
			!isFinitePose(this.fromPose) ||
			!from.offsetKm.every(Number.isFinite)
		if (broken) {
			// start from a sane pose; the move itself is a jump
			shotToPose(HOME_SHOT, this.defaultDistance(view), this.fromPose)
			from.index = toIndex
			from.offsetKm.fill(0)
		}
		resolveShot(
			transition.shot,
			this.fromPose,
			this.defaultDistance(view),
			this.toPose,
		)
		this.fromFov = this.camera.fov
		this.toFov = transition.lensDeg ?? CAMERA_FOV_DEG
		this.takeEye(transition.eye)

		this.toFactor =
			transition.fit !== null
				? this.fitFactor(transition.fit, view, this.toFov)
				: (transition.shot?.distance ?? 1)
		this.profile = transitProfile(transition.profile)
		this.runningId = transition.id
		this.runningView = view
		this.fillInput()
		this.startedAt = now
		const flight = transition.profile === FLIGHT_PROFILE
		this.durationMs =
			broken || (flight && prefersReducedMotion())
				? 0
				: (transition.durationMs ??
					this.profile.durationMs?.(this.input) ??
					transitDurationMs(this.profile.length(this.input)))
		this.forceJump = false
		this.logFlight(transition, toIndex, now)
	}

	/**
	 * Records a flight between two bodies for the readout (#18): where from
	 * (the body the pivot was attached to), where to, and the TRUE distance
	 * between their centres right now. Any other move tells the log, which
	 * keeps the record only when the move lands on the flight's destination.
	 */
	private logFlight(
		transition: Transition,
		toIndex: number,
		now: number,
	): void {
		const log = this.flights.getState()
		const fromIndex = this.from.index
		if (
			transition.profile !== FLIGHT_PROFILE ||
			transition.view.kind !== "body" ||
			fromIndex === toIndex
		) {
			log.transitionStarted(transition.id, transition.view)
			return
		}
		const p = this.frame.positionsKm
		const a = fromIndex * 3
		const b = toIndex * 3
		const plan = flightPlan(this.input)
		log.depart({
			id: transition.id,
			fromId: this.frame.bodies[fromIndex].id,
			toId: this.frame.bodies[toIndex].id,
			distanceKm: Math.hypot(
				p[b] - p[a],
				p[b + 1] - p[a + 1],
				p[b + 2] - p[a + 2],
			),
			startedAt: now,
			durationMs: this.durationMs,
			travelStart: plan.travelStart,
			travelEnd: plan.travelEnd,
		})
		if (this.durationMs === 0) log.arrive(transition.id)
	}

	/** One frame of the running transition. */
	private advance(now: number): void {
		const state = this.store.getState()
		const transition = state.transition
		if (transition === null) return
		const view = this.runningView
		const toIndex = this.anchorIndex(view) ?? 0
		const t =
			this.durationMs > 0
				? clamp01((now - this.startedAt) / this.durationMs)
				: 1

		this.anchoredKm(this.from, this.fromKm)
		this.pivotOf(view, this.toKm)
		this.controls.minDistance = minDollyDistance(0)
		this.controls.maxDistance = CAMERA_MAX_DISTANCE

		if (t >= 1) {
			this.setOrigin(this.toKm)
			this.setFov(this.toFov)
			if (!transition.handedOver) {
				if (this.eye !== null) this.eyePose(view, this.toPose)
				this.applyPose(this.toPose)
			} else {
				// the user drove the distance; make sure it is not inside the destination
				this.readPose(this.pose, true)
				const min = minViewDistance(view, this.frame)
				if (this.pose.radius < min) void this.controls.dollyTo(min, true)
			}
			this.heldIndex = toIndex
			this.runningId = null
			this.follow(view)
			this.flights.getState().arrive(transition.id)
			state.settle(transition.id, now)
			this.publishShot()
			return
		}

		this.fillInput()
		this.sample.lift = 0
		const sample = this.profile.sample(t, this.input, this.sample)
		const w = sample.pivot
		const blended = scratchPivot
		blended[0] = this.fromKm[0] + (this.toKm[0] - this.fromKm[0]) * w
		blended[1] = this.fromKm[1] + (this.toKm[1] - this.fromKm[1]) * w
		blended[2] = this.fromKm[2] + (this.toKm[2] - this.fromKm[2]) * w
		this.setOrigin(blended)
		this.heldIndex = w < 0.5 ? this.from.index : toIndex

		if (this.fromFov !== this.toFov) {
			// the lens changes along with the direction, in log space (a zoom)
			this.setFov(
				Math.exp(
					Math.log(this.fromFov) +
						(Math.log(this.toFov) - Math.log(this.fromFov)) *
							clamp01(sample.direction),
				),
			)
		}
		if (!transition.handedOver) {
			const pose = this.pose
			pose.radius = sample.distance
			pose.theta = lerpAngle(
				this.fromPose.theta,
				this.toPose.theta,
				sample.direction,
			)
			pose.phi =
				this.fromPose.phi +
				(this.toPose.phi - this.fromPose.phi) * sample.direction
			const lift = sample.lift ?? 0
			if (lift > 0) {
				// rise above the plane of the orbits (below it, seen from below)
				const top =
					pose.phi <= Math.PI / 2
						? Math.min(pose.phi, LIFT_PHI)
						: Math.max(pose.phi, Math.PI - LIFT_PHI)
				pose.phi += (top - pose.phi) * lift
			}
			this.applyPose(pose)
		}
	}

	/** Settled: keep the origin on the view's pivot (tracking it) and fold a moved target into it. */
	private hold(): void {
		const state = this.store.getState()
		const view = state.view
		const index = this.anchorIndex(view)
		if (index === undefined) {
			state.reset()
			return
		}
		this.heldIndex = index
		const pivot = this.toKm
		if (this.pendingPan !== null) this.anchoredKm(this.pendingPan, pivot)
		else this.pivotOf(view, pivot)

		// a pan (#15) moved the target off the origin: once the gesture is over,
		// the moved target becomes the pivot and everything shifts back invisibly
		const target = this.controls.getTarget(scratchTarget, false)
		this.readPose(this.pose, false)
		const drifted = target.length() > PIVOT_DRIFT_EPSILON * this.pose.radius
		if (drifted && !state.panning) state.setPanning(true)
		if (drifted && this.controls.currentAction === ACTION_NONE) {
			pivot[0] += target.x * KM_PER_UNIT
			pivot[1] += target.y * KM_PER_UNIT
			pivot[2] += target.z * KM_PER_UNIT
			const pan = this.pendingPan ?? { index, offsetKm: new Float64Array(3) }
			const at = index * 3
			const positions = this.frame.displayKm
			pan.index = index
			pan.offsetKm[0] = pivot[0] - positions[at]
			pan.offsetKm[1] = pivot[1] - positions[at + 1]
			pan.offsetKm[2] = pivot[2] - positions[at + 2]
			this.pendingPan = pan
			this.shiftTarget(target)
		}
		this.setOrigin(pivot)
		if (this.eye !== null && this.eyeHeld && this.pendingPan === null) {
			// standing at the eye (#41): stay there and keep looking at the centre
			this.follow(view)
			this.eyePose(view, this.pose)
			this.applyPose(this.pose)
			this.controls.minDistance = minDollyDistance(0)
			this.controls.maxDistance = CAMERA_MAX_DISTANCE
			return
		}
		this.followScale(view)
		this.controls.minDistance =
			this.pendingPan === null
				? minViewDistance(view, this.frame)
				: minDollyDistance(0)
		this.controls.maxDistance = CAMERA_MAX_DISTANCE
	}

	/**
	 * After the controls' update: a pan that is over (released, and its
	 * damped glide finished) is committed. Not on camera-controls' `rest`,
	 * which also fires while a finger holds still mid-drag, never fires after
	 * an instant move, and uses an absolute threshold (10 km) that means
	 * nothing next to a 0.3 km moon or across 30 AU.
	 */
	private settlePan(): void {
		if (
			this.runningId !== null ||
			this.pendingPan === null ||
			this.controls.currentAction !== ACTION_NONE
		) {
			return
		}
		const target = this.controls.getTarget(scratchTarget, false)
		const end = this.controls.getTarget(scratchTargetEnd, true)
		const radius = this.readPose(this.pose, false).radius
		if (target.distanceTo(end) > PAN_REST_EPSILON * radius) return
		this.commitPan()
		this.publishShot()
	}

	// --- events --------------------------------------------------------------

	private userInput(): void {
		// the user takes the camera: it no longer stands at the eye (#41)
		this.eyeHeld = false
		const { transition, sequence, userInput } = this.store.getState()
		if (
			(transition !== null && !transition.handedOver) ||
			sequence?.phase === "moving" ||
			sequence?.phase === "holding"
		) {
			userInput()
		}
	}

	private rest(): void {
		if (this.runningId !== null || !this.initialized) return
		this.publishShot()
	}

	// --- helpers -------------------------------------------------------------

	/** Remembers what the settled camera is framed against, for `followScale`. */
	private follow(view: View): void {
		this.followedVersion = this.frame.scaleVersion
		this.followedDefault = this.defaultDistance(view)
	}

	/**
	 * A scale change (#8, #21) moves every drawn size and distance: the camera
	 * distance scales with the view's default framing (the focus's drawn radius,
	 * or the drawn system for the overview), so what is framed keeps its size on
	 * screen while everything else moves to where the new scale puts it.
	 */
	private followScale(view: View): void {
		if (this.frame.scaleVersion === this.followedVersion) return
		const from = this.followedDefault
		this.follow(view)
		if (!(from > 0) || this.pendingPan !== null) return
		const radius = this.readPose(this.pose, true).radius
		const min = minViewDistance(view, this.frame)
		// the new limit first: dollyTo clamps to it
		this.controls.minDistance = min
		void this.controls.dollyTo(
			Math.max(min, (radius * this.followedDefault) / from),
			false,
		)
	}

	/**
	 * A pan came to rest (#15). If the centre of the screen is on a body (or
	 * right next to one), the pivot glides onto it: dragging a planet to the
	 * middle re-centres on it, and a pan too small to leave the focused body
	 * snaps back instead of silently dropping the focus. Otherwise the pivot
	 * becomes a point in space, anchored to the body whose neighbourhood it is
	 * in and kept in true km from it.
	 */
	private commitPan(): void {
		const state = this.store.getState()
		const pan = this.pendingPan
		this.pendingPan = null
		state.setPanning(false)
		if (pan === null) return
		const origin = this.frame.originKm
		const position = this.camera.position
		const cameraKm = scratchPivot
		cameraKm[0] = origin[0] + position.x * KM_PER_UNIT
		cameraKm[1] = origin[1] + position.y * KM_PER_UNIT
		cameraKm[2] = origin[2] + position.z * KM_PER_UNIT
		// what is left of the glide (invisible by now) goes into the pivot too
		const target = this.controls.getTarget(scratchTarget, false)
		const pivot = this.toKm
		pivot[0] = origin[0] + target.x * KM_PER_UNIT
		pivot[1] = origin[1] + target.y * KM_PER_UNIT
		pivot[2] = origin[2] + target.z * KM_PER_UNIT
		void this.controls.moveTo(0, 0, 0, false)
		this.setOrigin(pivot)

		// in an anchored frame (#31) the centre stays with the body held still:
		// a pan lands back on it or becomes a point near it, never a new frame
		const held = isFrameAnchored(state)
			? this.frame.index.get(state.frameId)
			: undefined
		const snapped = snapTarget(
			this.frame,
			cameraKm,
			pivot,
			this.camera.fov,
			held === undefined ? this.isOnScreen : (i) => i === held,
		)
		if (snapped >= 0) {
			const view = this.snapView(state.view, snapped)
			const radius = this.readPose(this.pose, true).radius
			state.goTo(view, {
				shot: { distance: radius / this.defaultDistance(view) },
				durationMs: SNAP_DURATION_MS,
			})
			return
		}

		const anchor = held ?? neighbourhoodOf(this.frame, pivot)
		const offset = pointOffsetKm(this.frame, anchor, pivot, new Float64Array(3))
		const view: View = {
			kind: "point",
			anchorId: this.frame.bodies[anchor].id,
			offsetKm: [offset[0], offset[1], offset[2]],
		}
		this.heldIndex = anchor
		state.settleAt(view)
		this.follow(view)
	}

	/**
	 * The view a pan that landed on body `index` re-centres on: the current
	 * view when that is where it came from (the overview keeps being the
	 * overview), the overview for the Sun, the body otherwise.
	 */
	private snapView(current: View, index: number): View {
		const id = this.frame.bodies[index].id
		if (current.kind === "body" && current.id === id) return current
		if (id === viewBodyId(OVERVIEW)) {
			return current.kind === "body" ? { kind: "body", id } : OVERVIEW
		}
		return { kind: "body", id }
	}

	/** Bodies a pan can land on: the ones drawn right now (the moon rules of the markers). */
	private readonly isOnScreen = (i: number): boolean => {
		const state = this.store.getState()
		const body = this.frame.bodies[i]
		if (!isBodyShown(body, state)) return false
		if (body.kind !== "moon") return true
		const focus = this.frame.bodies[this.frame.index.get(state.focusId) ?? 0]
		return isMoonDotShown(body, state.focusId, focus.parentId)
	}

	private publishShot(): void {
		const state = this.store.getState()
		if (state.transition !== null) return
		this.readPose(this.pose, true)
		if (!isFinitePose(this.pose)) return
		state.publishShot(poseToShot(this.pose, this.defaultDistance(state.view)))
	}

	/** Moves the target back to the origin by `offset` without moving anything on screen. */
	private shiftTarget(offset: Vector3): void {
		const current = scratchPosition.copy(offset)
		const end = this.controls.getTarget(scratchTargetEnd, true).sub(current)
		void this.controls.moveTo(0, 0, 0, false)
		// keep the rest of a damped pan going from the new origin
		void this.controls.moveTo(end.x, end.y, end.z, true)
	}

	private isHealthy(): boolean {
		const target = this.controls.getTarget(scratchTarget, false)
		const targetEnd = this.controls.getTarget(scratchTargetEnd, true)
		const origin = this.frame.originKm
		this.readPose(this.pose, false)
		if (!isFinitePose(this.pose)) return false
		this.readPose(this.pose, true)
		return (
			isFinitePose(this.pose) &&
			Number.isFinite(target.x + target.y + target.z) &&
			Number.isFinite(targetEnd.x + targetEnd.y + targetEnd.z) &&
			Number.isFinite(origin[0] + origin[1] + origin[2]) &&
			Number.isFinite(
				this.camera.position.x +
					this.camera.position.y +
					this.camera.position.z,
			)
		)
	}

	/** The way out of a broken state: a finite pose, then a jump to the overview. */
	private recover(): void {
		void this.controls.setLookAt(0, 0, 1, 0, 0, 0, false)
		this.frame.originKm.fill(0)
		this.pendingPan = null
		this.store.getState().setPanning(false)
		this.runningId = null
		this.heldIndex = this.frame.index.get(viewBodyId(OVERVIEW)) ?? 0
		this.forceJump = true
		this.store.getState().reset()
	}

	private readPose(out: SphericalPose, end: boolean): SphericalPose {
		// camera-controls' Spherical has the same fields
		const spherical = this.controls.getSpherical(scratchSpherical, end)
		out.radius = spherical.radius
		out.theta = spherical.theta
		out.phi = spherical.phi
		return out
	}

	private applyPose(pose: SphericalPose): void {
		const position = scratchPosition.setFromSphericalCoords(
			pose.radius,
			pose.phi,
			pose.theta,
		)
		void this.controls.setLookAt(
			position.x,
			position.y,
			position.z,
			0,
			0,
			0,
			false,
		)
	}

	private setOrigin(km: ArrayLike<number>): void {
		const origin = this.frame.originKm
		origin[0] = km[0]
		origin[1] = km[1]
		origin[2] = km[2]
	}

	private anchorIndex(view: View): number | undefined {
		return this.frame.index.get(viewBodyId(view))
	}

	/** World km of a view's pivot at the current positions. */
	private pivotOf(view: View, out: Float64Array): Float64Array {
		const index = this.anchorIndex(view) ?? 0
		if (view.kind === "point") {
			return pointDisplayKm(this.frame, index, view.offsetKm, out)
		}
		const at = index * 3
		const positions = this.frame.displayKm
		out[0] = positions[at]
		out[1] = positions[at + 1]
		out[2] = positions[at + 2]
		return out
	}

	private anchoredKm(anchored: Anchored, out: Float64Array): Float64Array {
		const at = anchored.index * 3
		const positions = this.frame.displayKm
		out[0] = positions[at] + anchored.offsetKm[0]
		out[1] = positions[at + 1] + anchored.offsetKm[1]
		out[2] = positions[at + 2] + anchored.offsetKm[2]
		return out
	}

	/**
	 * The shot distance (a multiple of the view's default) that frames
	 * `fit`: a sphere of `fit.km` true km, drawn as a distance from body
	 * `fit.around` is drawn under the active scale.
	 */
	private fitFactor(
		fit: FitRegion,
		view: View,
		fovDeg: number = this.camera.fov,
	): number {
		const i = this.frame.index.get(fit.around)
		const fallback = 1
		if (i === undefined) return fallback
		const body = this.frame.bodies[i]
		const drawnKm = displayDistanceKm(
			fit.km,
			body.radiusKm,
			this.frame.displayRadiiKm[i],
			childDistanceCurve(this.frame.scale, body.parentId === null),
		)
		const factor =
			fitDistance(toUnits(drawnKm), fovDeg, this.camera.aspect) /
			this.defaultDistance(view)
		return Number.isFinite(factor) && factor > 0 ? factor : fallback
	}

	/** Takes the eye of a request (#41), or none. */
	private takeEye(eye: EyePoint | null): void {
		const index = eye === null ? undefined : this.frame.index.get(eye.anchorId)
		if (eye === null || index === undefined) {
			this.eye = null
			this.eyeHeld = false
			return
		}
		this.eye = { index, offsetKm: Float64Array.from(eye.offsetKm) }
		this.eyeHeld = true
	}

	/**
	 * The pose (relative to the pivot of `view`) that puts the camera at the
	 * eye and looks at the pivot: the eye drawn like a point near its anchor.
	 */
	private eyePose(view: View, out: SphericalPose): SphericalPose {
		const eye = this.eye
		if (eye === null) return out
		const at = pointDisplayKm(this.frame, eye.index, eye.offsetKm, scratchEye)
		const pivot = this.pivotOf(view, scratchEyePivot)
		const spherical = scratchSpherical.setFromCartesianCoords(
			(at[0] - pivot[0]) / KM_PER_UNIT,
			(at[1] - pivot[1]) / KM_PER_UNIT,
			(at[2] - pivot[2]) / KM_PER_UNIT,
		)
		if (!(spherical.radius > 0)) return out
		out.radius = spherical.radius
		out.theta = spherical.theta
		out.phi = spherical.phi
		return out
	}

	private setFov(fovDeg: number): void {
		if (this.camera.fov === fovDeg) return
		this.camera.fov = fovDeg
		this.camera.updateProjectionMatrix()
	}

	private defaultDistance(view: View): number {
		return defaultDistance(
			view,
			this.frame,
			this.camera.fov,
			this.camera.aspect,
		)
	}

	/** The profile's input from the current pivots (fills `fromKm` and `toKm`). */
	private fillInput(): void {
		this.anchoredKm(this.from, this.fromKm)
		const to = this.pivotOf(this.runningView, this.toKm)
		const dx = to[0] - this.fromKm[0]
		const dy = to[1] - this.fromKm[1]
		const dz = to[2] - this.fromKm[2]
		this.toPose.radius = this.toFactor * this.defaultDistance(this.runningView)
		if (this.eye !== null) this.eyePose(this.runningView, this.toPose)
		this.input.fromDistance = this.fromPose.radius
		this.input.toDistance = this.toPose.radius
		this.input.separation = Math.hypot(dx, dy, dz) / KM_PER_UNIT
		this.input.widthPerDistance = 2 * Math.tan(degToRad(this.camera.fov) / 2)
		this.input.aspect = this.camera.aspect > 0 ? this.camera.aspect : 1
	}
}

export default CameraDirector
