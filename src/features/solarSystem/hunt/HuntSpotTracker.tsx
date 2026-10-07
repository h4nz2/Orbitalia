/**
 * Places the Easy hints' overlay (./spot.ts) over the answer every frame,
 * after the camera director has moved the camera: the area of the sky for
 * the first hint, a pulsing ring for the second. Renders nothing.
 */
import { useFrame, useThree } from "@react-three/fiber"

import { applyRing, placeRing } from "../scene/highlight"
import { useSimFrame } from "../scene/simFrame"
import { areaPlacement, huntSpot } from "./spot"

function HuntSpotTracker() {
	const frame = useSimFrame()
	const size = useThree((state) => state.size)

	useFrame(({ camera }) => {
		const element = huntSpot.element
		if (element === null) return
		const target = huntSpot.target
		const index = target === null ? undefined : frame.index.get(target.bodyId)
		if (target === null || index === undefined) {
			applyRing(element, null)
			return
		}
		camera.updateMatrixWorld()
		const ring = placeRing(frame, index, camera, size.width, size.height)
		if (element.dataset.kind !== target.kind) element.dataset.kind = target.kind
		applyRing(
			element,
			ring === null || target.kind === "pulse"
				? ring
				: areaPlacement(ring, target.seed, size.width, size.height),
		)
	})

	return null
}

export default HuntSpotTracker
