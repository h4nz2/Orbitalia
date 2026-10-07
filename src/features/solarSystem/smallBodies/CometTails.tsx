/**
 * Comets' comas and tails in the scene (#23), rewritten every frame from the SimFrame
 * (cometTail.ts): they grow as a comet falls toward the Sun, shrink as it leaves, and
 * always point away from the Sun, so on the way out the tail goes first. Drawn for
 * every shown body that has a `tail` in the data (data, not kind, decides).
 */
import { useEffect, useMemo } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	CanvasTexture,
	Color,
	DoubleSide,
	Group,
	Mesh,
	MeshBasicMaterial,
	PerspectiveCamera,
	Sprite,
	SpriteMaterial,
	type Camera,
	type Texture,
} from "three"

import type { Body } from "@/data"
import { isBodyShown, useSimStore } from "@/store/sim"

import { pixelsPerUnitAtDistanceOne } from "../scene/picking"
import { useSimFrame } from "../scene/simFrame"
import {
	TAIL_SAMPLES,
	comaGrowth,
	createTailFrame,
	tailAlpha,
	tailBrightness,
	type TailFrame,
	writeRibbon,
	writeTail,
} from "./cometTail"

/** The gas tail: straight away from the Sun, glowing blue. */
export const ION_COLOR = "#4d8dff"
/** The dust tail: sunlight on dust, yellowish white. */
export const DUST_COLOR = "#ffe2a8"
export const ION_OPACITY = 0.7
export const DUST_OPACITY = 0.5
/** Never thinner on screen than this (px), so a tail reads from far away. */
export const ION_MIN_PX = 1.5
export const DUST_MIN_PX = 3
/** Half width at the tail's end, as a share of its drawn length. */
export const ION_WIDTH_SHARE = 0.015
export const DUST_WIDTH_SHARE = 0.06
/** The coma is never smaller on screen than this radius (px) while the comet is active. */
export const COMA_MIN_PX = 3

let comaTexture: Texture | null = null
/** A soft round glow, drawn once and shared by every coma. */
const getComaTexture = (): Texture => {
	if (comaTexture !== null) return comaTexture
	const size = 64
	const canvas = document.createElement("canvas")
	canvas.width = size
	canvas.height = size
	const context = canvas.getContext("2d")
	if (context !== null) {
		const gradient = context.createRadialGradient(
			size / 2,
			size / 2,
			0,
			size / 2,
			size / 2,
			size / 2,
		)
		gradient.addColorStop(0, "rgba(255,255,255,1)")
		gradient.addColorStop(0.25, "rgba(210,235,255,0.55)")
		gradient.addColorStop(1, "rgba(160,200,255,0)")
		context.fillStyle = gradient
		context.fillRect(0, 0, size, size)
	}
	comaTexture = new CanvasTexture(canvas)
	return comaTexture
}

export interface TailObjects {
	group: Group
	mesh: Mesh
	coma: Sprite
	positions: Float32Array
	colors: Float32Array
}

/** Two ribbons (gas, then dust) of TAIL_SAMPLES x 2 vertices each, and the coma sprite. */
const createTailObjects = (): TailObjects => {
	const vertices = 2 * TAIL_SAMPLES * 2
	const positions = new Float32Array(vertices * 3)
	const colors = new Float32Array(vertices * 4)
	const indices: number[] = []
	for (let tail = 0; tail < 2; tail++) {
		const base = tail * TAIL_SAMPLES * 2
		for (let k = 0; k < TAIL_SAMPLES - 1; k++) {
			const a = base + k * 2
			indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
		}
	}
	const ion = new Color(ION_COLOR)
	const dust = new Color(DUST_COLOR)
	for (let tail = 0; tail < 2; tail++) {
		const color = tail === 0 ? ion : dust
		const opacity = tail === 0 ? ION_OPACITY : DUST_OPACITY
		for (let k = 0; k < TAIL_SAMPLES; k++) {
			const alpha = opacity * tailAlpha(k)
			for (let side = 0; side < 2; side++) {
				const v = ((tail * TAIL_SAMPLES + k) * 2 + side) * 4
				colors[v] = color.r
				colors[v + 1] = color.g
				colors[v + 2] = color.b
				colors[v + 3] = alpha
			}
		}
	}
	const geometry = new BufferGeometry()
	geometry.setAttribute("position", new BufferAttribute(positions, 3))
	geometry.setAttribute("color", new BufferAttribute(colors, 4))
	geometry.setIndex(indices)
	const mesh = new Mesh(
		geometry,
		new MeshBasicMaterial({
			vertexColors: true,
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
			side: DoubleSide,
		}),
	)
	mesh.frustumCulled = false
	mesh.renderOrder = 1
	const coma = new Sprite(
		new SpriteMaterial({
			map: getComaTexture(),
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
		}),
	)
	coma.frustumCulled = false
	coma.renderOrder = 1
	const group = new Group()
	group.add(mesh, coma)
	return { group, mesh, coma, positions, colors }
}

/**
 * Per frame: the tail's state from the SimFrame, both ribbons facing the camera and the
 * coma round the nucleus, all as bright as the comet is active. Hides everything while the
 * comet is asleep.
 */
export function updateCometTail(
	frame: Parameters<typeof writeTail>[0],
	index: number,
	tail: TailFrame,
	objects: TailObjects,
	camera: Camera,
	heightPx: number,
): void {
	writeTail(frame, index, tail)
	objects.group.visible = tail.visible
	if (!tail.visible) return
	const pxPerUnit =
		camera instanceof PerspectiveCamera
			? pixelsPerUnitAtDistanceOne(camera, heightPx)
			: 0
	const eye = camera.position
	writeRibbon(
		tail.ion,
		tail.ionUnits,
		ION_WIDTH_SHARE,
		tail.comaUnits,
		ION_MIN_PX,
		eye,
		pxPerUnit,
		objects.positions,
		0,
	)
	writeRibbon(
		tail.dust,
		tail.dustUnits,
		DUST_WIDTH_SHARE,
		tail.comaUnits,
		DUST_MIN_PX,
		eye,
		pxPerUnit,
		objects.positions,
		TAIL_SAMPLES * 6,
	)
	objects.mesh.geometry.attributes.position.needsUpdate = true
	;(objects.mesh.material as MeshBasicMaterial).opacity = tailBrightness(
		tail.activity,
	)
	// the coma: its drawn size, but never less than a few pixels while active
	const head = tail.head
	const distance = Math.hypot(eye.x - head[0], eye.y - head[1], eye.z - head[2])
	const minRadius = pxPerUnit > 0 ? (COMA_MIN_PX * distance) / pxPerUnit : 0
	const growth = comaGrowth(tail.activity)
	const radius = Math.max(tail.comaUnits, minRadius * growth)
	objects.coma.position.set(head[0], head[1], head[2])
	objects.coma.scale.setScalar(2 * radius)
	objects.coma.material.opacity = growth
}

function CometTail({ index }: { index: number }) {
	const frame = useSimFrame()
	const objects = useMemo(() => createTailObjects(), [])
	const tail = useMemo(() => createTailFrame(), [])
	const heightPx = useThree((state) => state.size.height)

	useEffect(
		() => () => {
			objects.mesh.geometry.dispose()
			;(objects.mesh.material as MeshBasicMaterial).dispose()
			objects.coma.material.dispose()
		},
		[objects],
	)

	useFrame(({ camera }) =>
		updateCometTail(frame, index, tail, objects, camera, heightPx),
	)

	return <primitive object={objects.group} />
}

/** A tail for every shown body with `tail` data (the comets). */
function CometTails() {
	const frame = useSimFrame()
	const showMoons = useSimStore((state) => state.showMoons)
	const showAllMoons = useSimStore((state) => state.showAllMoons)
	const focusId = useSimStore((state) => state.focusId)
	const showSmallBodies = useSimStore((state) => state.showSmallBodies)
	return (
		<>
			{frame.bodies.map((body: Body, index) =>
				body.tail !== undefined &&
				isBodyShown(body, {
					showMoons,
					showAllMoons,
					focusId,
					showSmallBodies,
				}) ? (
					<CometTail key={body.id} index={index} />
				) : null,
			)}
		</>
	)
}

export default CometTails
