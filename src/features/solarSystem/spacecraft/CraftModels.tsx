/**
 * The spacecraft as themselves (issue #73, docs/ARCHITECTURE.md,
 * "Spacecraft", Models in the scene): NASA's model of a craft (#72) in place
 * of its diamond wherever the model would be seen, always for the selected
 * or followed craft, drawn far bigger than the craft is (./modelSize.ts) and
 * facing the way it faces (./attitude.ts).
 *
 * Every frame, for every craft in space and on screen: the size rule picks
 * the model's drawn length and whether it beats the diamond; a model that
 * does is fetched the first time (./modelCache.ts) and cross-fades with the
 * diamond (`MODEL_FADE_S`, none with reduced motion) once it has arrived
 * and its shaders are compiled (`precompile`, so its first frame does not
 * stall the scene). Until then, and for good if it fails, the diamond stays. True scale shows
 * only diamonds (a model at true size would be invisible, and true scale
 * stays true). What it decides goes to the CraftFrame (`modelBlend`,
 * `modelRadiusPx`, `modelCorePx`: the diamonds fade, the names move aside, a
 * tap on the model's core selects), to the card (./drawnSize.ts) and to the page
 * (./modelProbe.ts); nothing goes through React state.
 *
 * Light: the scene has no three.js lights (the bodies' sunlight is a shader
 * of its own, ../lighting), and the models are the only lit materials, so
 * their light lives here: a point light where the Sun is drawn (from the
 * viewer with "Always lit"), and a small generated room reflected as fill,
 * so metal foil (Europa Clipper's is fully metallic) shows its shape instead
 * of rendering black. High contrast (#29) raises the fill. No shadows or
 * eclipses: a craft in a planet's shadow stays lit.
 */
import { useEffect, useMemo } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import {
	Group,
	Matrix4,
	Mesh,
	PMREMGenerator,
	PerspectiveCamera,
	PointLight,
	Quaternion,
	Vector3,
	type Camera,
	type Material,
	type MeshStandardMaterial,
	type Scene,
	type Texture,
	type WebGLRenderer,
} from "three"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"

import { craftModels, type CraftModel } from "@/data/spacecraftModels"
import { isTrueScale, rootIndexOf, toKm, toUnits } from "@/sim"
import { isWatchedKind, watchPlan } from "@/sim/follow"
import { drawnPhaseAt, isoToJD } from "@/sim/spacecraft"
import { useLightingStore } from "@/store/lighting"
import { followedCraftId } from "@/store/navigation"
import { useScaleStore } from "@/store/scale"
import { isBodyShown, useSimStore } from "@/store/sim"
import { useSpacecraftStore } from "@/store/spacecraft"
import { useSpinStore } from "@/store/spin"

import { prefersReducedMotion, REDUCED_MOTION_QUERY } from "../present/media"
import type { SimFrame } from "../scene/simFrame"
import {
	advanceCraftSpin,
	craftAttitude,
	createCraftSpin,
	type CraftSpin,
} from "./attitude"
import { craftLengthScaleAt, type CraftFrame } from "./craftFrame"
import { publishCraftDrawn, type CraftDrawnAs } from "./drawnSize"
import { craftModelFile, peekModelFile } from "./modelCache"
import { reportCraftModel, type CraftModelState } from "./modelProbe"
import {
	DEFAULT_CORE_SHARE,
	bodyLimitKm,
	drawnFactor,
	modelSize,
	sizeBodiesOf,
	type ModelSize,
	type ModelView,
	type SizeBody,
} from "./modelSize"
import { craftOnScreen, pixelsPerUnit, type ScreenPoint } from "./screen"

/** The diamond and the model cross-fade over this long, s. */
export const MODEL_FADE_S = 0.2

/** The Sun's light on a model: Lambert like the bodies' `SUN_INTENSITY` (1.6), in three's physical units. */
const SUN_LIGHT = 1.6 * Math.PI
/** The generated room's reflections, as a share: enough to read metal and the night side, not a second sun. */
const FILL = 0.35
/** ... with high contrast (#29): the projector washes the dark parts out. */
const FILL_HIGH_CONTRAST = 0.7
/** ... with "Always lit": lit from the viewer, a little fill for the edges. */
const FILL_ALWAYS_LIT = 0.25

/** A craft's own copy of a loaded model. */
interface ModelInstance {
	readonly root: Group
	/** Its own materials (for its fade). */
	readonly materials: Material[]
	/** Its shaders are compiled (`precompile`): it may fade in without a stall. */
	ready: boolean
}

/** One craft's model in the scene. */
interface ModelSlot {
	/** Every model the craft wears, in time order (`craftModels`). */
	readonly models: readonly CraftModel[]
	/** Placed, turned and sized every frame; holds the model the craft wears now. */
	readonly holder: Group
	/** The craft's own copy of each model it has worn. */
	readonly instances: Map<string, ModelInstance>
	/** The model in `holder`, by id. */
	current: string | null
	/** 0 the diamond, 1 the model. */
	blend: number
	/** The size rule's answer last frame (its hysteresis), and the size it drew. */
	wasModel: boolean
	lengthUnits: number
	heightPx: number
	corePx: number
	/** Last frame's on-screen rule (its hysteresis). */
	shown: boolean
	/** Every model of the craft asked for (Cassini's two, preloaded together). */
	requested: boolean
	/** The model's axes (./attitude.ts), kept from frame to frame for the roll. */
	readonly basis: Float64Array
	spin: CraftSpin | null
	/**
	 * Its flybys and arrivals with a body to pass (`Passage`): the
	 * milestone's date (JD), the body, and the true instant of the closest
	 * approach, worked out the first time it is needed (NaN until then).
	 */
	readonly passages: {
		readonly jd: number
		readonly body: number
		trueJD: number
	}[]
}

export interface ModelRuntime {
	readonly slots: readonly ModelSlot[]
	readonly container: Group
	readonly light: PointLight
	/** The fill's reflections, made with the first model. */
	environment: Texture | null
	fill: number
	/** The bodies that limit a model's size near them, and how near (`sizeBodyReach`). */
	readonly sizeBodies: readonly SizeBody[]
	/** Those and every body a passage passes: whose layers are checked each frame ... */
	readonly limitBodies: Int32Array
	/** ... into this, per body: 1 while its layer is on (`isBodyShown`). */
	readonly shown: Uint8Array
	readonly root: number
	readonly earth: number
	/** prefers-reduced-motion, kept by a media listener. */
	instant: boolean
}

export function createModelRuntime(
	frame: SimFrame,
	craftFrame: CraftFrame,
): ModelRuntime {
	const container = new Group()
	container.name = "spacecraft models"
	const light = new PointLight(0xffffff, SUN_LIGHT, 0, 0)
	container.add(light)
	const slots = craftFrame.craft.map((craft): ModelSlot => {
		const holder = new Group()
		holder.name = craft.id
		holder.visible = false
		container.add(holder)
		return {
			models: craftModels(craft.id),
			holder,
			instances: new Map(),
			current: null,
			blend: 0,
			wasModel: false,
			lengthUnits: 0,
			heightPx: 0,
			corePx: 0,
			shown: false,
			requested: false,
			basis: new Float64Array(9),
			spin: null,
			passages: craft.events.flatMap((event) => {
				const body =
					event.target === undefined ? undefined : frame.index.get(event.target)
				return isWatchedKind(event.kind) && body !== undefined
					? [{ jd: isoToJD(event.date), body, trueJD: Number.NaN }]
					: []
			}),
		}
	})
	const sizeBodies = sizeBodiesOf(frame.bodies)
	const limitBodies = new Set(sizeBodies.map((body) => body.index))
	for (const slot of slots) {
		for (const passage of slot.passages) limitBodies.add(passage.body)
	}
	return {
		slots,
		container,
		light,
		environment: null,
		fill: FILL,
		sizeBodies,
		limitBodies: Int32Array.from(limitBodies),
		shown: new Uint8Array(frame.bodies.length),
		root: rootIndexOf(frame.bodies),
		earth: frame.index.get("earth") ?? rootIndexOf(frame.bodies),
		instant: prefersReducedMotion(),
	}
}

/** The craft's own copy of a loaded model: shared geometry and textures, its own materials (faded on their own). */
function instantiate(
	runtime: ModelRuntime,
	gl: WebGLRenderer,
	scene: Group,
): ModelInstance {
	if (runtime.environment === null) {
		const pmrem = new PMREMGenerator(gl)
		const room = new RoomEnvironment()
		runtime.environment = pmrem.fromScene(room, 0.04).texture
		room.dispose()
		pmrem.dispose()
	}
	const root = scene.clone(true)
	const materials: Material[] = []
	root.traverse((object) => {
		if (!(object instanceof Mesh)) return
		const own = (material: Material) => {
			const copy = material.clone() as MeshStandardMaterial
			copy.envMap = runtime.environment
			copy.envMapIntensity = runtime.fill
			// always in the transparent pass, so a fade never recompiles; at
			// opacity 1 it draws like an opaque model (depth written and tested),
			// double-sided parts in one pass rather than two
			copy.transparent = true
			copy.forceSinglePass = true
			materials.push(copy)
			return copy
		}
		object.material = Array.isArray(object.material)
			? object.material.map(own)
			: own(object.material as Material)
	})
	return { root, materials, ready: false }
}

/**
 * Compiles a new copy's shaders before it is shown, with the light it will
 * be drawn in, so its first frame on screen does not stall the scene (a
 * PBR shader takes a while to compile, longest in software WebGL): in the
 * background where the browser can (`compileAsync`), at once otherwise. The
 * diamond stays until then. A failure only costs that stall.
 */
function precompile(
	runtime: ModelRuntime,
	instance: ModelInstance,
	gl: WebGLRenderer,
	camera: Camera,
	scene: Scene,
): void {
	// the light is gathered from visible objects only: the container must be,
	// or the shaders would be compiled for a scene without it (and again later)
	const visible = runtime.container.visible
	runtime.container.visible = true
	try {
		if (typeof gl.compileAsync === "function") {
			const done = () => {
				instance.ready = true
			}
			gl.compileAsync(instance.root, camera, scene).then(done, done)
		} else {
			gl.compile(instance.root, camera, scene)
			instance.ready = true
		}
	} catch {
		instance.ready = true
	} finally {
		runtime.container.visible = visible
	}
}

/** The model of `models` worn at `jd` (`craftModelAt`, without a closure a frame). */
function modelAt(
	models: readonly CraftModel[],
	jd: number,
): CraftModel | undefined {
	for (let m = 0; m < models.length; m++) {
		if (jd >= models[m].fromJD && jd < models[m].untilJD) return models[m]
	}
	return undefined
}

const point: ScreenPoint = { x: 0, y: 0, depth: 0 }
const sizing: ModelSize = { lengthKm: 0, heightPx: 0, corePx: 0, model: false }
const seen: ModelView = {
	depthKm: 0,
	focalPx: 0,
	shortSidePx: 0,
	coreShare: DEFAULT_CORE_SHARE,
	chosen: false,
	sunDistanceKm: 0,
	bodyLimitKm: Infinity,
	wasModel: false,
}
const target = new Float64Array(3)
const basisMatrix = new Matrix4()
const spinTurn = new Quaternion()
const zAxis = new Vector3(0, 0, 1)
const xAxis = new Vector3()
const yAxis = new Vector3()
const scratch = new Vector3()

/**
 * The smallest length the bodies near craft `k` allow its model
 * (`bodyLimitKm`): its passages' closest approaches are worked out the first
 * time (Watch's `watchPlan`, from the true positions, so they hold in every
 * preset), and the drawing's phase (`drawnPhaseAt`) says how near it is to
 * them now.
 */
function craftBodyLimitKm(
	runtime: ModelRuntime,
	frame: SimFrame,
	craftFrame: CraftFrame,
	k: number,
): number {
	const trajectory = craftFrame.trajectories[k]
	const passages = runtime.slots[k].passages
	let phase = Number.NaN
	if (trajectory !== null && passages.length > 0) {
		for (let p = 0; p < passages.length; p++) {
			const entry = passages[p]
			if (Number.isNaN(entry.trueJD)) {
				entry.trueJD =
					watchPlan(trajectory, { jd: entry.jd, target: entry.body }, frame)
						?.trueJD ?? entry.jd
			}
		}
		phase = drawnPhaseAt(trajectory, frame.jd, frame)
	}
	return bodyLimitKm(
		craftFrame.states[k].displayKm,
		frame,
		runtime.sizeBodies,
		runtime.shown,
		passages,
		phase,
	)
}

const cameraKm = new Float64Array(3)

/**
 * Whether a planet, a big moon or the Sun stands between the camera and the
 * craft's centre (display km): the model is hidden behind it, and the
 * diamond, drawn over everything, shows where the craft is, as before #73.
 */
function isBehindBody(
	runtime: ModelRuntime,
	frame: SimFrame,
	craftKm: Float64Array,
): boolean {
	const dx = craftKm[0] - cameraKm[0]
	const dy = craftKm[1] - cameraKm[1]
	const dz = craftKm[2] - cameraKm[2]
	const length = Math.hypot(dx, dy, dz)
	if (!(length > 0)) return false
	for (let s = 0; s < runtime.sizeBodies.length; s++) {
		const i = runtime.sizeBodies[s].index
		if (runtime.shown[i] !== 1) continue
		const o = i * 3
		const bx = frame.displayKm[o] - cameraKm[0]
		const by = frame.displayKm[o + 1] - cameraKm[1]
		const bz = frame.displayKm[o + 2] - cameraKm[2]
		const along = (bx * dx + by * dy + bz * dz) / length
		const radius = frame.displayRadiiKm[i]
		const missSq = bx * bx + by * by + bz * bz - along * along
		if (along > 0 && missSq < radius * radius) {
			// where the line of sight enters the sphere, before the craft?
			if (along - Math.sqrt(radius * radius - missSq) < length) return true
		}
	}
	return false
}

/**
 * One frame of every craft's model (see the module comment): the size rule,
 * fetching, the fade, the pose, the light; then what the diamonds, the names,
 * the card and the page read.
 */
export function updateCraftModels(
	runtime: ModelRuntime,
	frame: SimFrame,
	craftFrame: CraftFrame,
	camera: PerspectiveCamera,
	gl: WebGLRenderer,
	scene: Scene,
	widthPx: number,
	heightPx: number,
	deltaS: number,
	nowMs: number,
): void {
	const crafts = useSpacecraftStore.getState()
	const sim = useSimStore.getState()
	const followed = followedCraftId(sim.view)
	const scale = useScaleStore.getState()
	// true scale stays true: diamonds only, from the click on
	const markersOnly = isTrueScale(frame.scale) || scale.targetId === "trueScale"
	const focalPx = pixelsPerUnit(camera, heightPx)
	const shortSidePx = Math.min(widthPx, heightPx)
	const fade = runtime.instant ? 1 : deltaS / MODEL_FADE_S
	const spinMode = useSpinStore.getState().mode
	const root = runtime.root * 3
	cameraKm[0] = frame.originKm[0] + toKm(camera.position.x)
	cameraKm[1] = frame.originKm[1] + toKm(camera.position.y)
	cameraKm[2] = frame.originKm[2] + toKm(camera.position.z)
	// which of the bodies that limit a model are on screen, once a frame
	for (let b = 0; b < runtime.limitBodies.length; b++) {
		const i = runtime.limitBodies[b]
		runtime.shown[i] = isBodyShown(frame.bodies[i], sim) ? 1 : 0
	}
	let anyDrawn = false
	let selectedAs: CraftDrawnAs = "none"
	let selectedFactor = 0

	for (let k = 0; k < craftFrame.craft.length; k++) {
		const slot = runtime.slots[k]
		const id = craftFrame.craft[k].id
		const chosen = id === crafts.selectedCraftId || id === followed
		const state = craftFrame.states[k]
		const present = crafts.showSpacecraft && craftFrame.present[k] === 1
		let drawn: CraftModelState = "diamond"
		let want = false
		const model = present ? modelAt(slot.models, frame.jd) : undefined
		slot.shown =
			present &&
			craftOnScreen(
				frame,
				craftFrame,
				k,
				camera,
				widthPx,
				heightPx,
				chosen || id === crafts.hoverCraftId,
				slot.shown,
				point,
			)
		if (present && slot.shown && !markersOnly && model !== undefined) {
			// not fetched yet: only once the rule wants the model
			const known = peekModelFile(model.url)
			seen.depthKm = toKm(point.depth)
			seen.focalPx = focalPx
			seen.shortSidePx = shortSidePx
			seen.coreShare = known?.coreShare ?? DEFAULT_CORE_SHARE
			seen.chosen = chosen
			seen.sunDistanceKm = Math.hypot(
				state.displayKm[0] - frame.displayKm[root],
				state.displayKm[1] - frame.displayKm[root + 1],
				state.displayKm[2] - frame.displayKm[root + 2],
			)
			seen.bodyLimitKm = craftBodyLimitKm(runtime, frame, craftFrame, k)
			seen.wasModel = slot.wasModel
			modelSize(seen, sizing)
			slot.wasModel = sizing.model
			if (sizing.model) {
				slot.lengthUnits = toUnits(sizing.lengthKm)
				slot.heightPx = sizing.heightPx
				slot.corePx = sizing.corePx
				if (!slot.requested) {
					// every model it wears, so Cassini drops Huygens without a wait
					for (const each of craftModels(id)) craftModelFile(each)
					slot.requested = true
				}
				const file = craftModelFile(model)
				if (isBehindBody(runtime, frame, state.displayKm)) {
					// hidden behind a planet: the diamond marks it
				} else if (file.state === "ready" && file.scene !== null) {
					let instance = slot.instances.get(model.id)
					if (instance === undefined) {
						instance = instantiate(runtime, gl, file.scene)
						slot.instances.set(model.id, instance)
						precompile(runtime, instance, gl, camera, scene)
					}
					// its shaders still compiling: the model it wore so far (Cassini
					// before Huygens' release) or the diamond a moment longer
					want = instance.ready || slot.current !== null
					drawn = want ? "model" : "loading"
				} else if (file.state === "loading") {
					drawn = "loading"
				}
			}
		} else {
			slot.wasModel = false
		}
		if (id === crafts.selectedCraftId) {
			selectedAs = !present ? "none" : drawn === "model" ? "model" : "marker"
			if (selectedAs === "model") {
				selectedFactor = drawnFactor(
					sizing.lengthKm,
					craftLengthScaleAt(craftFrame, frame, k),
					model!.sizeM,
				)
			}
		}

		slot.blend = want
			? Math.min(1, slot.blend + fade)
			: Math.max(0, slot.blend - fade)
		// a model fades out only where it was: hidden, gone or out of data, it goes at once
		if (!present || !slot.shown || model === undefined) slot.blend = 0
		craftFrame.modelBlend[k] = slot.blend
		craftFrame.modelRadiusPx[k] = 0.5 * slot.heightPx * slot.blend
		craftFrame.modelCorePx[k] = slot.corePx
		reportCraftModel(id, drawn, slot.heightPx, slot.corePx, nowMs)

		const holder = slot.holder
		holder.visible = slot.blend > 0
		if (!holder.visible || model === undefined) continue
		anyDrawn = true
		// the model it wears now, once compiled (Cassini's changes when Huygens
		// is released)
		const wears = slot.instances.get(model.id)
		if (wears?.ready === true && slot.current !== model.id) {
			holder.clear()
			holder.add(wears.root)
			slot.current = model.id
		}
		const instance =
			slot.current === null ? undefined : slot.instances.get(slot.current)
		holder.position.set(
			toUnits(state.displayKm[0] - frame.originKm[0]),
			toUnits(state.displayKm[1] - frame.originKm[1]),
			toUnits(state.displayKm[2] - frame.originKm[2]),
		)
		holder.scale.setScalar(slot.lengthUnits / model.sizeM)
		// +Z at Earth or the Sun as drawn, +Y towards ecliptic north
		const at = (model.points === "earth" ? runtime.earth : runtime.root) * 3
		target[0] = frame.displayKm[at] - state.displayKm[0]
		target[1] = frame.displayKm[at + 1] - state.displayKm[1]
		target[2] = frame.displayKm[at + 2] - state.displayKm[2]
		if (craftAttitude(target, slot.basis)) {
			const b = slot.basis
			basisMatrix.makeBasis(
				xAxis.set(b[0], b[1], b[2]),
				yAxis.set(b[3], b[4], b[5]),
				scratch.set(b[6], b[7], b[8]),
			)
			holder.quaternion.setFromRotationMatrix(basisMatrix)
		}
		if (model.spinRpm !== undefined) {
			slot.spin ??= createCraftSpin(frame.jd, nowMs)
			spinTurn.setFromAxisAngle(
				zAxis,
				advanceCraftSpin(slot.spin, frame.jd, nowMs, spinMode, model.spinRpm),
			)
			holder.quaternion.multiply(spinTurn)
		}
		if (instance !== undefined) {
			for (let m = 0; m < instance.materials.length; m++) {
				instance.materials[m].opacity = slot.blend
			}
		}
	}

	runtime.container.visible = anyDrawn
	if (anyDrawn) {
		const alwaysLit = useLightingStore.getState().alwaysLit
		// the Sun where it is drawn, or the viewer's own light
		if (alwaysLit) runtime.light.position.copy(camera.position)
		else frame.renderPosition(runtime.root, runtime.light.position)
		const fill = alwaysLit
			? FILL_ALWAYS_LIT
			: document.documentElement.dataset.contrast === "high"
				? FILL_HIGH_CONTRAST
				: FILL
		if (fill !== runtime.fill) {
			runtime.fill = fill
			for (const slot of runtime.slots) {
				for (const instance of slot.instances.values()) {
					for (const material of instance.materials) {
						;(material as MeshStandardMaterial).envMapIntensity = fill
					}
				}
			}
		}
	}
	publishCraftDrawn(crafts.selectedCraftId, selectedAs, selectedFactor, nowMs)
}

/** Lets go of the craft's own materials and the fill (the files stay cached). */
function disposeModelRuntime(runtime: ModelRuntime): void {
	for (const slot of runtime.slots) {
		for (const instance of slot.instances.values()) {
			for (const material of instance.materials) material.dispose()
		}
	}
	runtime.environment?.dispose()
}

export interface CraftModelsProps {
	frame: SimFrame
	craftFrame: CraftFrame
}

function CraftModels({ frame, craftFrame }: CraftModelsProps) {
	const size = useThree((state) => state.size)
	const runtime = useMemo(
		() => createModelRuntime(frame, craftFrame),
		[frame, craftFrame],
	)

	useEffect(() => {
		const query =
			typeof window.matchMedia === "function"
				? window.matchMedia(REDUCED_MOTION_QUERY)
				: null
		const update = () => {
			runtime.instant = query?.matches === true
		}
		query?.addEventListener("change", update)
		return () => {
			query?.removeEventListener("change", update)
			disposeModelRuntime(runtime)
		}
	}, [runtime])

	useFrame(({ camera, gl, scene }, delta) => {
		if (!(camera instanceof PerspectiveCamera)) return
		updateCraftModels(
			runtime,
			frame,
			craftFrame,
			camera,
			gl,
			scene,
			size.width,
			size.height,
			delta,
			performance.now(),
		)
	})

	return <primitive object={runtime.container} />
}

export default CraftModels
