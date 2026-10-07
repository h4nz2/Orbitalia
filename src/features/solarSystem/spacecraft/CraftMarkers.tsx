/**
 * Spacecraft markers (issue #35): one Points layer, a screen-sized diamond per
 * craft in space, in the spacecraft colour, so a craft can never be mistaken
 * for a natural body (round dots, white, grey or yellow). A craft whose
 * mission has ended but which still flies (Pioneer 10 and 11) is drawn
 * dimmer. Picking is angular, like the bodies' dots: hovering names the craft,
 * a tap selects it (and shows it in the info panel).
 */
import { useCallback, useLayoutEffect, useMemo, useRef } from "react"
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber"
import {
	PerspectiveCamera,
	Vector3,
	type Intersection,
	type Points,
	type Raycaster,
} from "three"

import { toUnits } from "@/sim"
import { useSimStore } from "@/store/sim"
import { useSpacecraftStore } from "@/store/spacecraft"

import { pickLabel, type LabelLayout } from "../labels/layout"
import { applyHoverCursor } from "../scene/HoverCursor"
import type { SimFrame } from "../scene/simFrame"
import { isTapEvent } from "../scene/tap"
import type { CraftFrame } from "./craftFrame"
import {
	CRAFT_MARKER_SIZE_PX,
	craftOnScreen,
	pixelsPerUnit,
	type ScreenPoint,
} from "./screen"

/** The spacecraft colour (markers, names, paths): a cyan no body uses. */
export const CRAFT_COLOR: readonly [number, number, number] = [0.4, 0.9, 1]
/**
 * Pointer radius (px) that hits a craft's diamond, for every pointer. Smaller
 * than a body's generous target (#16: 24 px for a finger): a craft hit wins
 * over everything behind it, so a tap aimed beside a small planet must not
 * land on a craft near it. Natural bodies come first.
 */
export const CRAFT_PICK_RADIUS_PX = 12

/** A silent craft (mission over, still flying) is drawn at this brightness. */
export const SILENT_DIM = 0.5

/** Diamond points with an anti-aliased edge and a dark outline, so they read on bright planets too. */
const diamondPoints = (shader: { fragmentShader: string }) => {
	shader.fragmentShader = shader.fragmentShader.replace(
		"#include <color_fragment>",
		`#include <color_fragment>
	vec2 craftUv = abs( gl_PointCoord - 0.5 ) * 2.0;
	float craftD = craftUv.x + craftUv.y;
	float craftW = fwidth( craftD );
	diffuseColor.a *= clamp( 0.5 + ( 1.0 - craftD ) / craftW, 0.0, 1.0 );
	diffuseColor.rgb *= mix( 1.0, 0.25, smoothstep( 0.62, 0.78, craftD ) );
	if ( diffuseColor.a <= 0.0 ) discard;`,
	)
}

export interface CraftMarkerBuffers {
	positions: Float32Array
	colors: Float32Array
	/** craft index behind each drawn vertex */
	vertexCraft: Int32Array
	/** whether craft k was shown last frame (hysteresis of the clearance rule) */
	shown: Uint8Array
}

export const createCraftMarkerBuffers = (
	count: number,
): CraftMarkerBuffers => ({
	positions: new Float32Array(count * 3),
	colors: new Float32Array(count * 3),
	vertexCraft: new Int32Array(count),
	shown: new Uint8Array(count),
})

const point: ScreenPoint = { x: 0, y: 0, depth: 0 }

/**
 * Compacts the craft shown this frame into the buffers and returns how many
 * vertices to draw (see `craftOnScreen` for the rule).
 */
export function fillCraftMarkers(
	buffers: CraftMarkerBuffers,
	frame: SimFrame,
	craftFrame: CraftFrame,
	camera: PerspectiveCamera,
	widthPx: number,
	heightPx: number,
	always: { selected: string | null; hovered: string | null },
): number {
	const { positions, colors, vertexCraft, shown } = buffers
	let drawn = 0
	for (let k = 0; k < craftFrame.craft.length; k++) {
		const id = craftFrame.craft[k].id
		const visible =
			craftFrame.present[k] === 1 &&
			craftOnScreen(
				frame,
				craftFrame,
				k,
				camera,
				widthPx,
				heightPx,
				id === always.selected || id === always.hovered,
				shown[k] === 1,
				point,
			)
		shown[k] = visible ? 1 : 0
		if (!visible) continue
		const state = craftFrame.states[k]
		const v = drawn * 3
		positions[v] = toUnits(state.displayKm[0] - frame.originKm[0])
		positions[v + 1] = toUnits(state.displayKm[1] - frame.originKm[1])
		positions[v + 2] = toUnits(state.displayKm[2] - frame.originKm[2])
		const dim = craftFrame.phases[k] === "silent" ? SILENT_DIM : 1
		colors[v] = CRAFT_COLOR[0] * dim
		colors[v + 1] = CRAFT_COLOR[1] * dim
		colors[v + 2] = CRAFT_COLOR[2] * dim
		vertexCraft[drawn] = k
		drawn++
	}
	return drawn
}

/** The drawn vertex nearest the ray within `radiusPx`, or -1. */
export function pickCraftMarker(
	positions: Float32Array,
	drawn: number,
	origin: Vector3,
	direction: Vector3,
	anglePerPx: number,
	radiusPx: number,
): number {
	const pickTanSq = (radiusPx * anglePerPx) ** 2
	let best = -1
	let bestTanSq = pickTanSq
	for (let v = 0; v < drawn; v++) {
		const o = v * 3
		const dx = positions[o] - origin.x
		const dy = positions[o + 1] - origin.y
		const dz = positions[o + 2] - origin.z
		const along = dx * direction.x + dy * direction.y + dz * direction.z
		if (along <= 0) continue
		const perpSq = Math.max(0, dx * dx + dy * dy + dz * dz - along * along)
		const tanSq = perpSq / (along * along)
		if (tanSq < bestTanSq) {
			best = v
			bestTanSq = tanSq
		}
	}
	return best
}

export interface CraftMarkersProps {
	frame: SimFrame
	craftFrame: CraftFrame
	/** The label layout holding the craft names from `firstLabelSlot` on: a name is as clickable as its marker. */
	labels?: { layout: LabelLayout; firstSlot: number }
}

const pointer = new Vector3()

function CraftMarkers({ frame, craftFrame, labels }: CraftMarkersProps) {
	const pointsRef = useRef<Points>(null)
	const size = useThree((state) => state.size)
	const canvas = useThree((state) => state.gl.domElement)
	const count = craftFrame.craft.length
	const buffers = useMemo(() => createCraftMarkerBuffers(count), [count])

	useFrame(({ camera }) => {
		const points = pointsRef.current
		if (points === null || !(camera instanceof PerspectiveCamera)) return
		const craftState = useSpacecraftStore.getState()
		const drawn = craftState.showSpacecraft
			? fillCraftMarkers(
					buffers,
					frame,
					craftFrame,
					camera,
					size.width,
					size.height,
					{
						selected: craftState.selectedCraftId,
						hovered: craftState.hoverCraftId,
					},
				)
			: 0
		const geometry = points.geometry
		geometry.setDrawRange(0, drawn)
		geometry.attributes.position.needsUpdate = true
		geometry.attributes.color.needsUpdate = true
	})

	// the pointer cursor over a craft (the bodies' cursor is scene/HoverCursor.tsx)
	useLayoutEffect(() => {
		const unsubscribe = useSpacecraftStore.subscribe((state, previous) => {
			if (state.hoverCraftId === previous.hoverCraftId) return
			if (state.hoverCraftId !== null) canvas.style.cursor = "pointer"
			else applyHoverCursor(canvas, useSimStore.getState())
		})
		return () => {
			unsubscribe()
			useSpacecraftStore.getState().setHoverCraft(null)
		}
	}, [canvas])

	const raycast = useCallback(
		(raycaster: Raycaster, intersects: Intersection[]) => {
			const points = pointsRef.current
			const camera = raycaster.camera
			if (points === null || !(camera instanceof PerspectiveCamera)) return
			const { origin, direction } = raycaster.ray
			// a craft's name first: it is drawn over everything
			if (labels !== undefined && useSimStore.getState().showLabels) {
				const { layout, firstSlot } = labels
				pointer.copy(origin).add(direction).project(camera)
				const slot = pickLabel(
					layout,
					((pointer.x + 1) / 2) * layout.viewportWidth,
					((1 - pointer.y) / 2) * layout.viewportHeight,
				)
				if (slot >= firstSlot && slot < firstSlot + count) {
					intersects.push({
						distance: 0,
						point: origin.clone(),
						index: slot - firstSlot,
						object: points,
					})
					return
				}
			}
			const drawn = Math.min(points.geometry.drawRange.count, count)
			const best = pickCraftMarker(
				buffers.positions,
				drawn,
				origin,
				direction,
				1 / pixelsPerUnit(camera, size.height),
				CRAFT_PICK_RADIUS_PX,
			)
			if (best < 0) return
			const o = best * 3
			const hit = new Vector3(
				buffers.positions[o],
				buffers.positions[o + 1],
				buffers.positions[o + 2],
			)
			intersects.push({
				// drawn over everything (no depth test), so it is hit before any body
				// target or #16's "empty space"
				distance: 0,
				point: hit,
				index: buffers.vertexCraft[best],
				object: points,
			})
		},
		[buffers, count, size.height, labels],
	)

	const craftIdAt = (event: ThreeEvent<MouseEvent | PointerEvent>) => {
		const index = event.index
		return index === undefined ? null : (craftFrame.craft[index]?.id ?? null)
	}

	return (
		<points
			ref={pointsRef}
			frustumCulled={false}
			renderOrder={2}
			raycast={raycast}
			onClick={(event) => {
				if (!isTapEvent(event)) return
				const id = craftIdAt(event)
				if (id === null) return
				event.stopPropagation()
				// choosing a spacecraft is a step of the view history (#46)
				useSimStore.getState().markStep()
				useSpacecraftStore.getState().selectCraft(id)
			}}
			onPointerOver={(event) => {
				const id = craftIdAt(event)
				if (id === null) return
				event.stopPropagation()
				useSpacecraftStore.getState().setHoverCraft(id)
			}}
			onPointerOut={(event) => {
				const store = useSpacecraftStore.getState()
				if (
					store.hoverCraftId !== null &&
					store.hoverCraftId === craftIdAt(event)
				) {
					store.setHoverCraft(null)
				}
			}}
		>
			<bufferGeometry>
				<bufferAttribute
					attach="attributes-position"
					args={[buffers.positions, 3]}
				/>
				<bufferAttribute attach="attributes-color" args={[buffers.colors, 3]} />
			</bufferGeometry>
			<pointsMaterial
				size={CRAFT_MARKER_SIZE_PX}
				sizeAttenuation={false}
				vertexColors
				transparent
				depthTest={false}
				depthWrite={false}
				onBeforeCompile={diamondPoints}
			/>
		</points>
	)
}

export default CraftMarkers
