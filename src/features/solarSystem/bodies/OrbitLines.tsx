/**
 * An OrbitLine for every orbiting body while `showOrbits` is on; moon orbits
 * by the same rule as the moons themselves (`isBodyShown`); the focus's orbit
 * is always drawn. An asteroid's orbit (#23) only while it is the focus or
 * the selection: seven lines stacked in the belt would only hide the belt.
 */
import type { Body } from "@/data"
import { allMoonsShown, isBodyShown, useSimStore } from "@/store/sim"

import { useSimFrame } from "../scene/simFrame"
import OrbitLine from "./OrbitLine"

/** Whether a shown body's orbit line is drawn: every one but an asteroid's that is not focused or selected. */
export const isOrbitDrawn = (
	body: Pick<Body, "id" | "kind">,
	focusId: string,
	selectedId: string | null,
): boolean =>
	body.kind !== "asteroid" || body.id === focusId || body.id === selectedId

function OrbitLines() {
	const frame = useSimFrame()
	const showOrbits = useSimStore((state) => state.showOrbits)
	const showMoons = useSimStore((state) => state.showMoons)
	const showAllMoons = useSimStore(allMoonsShown)
	const focusId = useSimStore((state) => state.focusId)
	const selectedId = useSimStore((state) => state.selectedId)
	const showSmallBodies = useSimStore((state) => state.showSmallBodies)

	if (!showOrbits) return null

	return (
		<>
			{frame.bodies.map((body, index) => {
				if (body.orbit === null || body.parentId === null) return null
				if (
					!isBodyShown(body, {
						showMoons,
						showAllMoons,
						focusId,
						showSmallBodies,
					})
				) {
					return null
				}
				if (!isOrbitDrawn(body, focusId, selectedId)) return null
				const parentIndex = frame.index.get(body.parentId)
				if (parentIndex === undefined) return null
				return (
					<OrbitLine
						key={body.id}
						body={body}
						index={index}
						parentIndex={parentIndex}
					/>
				)
			})}
		</>
	)
}

export default OrbitLines
