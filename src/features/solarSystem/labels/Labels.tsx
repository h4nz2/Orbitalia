/**
 * The labels' frame loop and hit testing, inside the Canvas (docs/ARCHITECTURE.md,
 * "Labels"). Every frame it lays out the names from the SimFrame and the camera
 * (./project.ts, ./layout.ts) and writes them into the DOM layer
 * (./LabelLayer.tsx). The layer itself never takes pointer events, so drags
 * and wheel zooms that start on a label still move the camera; instead this
 * component joins the scene's picking with a raycast that hit-tests the label
 * boxes in screen space. A label therefore behaves exactly like its body: the
 * pointer cursor, hover, and a tap (not a drag) that activates it. The HUD
 * panels (`.panel` of SolarSystem.module.css) are areas labels keep out of,
 * and so is everything in the dock whatever its own class (#74: the birthday
 * panel brings its own) and the whole of a phone's sheet (#60), its handle's
 * strip included (#62: no name drawn over what a link opened).
 */
import { useCallback, useMemo, useRef } from "react"
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber"
import {
	PerspectiveCamera,
	Vector3,
	type Group,
	type Intersection,
	type Raycaster,
} from "three"

import { useSimStore } from "@/store/sim"

import { useSimFrame } from "../scene/simFrame"
import { isTapEvent } from "../scene/tap"
import { focusBodyFromLabel, type LabelActivateHandler } from "./activate"
import {
	hideLabels,
	keepOutSelector,
	measureKeepOut,
	writeLabels,
	type LabelBoard,
} from "./board"
import { fadeLabels, pickLabel, staticLabelRanks } from "./layout"
import { createOrbitAnchorCache } from "./orbitAnchor"
import {
	fillLabelLayout,
	labelSlotCount,
	slotBody,
	type LabelExtension,
} from "./project"

import hudClasses from "../SolarSystem.module.css"

export interface LabelsProps {
	board: LabelBoard
	/** What a tap on a label does; default: what a tap on the body does (./activate.ts). */
	onActivate?: LabelActivateHandler
	/** Labels of things that are not bodies (spacecraft, #35; belts and the light flash, #74) in the same layout; they pick themselves. */
	extensions?: readonly LabelExtension[]
}

const pointer = new Vector3()
/** How often the HUD panels' rectangles are re-read, s. */
const KEEP_OUT_INTERVAL_S = 0.25
const KEEP_OUT = keepOutSelector(hudClasses.panel)

function Labels({
	board,
	onActivate = focusBodyFromLabel,
	extensions,
}: LabelsProps) {
	const frame = useSimFrame()
	const groupRef = useRef<Group>(null)
	const hidden = useRef(false)
	const sinceKeepOut = useRef(Infinity)
	const canvas = useThree((state) => state.gl.domElement)
	const size = useThree((state) => state.size)
	const ranks = useMemo(() => staticLabelRanks(frame.bodies), [frame.bodies])
	const orbitCache = useMemo(
		() => createOrbitAnchorCache(frame.bodies.length),
		[frame.bodies],
	)
	const { layout } = board

	useFrame(({ camera }, delta) => {
		const state = useSimStore.getState()
		if (!state.showLabels || !(camera instanceof PerspectiveCamera)) {
			if (!hidden.current) hideLabels(board)
			hidden.current = true
			return
		}
		hidden.current = false
		sinceKeepOut.current += delta
		if (sinceKeepOut.current >= KEEP_OUT_INTERVAL_S) {
			sinceKeepOut.current = 0
			measureKeepOut(board, canvas, KEEP_OUT)
		}
		camera.updateMatrixWorld()
		fillLabelLayout(
			layout,
			frame,
			camera,
			size.width,
			size.height,
			state,
			ranks,
			orbitCache,
			extensions,
		)
		fadeLabels(layout, delta)
		writeLabels(board)
	})

	const raycast = useCallback(
		(raycaster: Raycaster, intersects: Intersection[]) => {
			const group = groupRef.current
			const camera = raycaster.camera
			if (group === null || !camera || !useSimStore.getState().showLabels) {
				return
			}
			const { origin, direction } = raycaster.ray
			pointer.copy(origin).add(direction).project(camera)
			const slot = pickLabel(
				layout,
				((pointer.x + 1) / 2) * layout.viewportWidth,
				((1 - pointer.y) / 2) * layout.viewportHeight,
			)
			// an extension's labels (after the bodies' and orbits') are not bodies
			if (slot < 0 || slot >= labelSlotCount(frame.bodies.length)) return
			// in front of everything: the label is drawn over the scene
			intersects.push({
				distance: 0,
				point: origin.clone(),
				index: slotBody(slot, frame.bodies.length),
				object: group,
			})
		},
		[layout, frame.bodies.length],
	)

	const bodyIdAt = (event: ThreeEvent<MouseEvent | PointerEvent>) => {
		const index = event.index
		return index === undefined ? null : (frame.bodies[index]?.id ?? null)
	}
	const onClick = (event: ThreeEvent<MouseEvent>) => {
		if (!isTapEvent(event)) return
		const id = bodyIdAt(event)
		if (id === null) return
		event.stopPropagation()
		onActivate(id)
	}
	const onPointerOver = (event: ThreeEvent<PointerEvent>) => {
		const id = bodyIdAt(event)
		if (id === null) return
		event.stopPropagation()
		useSimStore.getState().setHover(id)
	}
	const onPointerOut = (event: ThreeEvent<PointerEvent>) => {
		const store = useSimStore.getState()
		if (store.hoverId !== null && store.hoverId === bodyIdAt(event)) {
			store.setHover(null)
		}
	}

	return (
		<group
			ref={groupRef}
			raycast={raycast}
			onClick={onClick}
			onPointerOver={onPointerOver}
			onPointerOut={onPointerOut}
		/>
	)
}

export default Labels
