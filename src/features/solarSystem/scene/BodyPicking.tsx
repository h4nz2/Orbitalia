/**
 * The scene's one click and hover target (docs/ARCHITECTURE.md, "Picking";
 * #16). An invisible object whose raycast asks `pickBody` which body the
 * pointer is aimed at, with generous targets for small bodies, and otherwise
 * reports "empty space" far behind everything, so a click that hits nothing
 * else in the scene lands here too:
 *
 * - a tap on a body selects it and flies there (`setFocus`), or flies back to
 *   the close-up of the focus after the camera was dollied far out;
 * - a tap on empty space is the way out (`emptyClickAction`);
 * - while an Easy hunt clue is on screen (#52) small targets are larger
 *   (`EASY_TARGET_FACTOR`) and a tap on empty space does nothing;
 * - hovering sets `hoverId` for the pointer cursor and the highlight ring,
 *   never while a button is held (an orbit drag) or for a finger.
 *
 * A drag never counts (`isTapEvent`).
 */
import { useCallback, useRef } from "react"
import { useThree, type ThreeEvent } from "@react-three/fiber"
import {
	PerspectiveCamera,
	Vector3,
	type Group,
	type Intersection,
	type Raycaster,
} from "three"

import { useHuntStore } from "@/store/hunt"
import { isBodyShown, useSimStore } from "@/store/sim"

import { CAMERA_FAR } from "../camera/framing"
import { isMoonDotShown } from "./Markers"
import {
	EASY_TARGET_FACTOR,
	NEAR_MISS_FACTOR,
	TARGET_RADIUS_PX,
	bodyClickAction,
	emptyClickAction,
	hasGenerousTarget,
	isNearAnyBody,
	pickBody,
	pixelsPerUnitAtDistanceOne,
} from "./picking"
import { useSimFrame } from "./simFrame"
import { currentPointerKind, isTapEvent } from "./tap"

/**
 * A click or tap on body `id`, on the body itself or on its label (#20):
 * select it and fly there, or back to the close-up of a far-away focus.
 */
export function activateBody(id: string): void {
	const store = useSimStore.getState()
	switch (bodyClickAction(store, id)) {
		case "focus":
			store.setFocus(id)
			return
		case "reframe":
			store.focus(id, { shot: { distance: 1 } })
			return
		case "select":
			store.select(id)
			return
		case "none":
			return
	}
}

/** The index an intersection carries for empty space. */
const EMPTY = -1

function BodyPicking() {
	const frame = useSimFrame()
	const heightPx = useThree((state) => state.size.height)
	/** Whether the last ray into empty space passed close to a body. */
	const nearMiss = useRef(false)
	const groupRef = useRef<Group>(null)

	const raycast = useCallback(
		(raycaster: Raycaster, hits: Intersection[]) => {
			const group = groupRef.current
			const camera = raycaster.camera
			if (group === null) return
			if (!(camera instanceof PerspectiveCamera)) return
			const state = useSimStore.getState()
			const { bodies } = frame
			const focusIndex = frame.index.get(state.focusId)
			const focusParentId =
				focusIndex === undefined ? null : bodies[focusIndex].parentId
			const isShown = (i: number) => isBodyShown(bodies[i], state)
			const pxPerUnit = pixelsPerUnitAtDistanceOne(camera, heightPx)
			const targetRadiusPx =
				TARGET_RADIUS_PX[currentPointerKind()] *
				(useHuntStore.getState().assist ? EASY_TARGET_FACTOR : 1)
			const { origin, direction } = raycaster.ray
			const pick = pickBody(frame, origin, direction, {
				pxPerUnit,
				targetRadiusPx,
				isShown,
				hasTarget: (i, discPx) =>
					hasGenerousTarget(
						bodies[i],
						discPx,
						state.showMarkers &&
							isMoonDotShown(bodies[i], state.focusId, focusParentId),
					),
			})
			if (pick === null) {
				nearMiss.current = isNearAnyBody(
					frame,
					origin,
					direction,
					pxPerUnit,
					targetRadiusPx * NEAR_MISS_FACTOR,
					isShown,
				)
			}
			const distance = pick?.distance ?? CAMERA_FAR
			hits.push({
				distance,
				point: new Vector3()
					.copy(direction)
					.multiplyScalar(distance)
					.add(origin),
				index: pick?.index ?? EMPTY,
				object: group,
			})
		},
		[frame, heightPx],
	)

	const bodyIdOf = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
		const index = event.index ?? EMPTY
		return index === EMPTY ? null : (frame.bodies[index]?.id ?? null)
	}

	const onClick = (event: ThreeEvent<MouseEvent>) => {
		if (!isTapEvent(event)) return
		event.stopPropagation()
		const store = useSimStore.getState()
		const id = bodyIdOf(event)
		if (id !== null) {
			activateBody(id)
			return
		}
		const forgiven = nearMiss.current || useHuntStore.getState().assist
		switch (emptyClickAction(store, forgiven)) {
			case "deselect":
				store.select(null)
				return
			case "reset":
				store.reset()
				return
			case "none":
				return
		}
	}

	const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
		// something nearer (a label) is under the pointer and owns the hover
		if (event.intersections[0]?.eventObject !== groupRef.current) return
		const hovering =
			currentPointerKind() !== "touch" && event.nativeEvent.buttons === 0
		useSimStore.getState().setHover(hovering ? bodyIdOf(event) : null)
	}
	const onPointerOut = () => useSimStore.getState().setHover(null)

	return (
		<group
			ref={groupRef}
			raycast={raycast}
			onClick={onClick}
			onPointerMove={onPointerMove}
			onPointerOut={onPointerOut}
		/>
	)
}

export default BodyPicking
