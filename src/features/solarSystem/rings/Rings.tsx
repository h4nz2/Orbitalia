/**
 * A planet's rings (issue #12; docs/ARCHITECTURE.md, "Rings"). Rendered as a
 * child of BodyMesh's pole-frame group, so they lie in the equator and follow
 * the axial tilt but never the spin. The annulus is built in planet radii and
 * scaled every frame by the planet's drawn radius, exactly like the sphere:
 * rings keep their true proportion to the planet in every scale preset
 * (`displayBodyLengthKm`) and can never detach from it. Exactly edge-on the
 * sheet covers no pixel, so a thin rim (`RING_EDGE`) draws the line real rings
 * make, fading out as soon as the sheet opens up.
 */
import { use, useEffect, useMemo, useRef } from "react"
import { useFrame, type ThreeEvent } from "@react-three/fiber"
import {
	CylinderGeometry,
	RingGeometry,
	type Mesh,
	type ShaderMaterial,
} from "three"

import { useSimStore } from "@/store/sim"

import type { SunlightUniforms } from "../lighting/bodyLighting"
import { createRingMaterial } from "../lighting/ringMaterial"
import { activateBody } from "../scene/BodyPicking"
import { useSimFrame } from "../scene/simFrame"
import { currentPointerKind, isTapEvent } from "../scene/tap"
import { loadRingTextures, type RingData } from "./ringTextures"

/** Segments around the ring: smooth edges on a ring filling the screen. */
export const RING_SEGMENTS = 256

/** The rings' inner and outer radius in planet radii: the unit the annulus is built in. */
export const ringRadiiInBodyRadii = (
	rings: Pick<RingData, "innerRadiusKm" | "outerRadiusKm">,
	radiusKm: number,
): [number, number] => [
	rings.innerRadiusKm / radiusKm,
	rings.outerRadiusKm / radiusKm,
]

/**
 * A flat annulus in the XZ plane (the pole frame's equator), in planet radii.
 * Its outer polygon circumscribes the outer circle and the shader cuts the
 * exact edges by radius, so both edges stay round up close.
 */
export function createRingGeometry(
	rings: Pick<RingData, "innerRadiusKm" | "outerRadiusKm">,
	radiusKm: number,
	segments = RING_SEGMENTS,
): RingGeometry {
	const [inner, outer] = ringRadiiInBodyRadii(rings, radiusKm)
	const geometry = new RingGeometry(
		inner,
		outer / Math.cos(Math.PI / segments),
		segments,
		1,
	)
	return geometry.rotateX(-Math.PI / 2)
}

/**
 * The edge-on rim: an open cylinder at the outer radius, y in -1..1 (the shader
 * flattens it into the ring plane and extrudes it a pixel or two along the pole).
 */
export function createRingEdgeGeometry(
	rings: Pick<RingData, "outerRadiusKm">,
	radiusKm: number,
	segments = RING_SEGMENTS,
): CylinderGeometry {
	const outer = rings.outerRadiusKm / radiusKm
	return new CylinderGeometry(outer, outer, 2, segments, 1, true)
}

const noRaycast = () => undefined

/** One frame: both meshes at the planet's drawn radius, the rim's pixel size current. */
export function updateRings(
	sheet: Mesh | null,
	edge: Mesh | null,
	edgeMaterial: ShaderMaterial,
	scale: number,
	viewportHeight: number,
): void {
	sheet?.scale.setScalar(scale)
	edge?.scale.setScalar(scale)
	edgeMaterial.uniforms.uViewportHeight.value = viewportHeight
}

export interface RingsProps {
	rings: RingData
	radiusKm: number
	/** the planet's index in the SimFrame */
	index: number
	/** the planet's id: a click on the rings is a click on it */
	bodyId: string
	/** the planet's sunlight uniforms (shared, never copied) */
	uniforms: SunlightUniforms
}

function Rings({ rings, radiusKm, index, bodyId, uniforms }: RingsProps) {
	const frame = useSimFrame()
	const meshRef = useRef<Mesh>(null)
	const edgeRef = useRef<Mesh>(null)
	const textures = use(loadRingTextures(rings))
	const geometry = useMemo(
		() => createRingGeometry(rings, radiusKm),
		[rings, radiusKm],
	)
	const edgeGeometry = useMemo(
		() => createRingEdgeGeometry(rings, radiusKm),
		[rings, radiusKm],
	)
	const [material, edgeMaterial] = useMemo(() => {
		const options = {
			uniforms,
			color: textures.color,
			peak: textures.peak,
			innerRadiusKm: rings.innerRadiusKm,
			outerRadiusKm: rings.outerRadiusKm,
		}
		return [
			createRingMaterial(options),
			createRingMaterial({ ...options, edge: true }),
		]
	}, [uniforms, textures, rings])
	useEffect(
		() => () => {
			geometry.dispose()
			edgeGeometry.dispose()
		},
		[geometry, edgeGeometry],
	)
	useEffect(
		() => () => {
			material.dispose()
			edgeMaterial.dispose()
		},
		[material, edgeMaterial],
	)

	useFrame((state) =>
		updateRings(
			meshRef.current,
			edgeRef.current,
			edgeMaterial,
			frame.renderRadius(index),
			state.size.height * state.viewport.dpr,
		),
	)

	// the rings are nearer than BodyPicking's "empty space": a click on them is
	// a click on their planet (never one on empty space), and so is hovering
	const onClick = (event: ThreeEvent<MouseEvent>) => {
		if (!isTapEvent(event)) return
		event.stopPropagation()
		activateBody(bodyId)
	}
	const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
		if (event.intersections[0]?.eventObject !== event.eventObject) return
		const hovering =
			currentPointerKind() !== "touch" && event.nativeEvent.buttons === 0
		useSimStore.getState().setHover(hovering ? bodyId : null)
	}
	const onPointerOut = () => {
		const store = useSimStore.getState()
		if (store.hoverId === bodyId) store.setHover(null)
	}

	return (
		<>
			<mesh
				ref={meshRef}
				geometry={geometry}
				material={material}
				scale={frame.renderRadius(index)}
				onClick={onClick}
				onPointerMove={onPointerMove}
				onPointerOut={onPointerOut}
			/>
			<mesh
				ref={edgeRef}
				geometry={edgeGeometry}
				material={edgeMaterial}
				scale={frame.renderRadius(index)}
				raycast={noRaycast}
			/>
		</>
	)
}

export default Rings
