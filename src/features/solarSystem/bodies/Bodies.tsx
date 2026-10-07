/**
 * Every body as a BodyMesh, keyed by id; moons by the curation rule
 * (`isBodyShown`: featured moons while `showMoons` is on, the long tail with
 * `showAllMoons` too unless the scale hides it, the focus always).
 */
import { allMoonsShown, isBodyShown, useSimStore } from "@/store/sim"

import { useSimFrame } from "../scene/simFrame"
import BodyMesh from "./BodyMesh"

function Bodies() {
	const frame = useSimFrame()
	const showMoons = useSimStore((state) => state.showMoons)
	const showAllMoons = useSimStore(allMoonsShown)
	const focusId = useSimStore((state) => state.focusId)
	const showSmallBodies = useSimStore((state) => state.showSmallBodies)

	return (
		<>
			{frame.bodies.map((body, index) =>
				isBodyShown(body, {
					showMoons,
					showAllMoons,
					focusId,
					showSmallBodies,
				}) ? (
					<BodyMesh key={body.id} body={body} index={index} />
				) : null,
			)}
		</>
	)
}

export default Bodies
