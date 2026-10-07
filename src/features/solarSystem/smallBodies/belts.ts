/**
 * The belts' per-frame state (#23), pure apart from the objects it fills: the uniforms the
 * belt shader (beltShader.ts) reads, and where a belt's name goes on screen.
 */
import { Vector3 } from "three"

import type { Belt } from "@/data"
import { anchorSpline, anchorWeightOf, rootIndexOf, toUnits } from "@/sim"

import { mapTruePointKm } from "../light/lightFront"
import type { SimFrame } from "../scene/simFrame"

import { BELT_SPLINE_NODES } from "./beltShader"

/** Size of a belt dot on screen (CSS px): a marker of where members are, never their size. */
export const BELT_DOT_PX = 2.2
/** Opacity of a dot: faint, so a belt reads as a haze and never as a wall of rock. */
export const BELT_DOT_OPACITY = 0.45

/** What the belt shader reads each frame. */
export interface BeltUniforms {
	uDays: { value: number }
	uRootRender: { value: Vector3 }
	uRootRadiusKm: { value: number }
	uCurve: { value: Vector3 }
	uSplineShare: { value: number }
	uSplineCount: { value: number }
	uSplineU: { value: number[] }
	uSplineY: { value: number[] }
	uSplineM: { value: number[] }
	uSplineEnd: { value: Vector3 }
	uAnchorRender: { value: Vector3[] }
	uAnchorTrue: { value: Vector3[] }
	uAnchorWeight: { value: number[] }
	uPointSize: { value: number }
	uColor: { value: Vector3 }
	uOpacity: { value: number }
}

export function createBeltUniforms(
	color: readonly [number, number, number],
	slots: number,
): BeltUniforms {
	return {
		uDays: { value: 0 },
		uRootRender: { value: new Vector3() },
		uRootRadiusKm: { value: 1 },
		uCurve: { value: new Vector3(1, 1, 1) },
		uSplineShare: { value: 0 },
		uSplineCount: { value: 0 },
		uSplineU: { value: new Array<number>(BELT_SPLINE_NODES).fill(0) },
		uSplineY: { value: new Array<number>(BELT_SPLINE_NODES).fill(0) },
		uSplineM: { value: new Array<number>(BELT_SPLINE_NODES).fill(0) },
		uSplineEnd: { value: new Vector3() },
		uAnchorRender: {
			value: Array.from({ length: slots }, () => new Vector3()),
		},
		uAnchorTrue: { value: Array.from({ length: slots }, () => new Vector3()) },
		uAnchorWeight: { value: new Array<number>(slots).fill(0) },
		uPointSize: { value: BELT_DOT_PX },
		uColor: { value: new Vector3(color[0], color[1], color[2]) },
		uOpacity: { value: BELT_DOT_OPACITY },
	}
}

/** "#b8aa90" -> [0.72, 0.67, 0.56] (sRGB 0..1, as the shader writes it). */
export function hexToRgb(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.slice(1), 16)
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * Writes the frame into the uniforms: time since J2000, where the root is drawn, the
 * `orbitDistance` curve (its power law, and the nodes and share of its anchored part, #54)
 * and the anchored frames (drawn and true anchor positions, weights).
 *
 * @throws Error when the curve has more anchors than the shader takes
 */
export function updateBeltUniforms(
	uniforms: BeltUniforms,
	frame: Pick<
		SimFrame,
		| "bodies"
		| "positionsKm"
		| "displayKm"
		| "originKm"
		| "jd"
		| "scale"
		| "frameBlend"
	>,
	root: number,
	pixelRatio: number,
): void {
	const { positionsKm, displayKm, originKm } = frame
	const r = root * 3
	uniforms.uDays.value = frame.jd - 2451545
	uniforms.uRootRender.value.set(
		toUnits(displayKm[r] - originKm[0]),
		toUnits(displayKm[r + 1] - originKm[1]),
		toUnits(displayKm[r + 2] - originKm[2]),
	)
	uniforms.uRootRadiusKm.value = frame.bodies[root].radiusKm
	const curve = frame.scale.orbitDistance
	uniforms.uCurve.value.set(curve.knee, curve.exponent, curve.gain)
	const share = anchorWeightOf(curve)
	uniforms.uSplineShare.value = share
	if (share > 0 && curve.anchors !== undefined) {
		const { u, y, m } = anchorSpline(curve.knee, curve.anchors)
		if (u.length > BELT_SPLINE_NODES) {
			throw new Error(
				`belts: ${u.length - 1} anchors, the shader takes ${BELT_SPLINE_NODES - 1}`,
			)
		}
		uniforms.uSplineCount.value = u.length
		for (let k = 0; k < u.length; k++) {
			uniforms.uSplineU.value[k] = u[k]
			uniforms.uSplineY.value[k] = y[k]
			uniforms.uSplineM.value[k] = m[k]
		}
		const last = u.length - 1
		uniforms.uSplineEnd.value.set(u[last], y[last], m[last])
	}
	const { anchors, weights } = frame.frameBlend
	for (let k = 0; k < uniforms.uAnchorWeight.value.length; k++) {
		const a = anchors[k] ?? root
		const w = a === root ? 0 : (weights[k] ?? 0)
		uniforms.uAnchorWeight.value[k] = w
		const o = a * 3
		uniforms.uAnchorRender.value[k].set(
			toUnits(displayKm[o] - originKm[0]),
			toUnits(displayKm[o + 1] - originKm[1]),
			toUnits(displayKm[o + 2] - originKm[2]),
		)
		uniforms.uAnchorTrue.value[k].set(
			positionsKm[o] - positionsKm[r],
			positionsKm[o + 1] - positionsKm[r + 1],
			positionsKm[o + 2] - positionsKm[r + 2],
		)
	}
	uniforms.uPointSize.value = BELT_DOT_PX * pixelRatio
}

/** The middle of a belt's zones (km): where its name is written. */
export const beltMidRadiusKm = (belt: Pick<Belt, "zones">): number => {
	let sum = 0
	let weight = 0
	for (const zone of belt.zones) {
		sum +=
			zone.share * (zone.semiMajorAxisKm[0] + zone.semiMajorAxisKm[1]) * 0.5
		weight += zone.share
	}
	return weight > 0 ? sum / weight : 0
}

const labelTrue = new Float64Array(3)
const labelDisplay = new Float64Array(3)

/**
 * Render position (scene units) of a belt's name: on the belt's middle circle in the
 * ecliptic, on the side toward `sideX, sideZ` (the camera's left, in the ecliptic plane),
 * drawn like a body at that place (`mapTruePointKm`, anchored frames included).
 */
export function beltLabelPosition(
	frame: SimFrame,
	radiusKm: number,
	sideX: number,
	sideZ: number,
	out: Vector3,
): Vector3 {
	const root = rootIndexOf(frame.bodies)
	const length = Math.hypot(sideX, sideZ) || 1
	const r = root * 3
	labelTrue[0] = frame.positionsKm[r] + (radiusKm * sideX) / length
	labelTrue[1] = frame.positionsKm[r + 1]
	labelTrue[2] = frame.positionsKm[r + 2] + (radiusKm * sideZ) / length
	mapTruePointKm(
		frame,
		root,
		root,
		labelTrue[0],
		labelTrue[1],
		labelTrue[2],
		labelDisplay,
	)
	return out.set(
		toUnits(labelDisplay[0] - frame.originKm[0]),
		toUnits(labelDisplay[1] - frame.originKm[1]),
		toUnits(labelDisplay[2] - frame.originKm[2]),
	)
}
