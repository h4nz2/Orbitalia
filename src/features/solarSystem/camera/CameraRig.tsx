/**
 * Mounts the camera's single owner (docs/ARCHITECTURE.md, "Navigation"): one
 * camera-controls instance for the pointer, wheel and touch gestures, and the
 * CameraDirector that drives it and the render origin from the navigation
 * slice of the store. The controls are created here rather than through drei's
 * <CameraControls>, whose own useFrame would update them before the director
 * has placed the origin; the director calls `update` itself, once per frame at
 * CAMERA_FRAME_PRIORITY.
 */
import { useEffect, useMemo } from "react"
import { CameraControlsImpl } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import {
	Box3,
	MathUtils,
	Matrix4,
	PerspectiveCamera,
	Quaternion,
	Raycaster,
	Sphere,
	Spherical,
	Vector2,
	Vector3,
	Vector4,
} from "three"

import { useHudStore } from "@/store/hud"
import { useSimStore } from "@/store/sim"

import { useSimFrame } from "../scene/simFrame"
import { createCraftLocator, type CraftFrame } from "../spacecraft/craftFrame"
import { MotionWatch } from "./motion"
import { exposeDebugHandle } from "./debugHandle"
import { CAMERA_FRAME_PRIORITY, CameraDirector } from "./director"
import {
	PAN_ENABLED,
	configureInput,
	pinchAsDolly,
	shiftDragPans,
} from "./input"

// camera-controls needs the three.js classes it uses handed to it once
// (what drei's <CameraControls> does on mount)
CameraControlsImpl.install({
	THREE: {
		Box3,
		MathUtils: { clamp: MathUtils.clamp },
		Matrix4,
		Quaternion,
		Raycaster,
		Sphere,
		Spherical,
		Vector2,
		Vector3,
		Vector4,
	},
})

export interface CameraRigProps {
	/** The spacecraft (#35), which the camera can follow (#57). */
	craftFrame?: CraftFrame
}

function CameraRig({ craftFrame }: CameraRigProps) {
	const frame = useSimFrame()
	const camera = useThree((state) => state.camera)
	const gl = useThree((state) => state.gl)
	const connected = useThree((state) => state.events.connected) as
		HTMLElement | null | undefined
	const domElement = connected ?? gl.domElement

	const controls = useMemo(() => new CameraControlsImpl(camera), [camera])
	const director = useMemo(
		() =>
			camera instanceof PerspectiveCamera
				? new CameraDirector(
						controls,
						camera,
						frame,
						useSimStore,
						undefined,
						craftFrame === undefined
							? null
							: createCraftLocator(craftFrame, frame),
					)
				: null,
		[camera, controls, frame, craftFrame],
	)

	useEffect(() => {
		configureInput(controls, { pan: PAN_ENABLED })
		const removePinch = pinchAsDolly(controls, domElement)
		const removeShiftPan = PAN_ENABLED
			? shiftDragPans(controls, domElement)
			: () => undefined
		controls.connect(domElement)
		return () => {
			controls.disconnect()
			removePinch()
			removeShiftPan()
		}
	}, [controls, domElement])
	useEffect(() => () => controls.dispose(), [controls])

	useEffect(() => {
		if (director === null) return
		director.attach()
		const hide = exposeDebugHandle(director, gl.domElement)
		return () => {
			hide()
			director.detach()
		}
	}, [director, gl])

	// the quiet interface (#42) dims its secondary controls while the camera moves
	const motion = useMemo(() => new MotionWatch(), [])
	// camera-controls' distance and angles, read through getters (nothing allocated per frame)
	const pose = useMemo(
		() => ({
			get distance() {
				return controls.distance
			},
			get azimuth() {
				return controls.azimuthAngle
			},
			get polar() {
				return controls.polarAngle
			},
		}),
		[controls],
	)
	useEffect(() => () => useHudStore.getState().setCameraMoving(false), [])

	useFrame((_state, delta) => {
		const now = performance.now()
		director?.tick(now, delta)
		useHudStore
			.getState()
			.setCameraMoving(
				motion.update(now, pose, useSimStore.getState().transition !== null),
			)
	}, CAMERA_FRAME_PRIORITY)

	return null
}

export default CameraRig
