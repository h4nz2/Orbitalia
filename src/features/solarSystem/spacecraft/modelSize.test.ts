/**
 * How big a spacecraft's model is drawn (#73): the size rule itself, and the
 * rule against every flyby and arrival in the data, in every preset but
 * true scale, seen as Watch frames its closest approach on a laptop: the
 * chosen craft's model is drawn, at least `MODEL_MIN_PX` unless a body it is
 * near holds it smaller, and clearly smaller than what it passes (under half
 * its disc on screen).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { NodeIO } from "@gltf-transform/core"
import { ALL_EXTENSIONS } from "@gltf-transform/extensions"
import { dequantize } from "@gltf-transform/functions"
import { MeshoptDecoder } from "meshoptimizer"
import { beforeAll, describe, expect, it } from "vitest"

import { bodies } from "@/data"
import { craftModelAt } from "@/data/spacecraftModels"
import { SPACECRAFT_MODEL_DIR } from "@/data/spacecraftModelsSchema"
import { SpacecraftFile, TrajectoriesFile } from "@/data/spacecraftSchema"
import catalogueJson from "@/data/spacecraft.json"
import trajectoriesJson from "@/data/spacecraftTrajectories.json"
import {
	SCALE_PRESETS,
	SCALE_PRESET_IDS,
	buildIndex,
	computeDisplayPositions,
	computeDisplayRadii,
	computePositions,
	degToRad,
	rootIndexOf,
	type ScaleSettings,
} from "@/sim"
import { WATCHED_EVENT_KINDS, watchDirection, watchPlan } from "@/sim/follow"
import {
	craftStateAt,
	createCraftState,
	decodeTrajectory,
	drawnPhaseAt,
	isoToJD,
	type CraftTrajectory,
} from "@/sim/spacecraft"

import { CAMERA_FOV_DEG } from "../camera/framing"
import { WATCH_MARGIN } from "./facts"
import {
	BODY_NEAR_RADII,
	CHOSEN_SHOW_PX,
	PASSAGE_HOURS,
	MOON_NEAR_RADII,
	DEFAULT_CORE_SHARE,
	MODEL_BODY_SHARE,
	MODEL_DRAWN_KM,
	MODEL_MAX_SHARE,
	MODEL_MIN_PX,
	MODEL_SHOW_PX,
	bodyAllowsKm,
	bodyLimitKm,
	coreShareOf,
	drawnFactor,
	modelSize,
	passageStrength,
	roundDrawnFactor,
	sizeBodiesOf,
	sizeBodyReach,
	type ModelView,
	type Passage,
} from "./modelSize"

/** 1366x768: px per radian at the canvas's height, fov 45°. */
const FOCAL = 768 / (2 * Math.tan(degToRad(CAMERA_FOV_DEG) / 2))

const view = (over: Partial<ModelView> = {}): ModelView => ({
	depthKm: 1e6,
	focalPx: FOCAL,
	shortSidePx: 768,
	coreShare: 0.5,
	chosen: true,
	sunDistanceKm: 1e9,
	bodyLimitKm: Infinity,
	wasModel: false,
	...over,
})

describe("the size rule", () => {
	it("draws the core MODEL_DRAWN_KM long, so dollying in makes it bigger", () => {
		const near = modelSize(view({ chosen: false, depthKm: 2e6 }))
		const nearer = modelSize(view({ chosen: false, depthKm: 1e6 }))
		expect(near.corePx).toBeCloseTo((MODEL_DRAWN_KM * FOCAL) / 2e6, 6)
		expect(nearer.corePx).toBeCloseTo(2 * near.corePx, 6)
		// the core is that share of the whole model
		expect(near.heightPx).toBeCloseTo(near.corePx / 0.5, 6)
		expect(near.lengthKm).toBeCloseTo(MODEL_DRAWN_KM / 0.5, 3)
	})

	it("keeps the chosen craft's core at least MODEL_MIN_PX from the follow framing out", () => {
		for (const depthKm of [1e6, 3e6, 1e8]) {
			const size = modelSize(view({ depthKm }))
			expect(size.corePx).toBeCloseTo(MODEL_MIN_PX, 6)
			expect(size.model).toBe(true)
		}
		// a craft nobody chose is a diamond that far out
		expect(modelSize(view({ chosen: false, depthKm: 1e8 })).model).toBe(false)
	})

	it("lets the floor go once the camera is far beyond the craft's distance from the Sun", () => {
		const far = modelSize(view({ depthKm: 1e10, sunDistanceKm: 1e8 }))
		expect(far.corePx).toBeLessThan(MODEL_SHOW_PX)
		expect(far.model).toBe(false)
	})

	it("caps the whole model at MODEL_MAX_SHARE of the shorter side", () => {
		const close = modelSize(view({ depthKm: 100 }))
		expect(close.heightPx).toBeCloseTo(MODEL_MAX_SHARE * 768, 6)
		const phone = modelSize(view({ depthKm: 100, shortSidePx: 390 }))
		expect(phone.heightPx).toBeCloseTo(MODEL_MAX_SHARE * 390, 6)
	})

	it("holds the whole model under a nearby body's limit, even below the floor", () => {
		const limit = bodyAllowsKm(60_000, 2)
		const size = modelSize(view({ depthKm: 3e6, bodyLimitKm: limit }))
		expect(size.lengthKm).toBeCloseTo(limit, 3)
		expect(size.corePx).toBeLessThan(MODEL_MIN_PX)
	})

	it("keeps the chosen craft's model while the whole of it is twice the diamond", () => {
		const at = (heightPx: number, wasModel: boolean) =>
			modelSize(
				view({
					coreShare: 0.4,
					bodyLimitKm: (heightPx * 3e6) / FOCAL,
					depthKm: 3e6,
					wasModel,
				}),
			).model
		expect(at(CHOSEN_SHOW_PX + 0.5, false)).toBe(true)
		expect(at(CHOSEN_SHOW_PX - 0.5, false)).toBe(false)
		expect(at(CHOSEN_SHOW_PX - 0.5, true)).toBe(true)
		expect(at(CHOSEN_SHOW_PX - 1.5, true)).toBe(false)
	})

	it("turns into the diamond below its size, with hysteresis", () => {
		const at = (corePx: number, wasModel: boolean) =>
			modelSize(
				view({
					chosen: false,
					depthKm: (MODEL_DRAWN_KM * FOCAL) / corePx,
					wasModel,
				}),
			).model
		expect(at(9.5, false)).toBe(false)
		expect(at(9.5, true)).toBe(true)
		expect(at(10.5, false)).toBe(true)
		expect(at(8.5, true)).toBe(false)
	})
})

describe("bodyAllowsKm", () => {
	it("is MODEL_BODY_SHARE of the diameter near the body, fading out continuously", () => {
		const radius = 100_000
		expect(bodyAllowsKm(radius, 1.1)).toBe(MODEL_BODY_SHARE * 2 * radius)
		expect(bodyAllowsKm(radius, BODY_NEAR_RADII)).toBe(
			MODEL_BODY_SHARE * 2 * radius,
		)
		const far = 2 * BODY_NEAR_RADII
		let previous = bodyAllowsKm(radius, BODY_NEAR_RADII)
		for (let rho = BODY_NEAR_RADII + 0.01; rho < far; rho += 0.01) {
			const allowed = bodyAllowsKm(radius, rho)
			expect(allowed).toBeGreaterThanOrEqual(previous)
			// no jump: a craft moving 1 % of a radius changes it by under 10 %
			if (rho < far - 1) expect(allowed / previous).toBeLessThan(1.1)
			previous = allowed
		}
		expect(bodyAllowsKm(radius, far)).toBe(Infinity)
		// a moon's reach is its own
		expect(bodyAllowsKm(radius, 2 * MOON_NEAR_RADII, MOON_NEAR_RADII)).toBe(
			Infinity,
		)
	})

	it("comes from the Sun, the planets and the big moons and dwarf planets, not moonlets", () => {
		const reach = (id: string) =>
			sizeBodyReach(bodies.find((body) => body.id === id)!)
		for (const id of ["sun", "jupiter", "pluto"]) {
			expect(reach(id), id).toBe(BODY_NEAR_RADII)
		}
		for (const id of ["moon", "titan", "triton", "ganymede"]) {
			expect(reach(id), id).toBe(MOON_NEAR_RADII)
		}
		for (const id of ["phobos", "deimos", "mimas", "arrokoth", "ceres"]) {
			expect(reach(id), id).toBe(0)
		}
	})
})

describe("passageStrength", () => {
	it("holds what a flyby passes within PASSAGE_HOURS, fading out by twice that", () => {
		expect(passageStrength(0)).toBe(1)
		expect(passageStrength(-PASSAGE_HOURS)).toBe(1)
		expect(passageStrength(1.5 * PASSAGE_HOURS)).toBeCloseTo(0.5, 9)
		expect(passageStrength(-2 * PASSAGE_HOURS)).toBe(0)
		// Voyager 1 meets Titan 18 hours before Saturn: Titan lets go long before
		expect(passageStrength(18)).toBe(0)
	})

	it("limits the model to MODEL_BODY_SHARE of the body however far it is drawn", () => {
		const radius = 30_000
		expect(bodyAllowsKm(radius, 40, MOON_NEAR_RADII)).toBe(Infinity)
		expect(bodyAllowsKm(radius, 40, MOON_NEAR_RADII, 1)).toBe(
			MODEL_BODY_SHARE * 2 * radius,
		)
		expect(bodyAllowsKm(radius, 40, MOON_NEAR_RADII, 0.5)).toBe(
			MODEL_BODY_SHARE * 4 * radius,
		)
	})
})

describe("bodyLimitKm", () => {
	// a planet (body 0) at the origin, radius 1000 drawn km, and a moon (body
	// 1) drawn 100,000 km off, radius 500; the craft beside the planet
	const drawn = {
		displayKm: new Float64Array([0, 0, 0, 100_000, 0, 0]),
		displayRadiiKm: new Float64Array([1000, 500]),
	}
	const sizeBodies = [
		{ index: 0, near: BODY_NEAR_RADII },
		{ index: 1, near: MOON_NEAR_RADII },
	]
	const craftKm = new Float64Array([5000, 0, 0])
	const both = new Uint8Array([1, 1])
	const planetLimit = MODEL_BODY_SHARE * 2 * 1000
	const moonLimit = MODEL_BODY_SHARE * 2 * 500
	/** A passage of the moon whose closest approach is at JD 2,450,000. */
	const passages: Passage[] = [{ body: 1, trueJD: 2_450_000 }]
	const hours = (h: number) => 2_450_000 + h / 24

	it("is the nearest body's limit, by its drawn distance", () => {
		expect(bodyLimitKm(craftKm, drawn, sizeBodies, both, [], NaN)).toBe(
			planetLimit,
		)
		const far = new Float64Array([1e9, 0, 0])
		expect(bodyLimitKm(far, drawn, sizeBodies, both, [], NaN)).toBe(Infinity)
	})

	it("leaves out a body whose layer is off", () => {
		const moonOnly = new Uint8Array([0, 1])
		expect(bodyLimitKm(craftKm, drawn, sizeBodies, moonOnly, [], NaN)).toBe(
			Infinity,
		)
		// nor does a passage of a hidden body hold it
		expect(
			bodyLimitKm(
				craftKm,
				drawn,
				sizeBodies,
				new Uint8Array([0, 0]),
				passages,
				hours(0),
			),
		).toBe(Infinity)
	})

	it("holds what a passage passes, however far it is drawn, while the drawing shows the closest approach near", () => {
		// the moon is 190 of its radii from the craft: alone it limits nothing
		const planetOff = new Uint8Array([0, 1])
		const limitAt = (h: number) =>
			bodyLimitKm(craftKm, drawn, sizeBodies, planetOff, passages, hours(h))
		expect(limitAt(0)).toBe(moonLimit)
		expect(limitAt(-PASSAGE_HOURS)).toBe(moonLimit)
		expect(limitAt(1.5 * PASSAGE_HOURS)).toBeCloseTo(2 * moonLimit, 6)
		expect(limitAt(2 * PASSAGE_HOURS)).toBe(Infinity)
		// times are the drawing's (`drawnPhaseAt`), against the true closest
		// approach: a milestone dated hours off it does not move the window
		expect(limitAt(18)).toBe(Infinity)
		// no phase (a craft without trajectory data there): no passage
		expect(
			bodyLimitKm(craftKm, drawn, sizeBodies, planetOff, passages, NaN),
		).toBe(Infinity)
		// and the smaller limit wins
		expect(
			bodyLimitKm(craftKm, drawn, sizeBodies, both, passages, hours(0)),
		).toBe(Math.min(planetLimit, moonLimit))
	})

	it("takes its bodies from sizeBodyReach", () => {
		const some = [
			{ kind: "star", radiusKm: 695_700 },
			{ kind: "moon", radiusKm: 11 },
			{ kind: "moon", radiusKm: 2575 },
		]
		expect(sizeBodiesOf(some)).toEqual([
			{ index: 0, near: BODY_NEAR_RADII },
			{ index: 2, near: MOON_NEAR_RADII },
		])
	})
})

describe("drawnFactor", () => {
	it("is the drawn length in true km round the craft over its real size", () => {
		// 50,000 drawn km where one true km is drawn as 5 km: 10,000 true km, of a 20 m craft
		expect(drawnFactor(50_000, 5, 20)).toBeCloseTo(500_000, 3)
	})

	it("rounds to two significant digits", () => {
		expect(roundDrawnFactor(512_345)).toBe(510_000)
		expect(roundDrawnFactor(36_789_012_345)).toBe(37_000_000_000)
		expect(roundDrawnFactor(1_049_000)).toBe(1_000_000)
		expect(roundDrawnFactor(Number.NaN)).toBe(1)
	})
})

// ---------------------------------------------------------------------------
// against the data

const root = join(__dirname, "..", "..", "..", "..")
const catalogue = SpacecraftFile.parse(catalogueJson)
const trajectories = TrajectoriesFile.parse(trajectoriesJson)
const index = buildIndex(bodies)
const rootIndex = rootIndexOf(bodies)
const decoded = new Map<string, CraftTrajectory>(
	catalogue.craft.map((craft) => [
		craft.id,
		decodeTrajectory(craft, trajectories[craft.id], bodies, index),
	]),
)

/** Every model's core share, measured from its file as the app does (./modelCache.ts). */
const coreShares = new Map<string, number>()

beforeAll(async () => {
	await MeshoptDecoder.ready
	const io = new NodeIO()
		.registerExtensions(ALL_EXTENSIONS)
		.registerDependencies({ "meshopt.decoder": MeshoptDecoder })
	const models = JSON.parse(
		readFileSync(join(root, "data", "spacecraft-models.json"), "utf8"),
	) as { models: Record<string, { sizeM: number }> }
	for (const [id, { sizeM }] of Object.entries(models.models)) {
		const doc = await io.read(
			join(root, "public", SPACECRAFT_MODEL_DIR, `${id}.glb`),
		)
		await doc.transform(dequantize())
		const distances: number[] = []
		const areas: number[] = []
		for (const node of doc.getRoot().listNodes()) {
			const mesh = node.getMesh()
			if (mesh === null) continue
			const m = node.getWorldMatrix()
			const at = (v: number[]) => [
				m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
				m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
				m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
			]
			for (const primitive of mesh.listPrimitives()) {
				const position = primitive.getAttribute("POSITION")!
				const indices = primitive.getIndices()
				const count = indices?.getCount() ?? position.getCount()
				const vertex = (k: number) =>
					at(position.getElement(indices?.getScalar(k) ?? k, [0, 0, 0]))
				for (let k = 0; k + 2 < count; k += 3) {
					const [a, b, c] = [vertex(k), vertex(k + 1), vertex(k + 2)]
					const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
					const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
					areas.push(
						Math.hypot(
							u[1] * w[2] - u[2] * w[1],
							u[2] * w[0] - u[0] * w[2],
							u[0] * w[1] - u[1] * w[0],
						) / 2,
					)
					distances.push(
						Math.hypot(
							(a[0] + b[0] + c[0]) / 3,
							(a[1] + b[1] + c[1]) / 3,
							(a[2] + b[2] + c[2]) / 3,
						),
					)
				}
			}
		}
		coreShares.set(
			id,
			coreShareOf(new Float64Array(distances), new Float64Array(areas), sizeM),
		)
	}
})

describe("coreShareOf", () => {
	it("finds the thin booms: Voyager's and the Pioneers' cores are under half their length, JWST's and Juno's are not", () => {
		expect(coreShares.get("voyager")).toBeLessThan(0.5)
		expect(coreShares.get("pioneer")).toBeLessThan(0.5)
		expect(coreShares.get("cassini")).toBeLessThan(0.5)
		expect(coreShares.get("jwst")).toBeGreaterThan(0.5)
		expect(coreShares.get("juno")).toBeGreaterThan(0.5)
		for (const share of coreShares.values()) {
			expect(share).toBeGreaterThan(0.2)
			expect(share).toBeLessThanOrEqual(1)
		}
		expect(coreShareOf(new Float64Array(), new Float64Array(), 10)).toBe(
			DEFAULT_CORE_SHARE,
		)
	})
})

/** Bodies at `jd` under `scale`, as the scene's SimFrame has them. */
function frameAt(jd: number, scale: ScaleSettings) {
	const positionsKm = computePositions(bodies, jd, undefined, index)
	const displayRadiiKm = computeDisplayRadii(bodies, scale)
	return {
		bodies,
		positionsKm,
		displayKm: computeDisplayPositions(
			bodies,
			positionsKm,
			displayRadiiKm,
			scale,
			index,
		),
		displayRadiiKm,
		scale,
	}
}

const sizeBodies = sizeBodiesOf(bodies)
/** Every body's layer on (the presets' own visibility is the scene's business). */
const allShown = new Uint8Array(bodies.length).fill(1)

/**
 * A craft's passages as the scene keeps them (`CraftModels.tsx`): every
 * watched milestone with a body to pass and its true closest approach,
 * worked out once, in one preset, and then used in every preset.
 */
const passagesOf = (() => {
	const cache = new Map<string, Passage[]>()
	return (craft: (typeof catalogue.craft)[number]): Passage[] => {
		let passages = cache.get(craft.id)
		if (passages === undefined) {
			const trajectory = decoded.get(craft.id)!
			passages = craft.events.flatMap((event) => {
				const body = index.get(event.target ?? "")
				if (!WATCHED_EVENT_KINDS.includes(event.kind) || body === undefined) {
					return []
				}
				const jd = isoToJD(event.date)
				const frame = frameAt(jd, SCALE_PRESETS.everythingVisible)
				const trueJD =
					watchPlan(trajectory, { jd, target: body }, frame)?.trueJD ?? jd
				return [{ body, trueJD }]
			})
			cache.set(craft.id, passages)
		}
		return passages
	}
})()

const watched = catalogue.craft.flatMap((craft) =>
	craft.events
		.filter((event) => WATCHED_EVENT_KINDS.includes(event.kind))
		.map((event) => ({
			craft,
			event,
			label: `${craft.id} ${event.kind} ${event.target ?? ""} ${event.date}`,
		})),
)

/**
 * The chosen craft at the closest approach of a watched passage, as Watch
 * frames it (`watchEvent`): the model's size by the rule, what it passes,
 * how far (in its drawn radii) and how big its disc is on screen.
 */
function atClosestApproach(
	item: (typeof watched)[number],
	scale: ScaleSettings,
) {
	const { craft, event } = item
	const trajectory = decoded.get(craft.id)!
	const jd = isoToJD(event.date)
	const target = index.get(event.target ?? "") ?? -1
	const plan = watchPlan(trajectory, { jd, target }, frameAt(jd, scale))!
	const frame = frameAt(plan.closestJD, scale)
	const state = craftStateAt(
		trajectory,
		plan.closestJD,
		frame,
		createCraftState(),
	)
	const craftKm = state.displayKm
	const around = target >= 0 ? target : Math.max(0, state.anchorIndex)
	const centre = (i: number) => frame.displayKm.subarray(i * 3, i * 3 + 3)
	const gapOf = (i: number) => {
		const c = centre(i)
		return Math.hypot(craftKm[0] - c[0], craftKm[1] - c[1], craftKm[2] - c[2])
	}
	const gap = gapOf(around)
	const reach = around === rootIndex ? gap : gap + frame.displayRadiiKm[around]
	const depthKm =
		(WATCH_MARGIN * reach) / Math.sin(degToRad(CAMERA_FOV_DEG) / 2)
	// where the camera stands: Watch's direction for a planet's hyperbola,
	// else (a moon, Pluto, L2) square to the line to what it passes, from above
	let dir: number[]
	if (plan.encounter !== null) {
		const { azimuthDeg, elevationDeg } = watchDirection(
			plan.encounter.flyby!.hyperbola,
		)
		const az = degToRad(azimuthDeg)
		const el = degToRad(elevationDeg)
		dir = [
			Math.sin(az) * Math.cos(el),
			Math.sin(el),
			Math.cos(az) * Math.cos(el),
		]
	} else {
		const c = centre(around)
		const g = [c[0] - craftKm[0], c[1] - craftKm[1], c[2] - craftKm[2]]
		const length = Math.hypot(g[0], g[1], g[2]) || 1
		const up = 1 - (g[1] / length) ** 2
		dir = [(-g[1] * g[0]) / length ** 2, up, (-g[1] * g[2]) / length ** 2]
		const d = Math.hypot(dir[0], dir[1], dir[2]) || 1
		dir = dir.map((v) => v / d)
	}
	const camera = [0, 1, 2].map((k) => craftKm[k] + dir[k] * depthKm)
	const discPx = (i: number) => {
		const c = centre(i)
		const r = frame.displayRadiiKm[i]
		const d = Math.hypot(camera[0] - c[0], camera[1] - c[1], camera[2] - c[2])
		return d > r ? (2 * FOCAL * r) / Math.sqrt(d * d - r * r) : Infinity
	}
	// the scene's own rule: the bodies near it, and what its passages pass
	// wherever the drawing puts it, timed as the drawing shows the craft
	const phaseJD = drawnPhaseAt(trajectory, plan.closestJD, frame)
	const limitKm = bodyLimitKm(
		craftKm,
		frame,
		sizeBodies,
		allShown,
		passagesOf(craft),
		phaseJD,
	)
	const model = craftModelAt(craft.id, plan.closestJD)!
	const size = modelSize({
		depthKm,
		focalPx: FOCAL,
		shortSidePx: 768,
		coreShare: coreShares.get(model.id)!,
		chosen: true,
		sunDistanceKm: gapOf(rootIndex),
		bodyLimitKm: limitKm,
		wasModel: false,
	})
	return {
		size,
		target,
		targetDiscPx: target >= 0 ? discPx(target) : Infinity,
		bodyLimitPx: (limitKm * FOCAL) / depthKm,
		// how far (h) the drawing shows the craft from its true closest approach
		passageHours: (phaseJD - plan.trueJD) * 24,
	}
}

describe("at every flyby's and arrival's closest approach, as Watch frames it", () => {
	it("covers every flyby and arrival in the data", () => {
		expect(watched.length).toBeGreaterThanOrEqual(30)
	})

	describe.each(SCALE_PRESET_IDS.filter((id) => id !== "trueScale"))(
		"in %s",
		(presetId) => {
			const scale = SCALE_PRESETS[presetId]
			it.each(watched.map((w) => w.label))("%s", (label) => {
				const item = watched.find((w) => w.label === label)!
				const { size, target, targetDiscPx, bodyLimitPx, passageHours } =
					atClosestApproach(item, scale)
				// at Watch's closest approach the drawing shows the closest
				// approach the scene keeps for the passage: it holds in full
				if (target >= 0) {
					expect(passageStrength(passageHours)).toBe(1)
				}
				// at least MODEL_MIN_PX, unless a body it is near holds it smaller
				// (then it may even be the diamond: the smaller rule wins)
				if (size.corePx < MODEL_MIN_PX - 1e-6) {
					expect(size.heightPx).toBeCloseTo(bodyLimitPx, 6)
				} else {
					expect(size.model).toBe(true)
				}
				// clearly smaller than what it passes, wherever the drawing puts it
				// (a moon, Pluto or Arrokoth can be drawn far from the drawn
				// passage, #56), or the diamond
				if (target >= 0 && size.model) {
					expect(size.heightPx).toBeLessThan(0.5 * targetDiscPx)
				}
			})
		},
	)
})
