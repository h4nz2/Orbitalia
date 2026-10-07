/**
 * The solar system Canvas (docs/ARCHITECTURE.md, "Rendering"). Creates the
 * SimFrame once and shares it below; SimClock is the only writer, everything
 * else reads it in its own useFrame. Effects (Bloom) arrive in Phase 6.
 * No three.js lights: the Sun lights every body through the sunlight model
 * (../lighting, docs/ARCHITECTURE.md, "Lighting"). The body labels are DOM
 * beside the Canvas (labels/LabelLayer.tsx), laid out by labels/Labels.tsx
 * inside it; both share one label board.
 */
import { Suspense, useMemo } from "react"
import { Canvas } from "@react-three/fiber"

import { bodies } from "@/data"
import { useScaleStore } from "@/store/scale"
import { useSimStore } from "@/store/sim"

import Bodies from "../bodies/Bodies"
import OrbitLines from "../bodies/OrbitLines"
import CameraRig from "../camera/CameraRig"
import { CAMERA_FAR, CAMERA_FOV_DEG, CAMERA_NEAR } from "../camera/framing"
import Corona from "../events/Corona"
import ReferenceFrameSync from "../frame/ReferenceFrameSync"
import Trails from "../frame/Trails"
import HuntSpotTracker from "../hunt/HuntSpotTracker"
import IntroPulseTracker from "../intro/IntroPulseTracker"
import { createLabelBoard } from "../labels/board"
import LabelLayer from "../labels/LabelLayer"
import Labels from "../labels/Labels"
import LightFront from "../light/LightFront"
import SceneCapture from "../postcard/SceneCapture"
import DprSync from "../present/DprSync"
import SoundProbe from "../sound/SoundProbe"
import { labelSlotCount } from "../labels/project"
import Belts from "../smallBodies/Belts"
import CometTails from "../smallBodies/CometTails"
import { createCraftFrame } from "../spacecraft/craftFrame"
import { createCraftLabels } from "../spacecraft/craftLabels"
import SpacecraftLabelLayer from "../spacecraft/SpacecraftLabelLayer"
import SpacecraftScene from "../spacecraft/SpacecraftScene"
import BodyPicking, { activateBody } from "./BodyPicking"
import HighlightTracker from "./HighlightTracker"
import HoverCursor from "./HoverCursor"
import Markers from "./Markers"
import ScaleSync from "./ScaleSync"
import ScaleTransition from "./ScaleTransition"
import SimClock from "./SimClock"
import SpinClock from "./SpinClock"
import { SimFrameContext, createSimFrame } from "./simFrame"

export const SCENE_BACKGROUND = "#0b0d12"

function Scene() {
	const frame = useMemo(
		() =>
			createSimFrame(
				bodies,
				useSimStore.getState().simTimeJD,
				useScaleStore.getState().scale,
			),
		[],
	)
	// spacecraft (#35): their own frame, and their names after the bodies' label slots
	const craftFrame = useMemo(() => createCraftFrame(frame), [frame])
	const craftSlot = labelSlotCount(bodies.length)
	const labels = useMemo(
		() => createLabelBoard(craftSlot + craftFrame.craft.length),
		[craftSlot, craftFrame],
	)
	const craftLabels = useMemo(
		() => createCraftLabels(frame, craftFrame, craftSlot),
		[frame, craftFrame, craftSlot],
	)

	return (
		<>
			<Canvas
				dpr={[1, 2]}
				gl={{ logarithmicDepthBuffer: true, antialias: true }}
				camera={{
					near: CAMERA_NEAR,
					far: CAMERA_FAR,
					fov: CAMERA_FOV_DEG,
					position: [0, 20000, 20000],
				}}
				style={{ position: "absolute", inset: 0 }}
			>
				<color attach="background" args={[SCENE_BACKGROUND]} />
				<DprSync />
				<SimFrameContext.Provider value={frame}>
					<ScaleSync />
					<ScaleTransition />
					<ReferenceFrameSync />
					<SimClock />
					<SpinClock />
					<HoverCursor />
					<Suspense fallback={null}>
						<Bodies />
					</Suspense>
					<Corona />
					<OrbitLines />
					<Trails />
					<Markers />
					<Belts />
					<CometTails />
					<LightFront />
					<SpacecraftScene
						frame={frame}
						craftFrame={craftFrame}
						labels={{ layout: labels.layout, firstSlot: craftSlot }}
					/>
					<Labels
						board={labels}
						onActivate={activateBody}
						extension={craftLabels}
					/>
					<BodyPicking />
					<CameraRig />
					<HighlightTracker />
					<IntroPulseTracker />
					<HuntSpotTracker />
					<SceneCapture />
					<SoundProbe />
				</SimFrameContext.Provider>
			</Canvas>
			<LabelLayer board={labels} />
			<SpacecraftLabelLayer board={labels} firstSlot={craftSlot} />
		</>
	)
}

export default Scene
