/**
 * Spacecraft paths (issue #35): the route a craft took and will take.
 *
 * - The cruise path: the whole trajectory in the Sun's frame, each vertex
 *   placed with the planets where they were at that time (so a flyby bends
 *   around the place the planet was), mapped through the scale engine; it is
 *   rebuilt only when the scale changes. The part already flown is bright, the
 *   part still ahead dim, split exactly at the craft.
 * - The local track: while a craft orbits a planet (Juno, Cassini), the loops
 *   are drawn around where the planet is now, `trackDays` either side of the
 *   current time, like a moon's orbit line; the cruise path ends at arrival.
 * - Milestones: small rings on the path of the selected craft where its
 *   events happened (flybys, the heliopause).
 *
 * Paths are drawn for the selected and the pointed-at craft, or for every
 * craft with "Show every path" on. Vertices are rebuilt relative to the
 * render origin every frame, in doubles before the float32 rounding.
 */
import { useMemo } from "react"
import { extend, useFrame } from "@react-three/fiber"
import {
	Line,
	type BufferAttribute,
	type LineBasicMaterial,
	type Points,
} from "three"

import { rootIndexOf, toUnits } from "@/sim"
import {
	eventsWithJD,
	fillPath,
	fillTrack,
	flybyPathTimes,
	isoToJD,
	pathTimes,
	type CraftSegment,
	type CraftTrajectory,
} from "@/sim/spacecraft"
import { useSpacecraftStore } from "@/store/spacecraft"

import { anchoredWeight } from "../frame/frameBlend"
import type { SimFrame } from "../scene/simFrame"
import type { CraftFrame } from "./craftFrame"
import { CRAFT_COLOR } from "./CraftMarkers"
import { trajectoryOf } from "./trajectories"

// see bodies/OrbitLine.tsx: the prefixed name must be registered for re-renders
extend({ ThreeLine: Line })

const CRAFT_HEX = `rgb(${CRAFT_COLOR.map((c) => Math.round(c * 255)).join(",")})`

/** Opacity of the flown and the future part, for the selected craft and for any other. */
export const PATH_OPACITY = {
	selected: { flown: 0.95, future: 0.35 },
	other: { flown: 0.45, future: 0.15 },
} as const

export type PathEmphasis = keyof typeof PATH_OPACITY

/** A time range spent orbiting a planet: [from, to] in JD. */
interface OrbitWindow {
	from: number
	to: number
	center: string
	trackDays: number
}

export interface CruisePath {
	/** Vertex times, JD, ascending. */
	readonly times: Float64Array
	/** Drawn positions relative to the drawn Sun (`root`), display km, 3 per vertex. */
	readonly display: Float64Array
	readonly orbits: readonly OrbitWindow[]
	/** Events on the drawn path: time and drawn position. */
	readonly eventTimes: Float64Array
	readonly eventDisplay: Float64Array
	/** Index of the Sun, the path's origin. */
	readonly root: number
}

const orbitWindows = (
	craftFrame: CraftFrame,
	k: number,
	trajectory: CraftTrajectory,
): OrbitWindow[] =>
	craftFrame.craft[k].orbits.map((orbit) => {
		const from = isoToJD(orbit.from)
		// the craft is drawn as bound from periapsis if the insertion burn
		// ends after it (#56): the track takes over there
		const arrival = trajectory.encounters.find(
			(e) =>
				e.kind === "arrival" &&
				e.center === orbit.center &&
				e.hyperTo < from &&
				e.hyperTo >= from - 1 &&
				e.to >= from,
		)
		return {
			from: arrival === undefined ? from : arrival.hyperTo,
			to: orbit.to === undefined ? trajectory.toJD : isoToJD(orbit.to),
			center: orbit.center,
			trackDays: orbit.trackDays,
		}
	})

const inOrbit = (
	orbits: readonly OrbitWindow[],
	jd: number,
): OrbitWindow | null =>
	orbits.find((orbit) => jd > orbit.from && jd <= orbit.to) ?? null

/** The cruise path of craft `k` under the frame's current scale. */
export function buildCruisePath(
	frame: SimFrame,
	craftFrame: CraftFrame,
	k: number,
	trajectory: CraftTrajectory,
): CruisePath {
	const orbits = orbitWindows(craftFrame, k, trajectory)
	const all: CraftSegment[] = [...trajectory.helio, ...trajectory.planetary]
	// near a planet the drawing spreads the turn over more time (#56): extra vertices there
	const passages = flybyPathTimes(
		trajectory,
		frame,
		trajectory.fromJD,
		trajectory.toJD,
	)
	const times = pathTimes(
		all,
		trajectory.fromJD,
		trajectory.toJD,
		passages,
	).filter((t) => inOrbit(orbits, t) === null)
	const root = rootIndexOf(frame.bodies)
	const display = fillPath(
		trajectory,
		times,
		frame,
		root,
		new Float64Array(times.length * 3),
	)
	const events = eventsWithJD(craftFrame.craft[k].events).filter(
		(event) =>
			event.jd >= trajectory.fromJD &&
			event.jd <= trajectory.toJD &&
			inOrbit(orbits, event.jd) === null,
	)
	const eventTimes = Float64Array.from(events, (event) => event.jd)
	const eventDisplay = fillPath(
		trajectory,
		[...eventTimes],
		frame,
		root,
		new Float64Array(eventTimes.length * 3),
	)
	// relative to the drawn Sun, which an anchored frame (#31) moves every frame
	relativeTo(display, frame.displayKm, root)
	relativeTo(eventDisplay, frame.displayKm, root)
	return {
		times: Float64Array.from(times),
		display,
		orbits,
		eventTimes,
		eventDisplay,
		root,
	}
}

/** Subtracts body `i`'s position in `positions` from every point of `points`. */
function relativeTo(
	points: Float64Array,
	positions: ArrayLike<number>,
	i: number,
): void {
	for (let o = 0; o < points.length; o += 3) {
		points[o] -= positions[i * 3]
		points[o + 1] -= positions[i * 3 + 1]
		points[o + 2] -= positions[i * 3 + 2]
	}
}

/** Number of `times` at or before `jd` (binary search). */
export function countUpTo(times: ArrayLike<number>, jd: number): number {
	let lo = 0
	let hi = times.length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (times[mid] <= jd) lo = mid + 1
		else hi = mid
	}
	return lo
}

export interface PathSplit {
	/** Vertices written. */
	count: number
	/** The flown part is [0, flownCount), the future part [futureStart, count). */
	flownCount: number
	futureStart: number
}

/**
 * Writes `display` (display km, 3 per vertex) relative to `origin` as float32
 * scene units into `out`, with the craft's current position `current` (or
 * null) inserted after the last vertex at or before `jd`, and returns where
 * the flown part ends and the future part begins (they share that vertex).
 */
export function writeSplitPath(
	times: ArrayLike<number>,
	display: ArrayLike<number>,
	vertexCount: number,
	jd: number,
	current: ArrayLike<number> | null,
	origin: ArrayLike<number>,
	out: Float32Array,
	split: PathSplit,
): PathSplit {
	const k = countUpTo(times, jd)
	let v = 0
	const put = (x: number, y: number, z: number) => {
		out[v * 3] = toUnits(x - origin[0])
		out[v * 3 + 1] = toUnits(y - origin[1])
		out[v * 3 + 2] = toUnits(z - origin[2])
		v++
	}
	for (let i = 0; i < k && i < vertexCount; i++) {
		put(display[i * 3], display[i * 3 + 1], display[i * 3 + 2])
	}
	const inserted = current !== null && k > 0 && k < vertexCount
	if (inserted) put(current[0], current[1], current[2])
	for (let i = k; i < vertexCount; i++) {
		put(display[i * 3], display[i * 3 + 1], display[i * 3 + 2])
	}
	split.count = v
	split.flownCount = inserted ? k + 1 : k
	split.futureStart = inserted ? k : Math.max(0, k - 1)
	return split
}

/** Two lines (the flown and the future part) drawing one shared vertex array. */
export interface LineSlot {
	flown: Line | null
	future: Line | null
	flownAttribute: BufferAttribute | null
	futureAttribute: BufferAttribute | null
	readonly positions: Float32Array
}

const createLineSlot = (vertices: number): LineSlot => ({
	flown: null,
	future: null,
	flownAttribute: null,
	futureAttribute: null,
	positions: new Float32Array(vertices * 3),
})

/** Ref callbacks: register a mounted line or its position attribute. */
export function attachLine(
	slot: LineSlot,
	part: "flown" | "future",
	line: Line | null,
): void {
	slot[part] = line
}

export function attachAttribute(
	slot: LineSlot,
	part: "flown" | "future",
	attribute: BufferAttribute | null,
): void {
	if (part === "flown") slot.flownAttribute = attribute
	else slot.futureAttribute = attribute
}

/** Scales the slot's opacity by `fade` (0..1); a fully faded slot is not drawn. */
function fadeSlot(slot: LineSlot, fade: number, emphasis: PathEmphasis): void {
	const { flown, future } = slot
	if (flown === null || future === null) return
	const opacity = PATH_OPACITY[emphasis]
	;(flown.material as LineBasicMaterial).opacity = opacity.flown * fade
	;(future.material as LineBasicMaterial).opacity = opacity.future * fade
	flown.visible = future.visible = fade > 0.001
}

/** Applies a split to the slot's two lines. */
function applySplit(slot: LineSlot, split: PathSplit): void {
	const { flown, future, flownAttribute, futureAttribute } = slot
	if (flown === null || future === null) return
	flown.geometry.setDrawRange(0, split.flownCount >= 2 ? split.flownCount : 0)
	const futureCount = split.count - split.futureStart
	future.geometry.setDrawRange(
		split.futureStart,
		futureCount >= 2 ? futureCount : 0,
	)
	if (flownAttribute !== null) flownAttribute.needsUpdate = true
	if (futureAttribute !== null) futureAttribute.needsUpdate = true
}

function SplitLine({
	slot,
	emphasis,
}: {
	slot: LineSlot
	emphasis: PathEmphasis
}) {
	const opacity = PATH_OPACITY[emphasis]
	return (
		<>
			{(["flown", "future"] as const).map((part) => (
				<threeLine
					key={part}
					ref={(line: Line | null) => attachLine(slot, part, line)}
					frustumCulled={false}
					renderOrder={1}
				>
					<bufferGeometry>
						<bufferAttribute
							ref={(attribute: BufferAttribute | null) =>
								attachAttribute(slot, part, attribute)
							}
							attach="attributes-position"
							args={[slot.positions, 3]}
						/>
					</bufferGeometry>
					<lineBasicMaterial
						color={CRAFT_HEX}
						transparent
						opacity={opacity[part]}
						depthWrite={false}
					/>
				</threeLine>
			))}
		</>
	)
}

/** Most vertices a local track can have (its times are subdivided like a path). */
const TRACK_CAPACITY = 8192

/** Everything one drawn path needs between frames. */
export interface PathRuntime {
	readonly trajectory: CraftTrajectory
	readonly index: number
	readonly emphasis: PathEmphasis
	path: CruisePath
	/** The SimFrame's scaleVersion `path` was built for. */
	pathScale: number
	readonly cruise: LineSlot
	readonly track: LineSlot
	/** Drawn track positions before the split, display km. */
	readonly trackDisplay: Float64Array
	/** Track times around `trackCentre` (JD), cached while time moves little. */
	trackTimes: Float64Array | null
	trackCentre: number
	events: Points | null
	readonly eventPositions: Float32Array
	readonly split: PathSplit
}

export function createPathRuntime(
	frame: SimFrame,
	craftFrame: CraftFrame,
	index: number,
	trajectory: CraftTrajectory,
	emphasis: PathEmphasis,
): PathRuntime {
	const path = buildCruisePath(frame, craftFrame, index, trajectory)
	return {
		trajectory,
		index,
		emphasis,
		path,
		pathScale: frame.scaleVersion,
		cruise: createLineSlot(path.times.length + 1),
		track: createLineSlot(TRACK_CAPACITY + 1),
		trackDisplay: new Float64Array(TRACK_CAPACITY * 3),
		trackTimes: null,
		trackCentre: Number.NaN,
		events: null,
		eventPositions: new Float32Array(Math.max(1, path.eventTimes.length) * 3),
		split: { count: 0, flownCount: 0, futureStart: 0 },
	}
}

export function attachEvents(
	runtime: PathRuntime,
	points: Points | null,
): void {
	runtime.events = points
}

const emptySplit: PathSplit = { count: 0, flownCount: 0, futureStart: 0 }
const pathOrigin = new Float64Array(3)
const pathCraft = new Float64Array(3)

/** One frame of a path: rebuild on a scale change, split at the craft, the local track, the milestones. */
export function updatePathRuntime(
	runtime: PathRuntime,
	frame: SimFrame,
	craftFrame: CraftFrame,
): void {
	const { index, trajectory, split } = runtime
	if (runtime.pathScale !== frame.scaleVersion) {
		runtime.path = buildCruisePath(frame, craftFrame, index, trajectory)
		runtime.pathScale = frame.scaleVersion
	}
	const cruise = runtime.path
	const jd = craftFrame.jd
	const state = craftFrame.states[index]
	const present = craftFrame.present[index] === 1
	const orbit = inOrbit(cruise.orbits, jd)

	// the path is kept relative to the drawn Sun: shift the origin and the craft by it
	const r = cruise.root * 3
	for (let k = 0; k < 3; k++) {
		pathOrigin[k] = frame.originKm[k] - frame.displayKm[r + k]
		pathCraft[k] = state.displayKm[k] - frame.displayKm[r + k]
	}
	writeSplitPath(
		cruise.times,
		cruise.display,
		Math.min(cruise.times.length, runtime.cruise.positions.length / 3 - 1),
		jd,
		present && orbit === null ? pathCraft : null,
		pathOrigin,
		runtime.cruise.positions,
		split,
	)
	applySplit(runtime.cruise, split)
	// the cruise path is drawn in the Sun's frame: it fades out while a body is
	// held still (#31), like the orbit lines around the Sun
	fadeSlot(
		runtime.cruise,
		1 - anchoredWeight(frame.frameBlend, cruise.root),
		runtime.emphasis,
	)

	// the loops around the planet being orbited, around where it is now
	const segment =
		orbit === null
			? null
			: (trajectory.planetary.find(
					(s) => s.center === orbit.center && jd >= s.from && jd <= s.to,
				) ?? null)
	if (orbit === null || segment === null || !present) {
		applySplit(runtime.track, emptySplit)
	} else {
		const days = orbit.trackDays
		if (
			runtime.trackTimes === null ||
			Math.abs(runtime.trackCentre - jd) > days * 0.05
		) {
			runtime.trackTimes = Float64Array.from(
				pathTimes([segment], jd - days * 1.1, jd + days * 1.1).slice(
					0,
					TRACK_CAPACITY,
				),
			)
			runtime.trackCentre = jd
		}
		// the orbits only: the approach before the insertion is the cruise path's
		const times = runtime.trackTimes.subarray(
			countUpTo(runtime.trackTimes, Math.max(jd - days, orbit.from)),
			countUpTo(runtime.trackTimes, jd + days),
		)
		const written = fillTrack(segment, times, frame, runtime.trackDisplay)
		writeSplitPath(
			times,
			runtime.trackDisplay,
			written,
			jd,
			state.displayKm,
			frame.originKm,
			runtime.track.positions,
			split,
		)
		applySplit(runtime.track, split)
	}

	const points = runtime.events
	if (points !== null) {
		const count = cruise.eventTimes.length
		const out = runtime.eventPositions
		for (let e = 0; e < count; e++) {
			const o = e * 3
			out[o] = toUnits(cruise.eventDisplay[o] - pathOrigin[0])
			out[o + 1] = toUnits(cruise.eventDisplay[o + 1] - pathOrigin[1])
			out[o + 2] = toUnits(cruise.eventDisplay[o + 2] - pathOrigin[2])
		}
		points.geometry.setDrawRange(0, count)
		points.geometry.attributes.position.needsUpdate = true
	}
}

export interface CraftPathProps {
	frame: SimFrame
	craftFrame: CraftFrame
	index: number
	trajectory: CraftTrajectory
	emphasis: PathEmphasis
	/** Draw the milestone rings (the selected craft). */
	milestones: boolean
}

export function CraftPath({
	frame,
	craftFrame,
	index,
	trajectory,
	emphasis,
	milestones,
}: CraftPathProps) {
	const runtime = useMemo(
		() => createPathRuntime(frame, craftFrame, index, trajectory, emphasis),
		[frame, craftFrame, index, trajectory, emphasis],
	)
	useFrame(() => updatePathRuntime(runtime, frame, craftFrame))

	return (
		<>
			<SplitLine slot={runtime.cruise} emphasis={emphasis} />
			<SplitLine slot={runtime.track} emphasis={emphasis} />
			{milestones && (
				<points
					ref={(points: Points | null) => attachEvents(runtime, points)}
					frustumCulled={false}
					renderOrder={2}
				>
					<bufferGeometry>
						<bufferAttribute
							attach="attributes-position"
							args={[runtime.eventPositions, 3]}
						/>
					</bufferGeometry>
					<pointsMaterial
						size={7}
						sizeAttenuation={false}
						color={CRAFT_HEX}
						transparent
						depthTest={false}
						depthWrite={false}
						onBeforeCompile={ringPoints}
					/>
				</points>
			)}
		</>
	)
}

/** Hollow round points: a milestone on the path, not a body. */
const ringPoints = (shader: { fragmentShader: string }) => {
	shader.fragmentShader = shader.fragmentShader.replace(
		"#include <color_fragment>",
		`#include <color_fragment>
	float ringR = length( gl_PointCoord - 0.5 ) * 2.0;
	float ringW = fwidth( ringR );
	diffuseColor.a *= clamp( 0.5 + ( 1.0 - ringR ) / ringW, 0.0, 1.0 ) * clamp( 0.5 + ( ringR - 0.55 ) / ringW, 0.0, 1.0 );
	if ( diffuseColor.a <= 0.0 ) discard;`,
	)
}

export interface CraftPathsProps {
	frame: SimFrame
	craftFrame: CraftFrame
}

/** The paths of the selected and the pointed-at craft, or of every craft. */
function CraftPaths({ frame, craftFrame }: CraftPathsProps) {
	const show = useSpacecraftStore((state) => state.showSpacecraft)
	const all = useSpacecraftStore((state) => state.showAllPaths)
	const selected = useSpacecraftStore((state) => state.selectedCraftId)
	const hovered = useSpacecraftStore((state) => state.hoverCraftId)
	const ready = useSpacecraftStore((state) => state.trajectoriesReady)
	if (!show || !ready) return null
	return (
		<>
			{craftFrame.craft.map((craft, index) => {
				const isSelected = craft.id === selected
				if (!all && !isSelected && craft.id !== hovered) return null
				const trajectory = trajectoryOf(craft.id)
				if (trajectory === null) return null
				return (
					<CraftPath
						key={craft.id}
						frame={frame}
						craftFrame={craftFrame}
						index={index}
						trajectory={trajectory}
						emphasis={isSelected ? "selected" : "other"}
						milestones={isSelected}
					/>
				)
			})}
		</>
	)
}

export default CraftPaths
