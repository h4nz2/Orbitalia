/**
 * Everything spacecraft inside the Canvas (issue #35, docs/ARCHITECTURE.md,
 * "Spacecraft"): moves the CraftFrame on with the SimFrame every frame, then
 * draws the paths, the models (#73) and the markers, in that order (the
 * models decide each frame how far every diamond has given way to its
 * model). The names are laid out with the bodies' (./craftLabels.ts) and
 * written by ./SpacecraftLabelLayer.tsx.
 *
 * The trajectories (about 0.5 MB) are fetched the first time the layer is
 * shown (#73), which is also the first time a craft is chosen
 * (`selectCraft` shows the layer, a craft link or a follow link included),
 * so a visit that never shows a craft downloads none of it.
 */
import { useEffect } from "react"
import { useFrame } from "@react-three/fiber"

import { useSpacecraftStore } from "@/store/spacecraft"

import type { LabelLayout } from "../labels/layout"
import type { SimFrame } from "../scene/simFrame"
import {
	CRAFT_FRAME_PRIORITY,
	updateCraftFrame,
	type CraftFrame,
} from "./craftFrame"
import CraftMarkers from "./CraftMarkers"
import CraftModels from "./CraftModels"
import CraftPaths from "./CraftPaths"
import { loadTrajectories } from "./trajectories"

export interface SpacecraftSceneProps {
	frame: SimFrame
	craftFrame: CraftFrame
	labels?: { layout: LabelLayout; firstSlot: number }
}

function SpacecraftScene({ frame, craftFrame, labels }: SpacecraftSceneProps) {
	// the trajectories arrive when the layer is first shown (a separate chunk)
	useEffect(() => {
		const load = ({ showSpacecraft }: { showSpacecraft: boolean }) => {
			if (showSpacecraft) void loadTrajectories()
		}
		load(useSpacecraftStore.getState())
		return useSpacecraftStore.subscribe(load)
	}, [])
	useFrame(() => updateCraftFrame(craftFrame, frame), CRAFT_FRAME_PRIORITY)
	return (
		<>
			<CraftPaths frame={frame} craftFrame={craftFrame} />
			<CraftModels frame={frame} craftFrame={craftFrame} />
			<CraftMarkers frame={frame} craftFrame={craftFrame} labels={labels} />
		</>
	)
}

export default SpacecraftScene
