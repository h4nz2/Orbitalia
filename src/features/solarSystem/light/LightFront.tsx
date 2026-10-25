/**
 * The light pulse in the scene (#27): a bright circle where the light sphere
 * cuts the plane of the planets, a faint glow over everything it has already
 * passed, and a label riding on it with the time the light has been
 * travelling. The geometry is `writeFront` (lightFront.ts), rewritten every
 * frame from the SimFrame and the simulation time, so the front pauses,
 * speeds up and runs backwards with the clock. The label is DOM beside the
 * Canvas (`FrontLabelLayer`), placed by the label layout with every other
 * name in the scene (#74, ./frontLabel.ts): this writes where on the front
 * it rides.
 */
import { useEffect, useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { IconX } from "@tabler/icons-react"
import {
	BufferAttribute,
	BufferGeometry,
	Color,
	DoubleSide,
	Mesh,
	MeshBasicMaterial,
	type InterleavedBuffer,
	type Vector3,
} from "three"
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js"

import { useI18n } from "@/i18n"
import { Hint } from "@/primitives/hint"
import { frontRadiusKm, secondsSince } from "@/sim/light"
import { toUnits } from "@/sim"
import { useLightStore, type LightPulse } from "@/store/light"

import { attachLabel, measureLabel, type LabelBoard } from "../labels/board"
import { useSimFrame, type SimFrame } from "../scene/simFrame"
import type { FrontLabelAnchor } from "./frontLabel"
import {
	FRONT_VERTICES,
	frontPointDisplayKm,
	frontSource,
	writeFront,
	type FrontSource,
	type FrontState,
} from "./lightFront"
import {
	flashState,
	formatDuration,
	pastPlanetsSeconds,
	pulseTargetIds,
} from "./lightTravel"

import labelClasses from "../labels/Labels.module.css"
import classes from "./LightFront.module.css"

export const FRONT_COLOR = "#ffe7a3"
/** Opacity of the glow at the front's edge (it fades to 0 toward the source). */
export const GLOW_OPACITY = 0.16
/** Width of the front's line, px: thicker than an orbit line, so it reads on a projector at any scale. */
export const FRONT_WIDTH_PX = 2.5

interface FrontObjects {
	line: LineSegments2
	glow: Mesh
	/** The front's vertices (FRONT_VERTICES x 3), as `writeFront` fills them. */
	positions: Float32Array
	/** The line's segments (start and end per vertex), shared with the GPU buffer. */
	segments: Float32Array
	segmentBuffer: InterleavedBuffer
	glowPositions: Float32Array
	lineMaterial: LineMaterial
	glowMaterial: MeshBasicMaterial
}

/** The closed line and the glow fan sharing the front's vertices (the fan adds the centre as vertex 0). */
const createFrontObjects = (): FrontObjects => {
	const positions = new Float32Array(FRONT_VERTICES * 3)
	const segments = new Float32Array(FRONT_VERTICES * 6)
	const lineGeometry = new LineSegmentsGeometry()
	// uses `segments` itself as the instance buffer, so rewriting it updates the line
	lineGeometry.setPositions(segments)
	const segmentBuffer = (
		lineGeometry.attributes.instanceStart as unknown as {
			data: InterleavedBuffer
		}
	).data
	const lineMaterial = new LineMaterial({
		color: new Color(FRONT_COLOR).getHex(),
		linewidth: FRONT_WIDTH_PX,
		transparent: true,
		depthWrite: false,
	})
	const line = new LineSegments2(lineGeometry, lineMaterial)
	line.frustumCulled = false
	line.renderOrder = 2

	const glowPositions = new Float32Array((FRONT_VERTICES + 1) * 3)
	const colors = new Float32Array((FRONT_VERTICES + 1) * 4)
	const color = new Color(FRONT_COLOR)
	for (let v = 0; v <= FRONT_VERTICES; v++) {
		colors[v * 4] = color.r
		colors[v * 4 + 1] = color.g
		colors[v * 4 + 2] = color.b
		colors[v * 4 + 3] = v === 0 ? 0 : 1
	}
	const indices: number[] = []
	for (let v = 0; v < FRONT_VERTICES; v++) {
		indices.push(0, v + 1, ((v + 1) % FRONT_VERTICES) + 1)
	}
	const glowGeometry = new BufferGeometry()
	glowGeometry.setAttribute("position", new BufferAttribute(glowPositions, 3))
	glowGeometry.setAttribute("color", new BufferAttribute(colors, 4))
	glowGeometry.setIndex(indices)
	const glowMaterial = new MeshBasicMaterial({
		vertexColors: true,
		transparent: true,
		depthWrite: false,
		side: DoubleSide,
		opacity: GLOW_OPACITY,
	})
	const glow = new Mesh(glowGeometry, glowMaterial)
	glow.frustumCulled = false
	glow.renderOrder = 1
	return {
		line,
		glow,
		positions,
		segments,
		segmentBuffer,
		glowPositions,
		lineMaterial,
		glowMaterial,
	}
}

const centre = new Float64Array(3)
const labelPoint = new Float64Array(3)

/**
 * Per frame: the front's vertices, the glow fan and the point the label
 * rides on (`label`, scene units). `fade` (0..1) fades the whole front out
 * once it has left the planets behind (#38). Returns whether anything is
 * drawn.
 */
export function updateFront(
	frame: SimFrame,
	source: FrontSource,
	pulse: LightPulse,
	towardIndex: number,
	objects: FrontObjects,
	state: FrontState,
	label: Vector3,
	fade = 1,
): boolean {
	const radiusKm = frontRadiusKm(pulse.emitJD, frame.jd)
	writeFront(frame, source, radiusKm, objects.positions, state)
	state.opacity *= fade
	state.visible &&= state.opacity > 0
	objects.line.visible = state.visible
	objects.glow.visible = state.visible
	if (!state.visible) return false

	const { originKm } = frame
	// the glow fan: the source's point as drawn in the middle, then the front
	frontPointDisplayKm(frame, source, state.anchor, 0, 0, centre)
	objects.glowPositions[0] = toUnits(centre[0] - originKm[0])
	objects.glowPositions[1] = toUnits(centre[1] - originKm[1])
	objects.glowPositions[2] = toUnits(centre[2] - originKm[2])
	objects.glowPositions.set(objects.positions, 3)
	const { positions, segments } = objects
	for (let v = 0; v < FRONT_VERTICES; v++) {
		const next = ((v + 1) % FRONT_VERTICES) * 3
		segments[v * 6] = positions[v * 3]
		segments[v * 6 + 1] = positions[v * 3 + 1]
		segments[v * 6 + 2] = positions[v * 3 + 2]
		segments[v * 6 + 3] = positions[next]
		segments[v * 6 + 4] = positions[next + 1]
		segments[v * 6 + 5] = positions[next + 2]
	}
	objects.segmentBuffer.needsUpdate = true
	objects.glow.geometry.attributes.position.needsUpdate = true
	objects.lineMaterial.opacity = state.opacity
	objects.glowMaterial.opacity = GLOW_OPACITY * state.opacity

	// the label rides on the front where it heads for the next body it reaches
	const t = towardIndex * 3
	const theta = Math.atan2(
		frame.positionsKm[t + 2] - source.origin[2],
		frame.positionsKm[t] - source.origin[0],
	)
	frontPointDisplayKm(frame, source, state.anchor, radiusKm, theta, labelPoint)
	label.set(
		toUnits(labelPoint[0] - originKm[0]),
		toUnits(labelPoint[1] - originKm[1]),
		toUnits(labelPoint[2] - originKm[2]),
	)
	return true
}

const disposeFront = (objects: FrontObjects): void => {
	objects.line.geometry.dispose()
	objects.glow.geometry.dispose()
	objects.lineMaterial.dispose()
	objects.glowMaterial.dispose()
}

/**
 * Index of the body the label heads for: the nearest target the light has not
 * reached yet, else the farthest one.
 */
export function nextTarget(
	frame: SimFrame,
	source: FrontSource,
	targets: readonly number[],
	radiusKm: number,
): number {
	let toward = targets[targets.length - 1] ?? source.root
	let best = Infinity
	for (const i of targets) {
		const o = i * 3
		const d = Math.hypot(
			frame.positionsKm[o] - source.origin[0],
			frame.positionsKm[o + 1] - source.origin[1],
			frame.positionsKm[o + 2] - source.origin[2],
		)
		if (d > radiusKm && d < best) {
			best = d
			toward = i
		}
	}
	return toward
}

/** The whole per-frame update: front, glow, and where and how much the label shows. */
function drawFront(
	frame: SimFrame,
	pulse: LightPulse | null,
	source: FrontSource | null,
	targets: readonly number[],
	objects: FrontObjects,
	state: FrontState,
	label: FrontLabelAnchor,
): void {
	let shown = false
	if (pulse !== null && source !== null) {
		const toward = nextTarget(
			frame,
			source,
			targets,
			frontRadiusKm(pulse.emitJD, frame.jd),
		)
		const { opacity } = flashState(
			secondsSince(pulse.emitJD, frame.jd),
			pastPlanetsSeconds(pulse),
		)
		shown = updateFront(
			frame,
			source,
			pulse,
			toward,
			objects,
			state,
			label.position,
			opacity,
		)
	} else {
		objects.line.visible = false
		objects.glow.visible = false
	}
	label.shown = shown
	label.opacity = shown ? state.opacity : 0
}

/** Stops a click on the label's button from reaching the scene underneath (a click on empty space clears the selection). */
const keepFromScene = (event: { stopPropagation: () => void }) =>
	event.stopPropagation()

/**
 * The label on the front: "Light · 4 min 12 s" ("Beyond the planets · …" once
 * it has passed them), refreshed 10 times a second, with a button that stops
 * the flash right where it is (#38). DOM beside the Canvas, on the label
 * board's `slot`: the label layout places and fades it (#74, ./frontLabel.ts),
 * and its inside fades with the front (`anchor.opacity`). The button is part
 * of the label's box, never over its words, so the layout keeps every other
 * name off it too; on touch it is a 44 px target (#62).
 */
export function FrontLabelLayer({
	board,
	slot,
	anchor,
	frame,
}: {
	board: LabelBoard
	slot: number
	anchor: FrontLabelAnchor
	frame: SimFrame
}) {
	const i18n = useI18n()
	const pulse = useLightStore((state) => state.pulse)
	const contentRef = useRef<HTMLSpanElement>(null)
	const textRef = useRef<HTMLSpanElement>(null)
	useEffect(() => {
		if (pulse === null) return
		let opacity = ""
		let length = -1
		const write = () => {
			if (textRef.current === null || contentRef.current === null) return
			const seconds = secondsSince(pulse.emitJD, frame.jd)
			const { phase } = flashState(seconds, pastPlanetsSeconds(pulse))
			const text = i18n.t(
				phase === "leaving"
					? "solarSystem.light.frontLabelLeaving"
					: "solarSystem.light.frontLabel",
				{ duration: formatDuration(seconds, i18n, true) },
			)
			if (textRef.current.textContent !== text) {
				textRef.current.textContent = text
				// a new width only with a new length (tabular digits: another
				// number of them, "Beyond the planets"); measuring forces a layout
				if (text.length !== length) {
					length = text.length
					measureLabel(board, slot)
				}
			}
			const next = String(Math.round(anchor.opacity * 20) / 20)
			if (next !== opacity) {
				contentRef.current.style.opacity = next
				opacity = next
			}
		}
		write()
		const timer = setInterval(write, 100)
		return () => clearInterval(timer)
	}, [pulse, frame, i18n, board, slot, anchor])
	if (pulse === null) return null
	const stop = i18n.t("solarSystem.light.stop")
	return (
		// over the canvas, under the HUD panels (later in the page)
		<div className={labelClasses.layer}>
			<span
				ref={(element) => {
					attachLabel(board, slot, element)
					if (element !== null) measureLabel(board, slot)
				}}
				className={classes.label}
				data-light-front-label
			>
				<span ref={contentRef} className={classes.content}>
					<span ref={textRef} data-light-front-text />
					<Hint text={i18n.t("solarSystem.light.stopHint")}>
						<button
							type="button"
							className={classes.stop}
							aria-label={stop}
							data-light-front-stop
							onPointerDown={keepFromScene}
							onPointerUp={keepFromScene}
							onClick={(event) => {
								event.stopPropagation()
								useLightStore.getState().clear()
							}}
						>
							<IconX size={12} stroke={2.5} />
						</button>
					</Hint>
				</span>
			</span>
		</div>
	)
}

/** The front and its glow, in the Canvas; `label` is where its label rides (`FrontLabelLayer`). */
function LightFront({ label }: { label: FrontLabelAnchor }) {
	const frame = useSimFrame()
	const pulse = useLightStore((state) => state.pulse)
	const objects = useMemo(() => createFrontObjects(), [])
	const state = useMemo<FrontState>(
		() => ({ visible: false, opacity: 0, anchor: 0 }),
		[],
	)
	const source = useMemo(() => {
		if (pulse === null) return null
		const emitter = frame.index.get(pulse.emitterId)
		if (emitter === undefined) return null
		return frontSource(frame.bodies, frame.index, emitter, pulse.emitJD)
	}, [pulse, frame])
	const targets = useMemo(
		() =>
			pulse === null
				? []
				: pulseTargetIds(pulse.emitterId).map((id) => frame.index.get(id)!),
		[pulse, frame],
	)

	useEffect(() => () => disposeFront(objects), [objects])
	// no front drawn, no label: the scene is left
	useEffect(
		() => () => {
			label.shown = false
		},
		[label],
	)

	useFrame(() =>
		drawFront(frame, pulse, source, targets, objects, state, label),
	)

	return (
		<>
			<primitive object={objects.glow} />
			<primitive object={objects.line} />
		</>
	)
}

export default LightFront
