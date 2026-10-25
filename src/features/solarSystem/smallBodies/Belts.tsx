/**
 * The asteroid belt and the Kuiper belt (#23): one Points object per belt, each dot on
 * its own Kepler orbit, moved and scaled on the GPU (beltShader.ts), plus the belt's name
 * written on it in wide views. Shown with the "Small bodies" layer. The name is placed by
 * the label layout with every other name in the scene (#74, ./beltLabels.ts); this only
 * puts its element on the label board.
 *
 * Honest by construction: a dot is a few pixels whatever the zoom, so flying into the
 * belt never turns it into the rock field of the films; it stays a sparse scatter, and the
 * HUD note (SmallBodiesNote.tsx) says how many real asteroids each dot stands for and how
 * far apart they are.
 */
import { useEffect, useMemo } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import {
	BufferAttribute,
	BufferGeometry,
	NormalBlending,
	Points,
	ShaderMaterial,
} from "three"

import { belts, bodyById, type Belt } from "@/data"
import { useI18n } from "@/i18n"
import { rootIndexOf } from "@/sim"
import { generateBeltOrbits } from "@/sim/belts"
import { useSimStore } from "@/store/sim"

import { attachLabel, measureLabel, type LabelBoard } from "../labels/board"
import { FRAME_BLEND_SLOTS, useSimFrame } from "../scene/simFrame"
import { beltFragmentShader, beltVertexShader } from "./beltShader"
import {
	createBeltUniforms,
	hexToRgb,
	updateBeltUniforms,
	type BeltUniforms,
} from "./belts"

import classes from "./SmallBodies.module.css"

/** Where the belts' names go on the label board: the slot of the first belt's (./beltLabels.ts). */
export interface BeltLabelSlots {
	board: LabelBoard
	firstSlot: number
}

const createBeltPoints = (belt: Belt): Points => {
	const parent = bodyById.get(belt.parentId)
	const orbits = generateBeltOrbits(belt, parent?.massKg ?? 1.989e30)
	const geometry = new BufferGeometry()
	// three needs a position attribute for the draw count; the shader ignores it
	geometry.setAttribute(
		"position",
		new BufferAttribute(new Float32Array(orbits.count * 3), 3),
	)
	geometry.setAttribute("aOrbit", new BufferAttribute(orbits.elements, 4))
	geometry.setAttribute("aPeriapsis", new BufferAttribute(orbits.periapsis, 3))
	geometry.setAttribute("aAhead", new BufferAttribute(orbits.ahead, 3))
	const material = new ShaderMaterial({
		uniforms: {
			...createBeltUniforms(hexToRgb(belt.color), FRAME_BLEND_SLOTS),
		},
		vertexShader: beltVertexShader,
		fragmentShader: beltFragmentShader,
		transparent: true,
		depthWrite: false,
		blending: NormalBlending,
	})
	const points = new Points(geometry, material)
	points.frustumCulled = false
	points.name = `belt-${belt.id}`
	return points
}

/** The belt's name element (plain DOM beside the canvas, removed with a guard on unmount). */
const createBeltLabel = (beltId: string): HTMLSpanElement => {
	const label = document.createElement("span")
	label.className = classes.beltLabel
	label.dataset.belt = beltId
	label.dataset.visible = "false"
	label.setAttribute("aria-hidden", "true")
	return label
}

/**
 * Puts the belt's name beside the canvas with its text, on the label board's `slot`, and
 * measures it; returns the clean-up, which takes it off the board and removes it only while
 * it is still attached (the canvas's host may be gone when the page is left).
 */
export function attachBeltLabel(
	label: HTMLSpanElement,
	canvas: HTMLCanvasElement,
	text: string,
	slots: BeltLabelSlots | undefined,
	slot: number,
): () => void {
	label.textContent = text
	canvas.parentElement?.appendChild(label)
	if (slots !== undefined) {
		attachLabel(slots.board, slot, label)
		measureLabel(slots.board, slot)
	}
	return () => {
		if (slots !== undefined) attachLabel(slots.board, slot, null)
		label.parentNode?.removeChild(label)
	}
}

function BeltField({
	belt,
	labels,
	slot,
}: {
	belt: Belt
	labels: BeltLabelSlots | undefined
	slot: number
}) {
	const frame = useSimFrame()
	const { t } = useI18n()
	const points = useMemo(() => createBeltPoints(belt), [belt])
	const root = useMemo(() => rootIndexOf(frame.bodies), [frame])
	const gl = useThree((state) => state.gl)
	const text = t("solarSystem.smallBodies.beltName", { belt: belt.id })
	const label = useMemo(() => createBeltLabel(belt.id), [belt.id])

	useEffect(
		() => attachBeltLabel(label, gl.domElement, text, labels, slot),
		[label, gl, text, labels, slot],
	)

	useEffect(
		() => () => {
			points.geometry.dispose()
			;(points.material as ShaderMaterial).dispose()
		},
		[points],
	)

	useFrame(() =>
		updateBeltUniforms(
			(points.material as ShaderMaterial).uniforms as unknown as BeltUniforms,
			frame,
			root,
			gl.getPixelRatio(),
		),
	)

	return <primitive object={points} />
}

/** The belts, while the "Small bodies" layer is on; their names on the label board's `labels` slots. */
function Belts({ labels }: { labels?: BeltLabelSlots }) {
	const show = useSimStore((state) => state.showSmallBodies)
	if (!show) return null
	return (
		<>
			{belts.map((belt, k) => (
				<BeltField
					key={belt.id}
					belt={belt}
					labels={labels}
					slot={(labels?.firstSlot ?? 0) + k}
				/>
			))}
		</>
	)
}

export default Belts
