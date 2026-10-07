/**
 * A comet's coma and tails as drawn (#23, checked against real comets in #55). Pure apart
 * from the typed arrays it fills; allocates nothing per frame.
 *
 * Everything starts in TRUE kilometres: the comet's true position, the true direction
 * away from the Sun (src/sim/comet.ts), the tails' true lengths for the comet's activity.
 * Only then is each point of the tail drawn, with the rule a body at that place would be
 * drawn by (`mapTruePointKm`, the planets' rule plus the anchored frames of #31). So the
 * tail keeps pointing away from the drawn Sun in every preset, and at true scale it is its
 * true length: tens of millions of km behind a nucleus of a few km.
 *
 * Two tails, as real comets have:
 *  - the gas (ion) tail, straight away from the Sun, blue;
 *  - the dust tail, a syndyne (src/sim/comet.ts): grains pushed out by sunlight fall behind
 *    the comet, so it curves back along the orbit, the more the faster the comet swings
 *    round the Sun; yellowish white.
 *
 * Activity drives everything: the tails' length and brightness (`tailBrightness`) and the
 * coma's size and glow (`comaGrowth`). The coma always surrounds the nucleus as drawn
 * (at least `COMA_NUCLEUS_RADII` of its drawn radius, however much a preset enlarges the
 * nucleus), and the tails begin at the coma's edge (their length counts from there), with
 * a short fade-in from the nucleus's surface under the coma: no part of a tail is hidden
 * inside the nucleus.
 */
import type { Body } from "@/data"
import { rootIndexOf, toUnits } from "@/sim"
import {
	DUST_BETA,
	activityDistanceKm,
	antiSunDirection,
	cometActivity,
	cometVelocity,
	dustAgeDays,
	dustTailLengthKm,
	grainOffsetKm,
	ionTailLengthKm,
	orbitMu,
} from "@/sim/comet"

import { mapTruePointKm, type FrontFrame } from "../light/lightFront"

/**
 * Points along each tail: the fade-in from the nucleus's surface, then TAIL_SAMPLES - 1
 * points from the coma's edge to the tail's end.
 */
export const TAIL_SAMPLES = 24
/** True radius (km) of a fully active comet's coma: the glowing cloud of gas round the nucleus (Halley's was about 270,000 km in February 1986, IAUC 4183). */
export const COMA_RADIUS_KM = 1e5
/** The coma is never drawn smaller than this many drawn radii of the nucleus. */
export const COMA_NUCLEUS_RADII = 4
/** The dust tail's shape is worked out again once the clock has moved this far (days). */
export const DUST_REFRESH_DAYS = 0.01

/** Share of the tail (0 at the coma's edge .. 1 at the end) at sample `k`; the fade-in point is 0 too. */
export const tailShare = (k: number): number =>
	k === 0 ? 0 : (k - 1) / (TAIL_SAMPLES - 2)

/** Everything about one comet's tail this frame. */
export interface TailFrame {
	/** false: asleep or nothing to draw */
	visible: boolean
	/** 0..1 (src/sim/comet.ts `cometActivity`) */
	activity: number
	/** true length of the gas tail (km) */
	lengthKm: number
	/** true length of the dust tail (km) */
	dustLengthKm: number
	/** render position of the nucleus (scene units) */
	head: Float32Array
	/** drawn radius of the nucleus, scene units */
	nucleusUnits: number
	/** drawn radius of the coma, scene units */
	comaUnits: number
	/** render positions (scene units) of the gas tail's axis, TAIL_SAMPLES x 3 */
	ion: Float32Array
	/** render positions of the dust tail's axis */
	dust: Float32Array
	/** drawn length of the gas tail from the coma's edge, scene units */
	ionUnits: number
	/** drawn length of the dust tail from the coma's edge, scene units */
	dustUnits: number
	/** the dust tail's shape (true km from the nucleus, its end at distance 1), for `dustJD` */
	dustShape: Float64Array
	dustJD: number
}

export const createTailFrame = (): TailFrame => ({
	visible: false,
	activity: 0,
	lengthKm: 0,
	dustLengthKm: 0,
	head: new Float32Array(3),
	nucleusUnits: 0,
	comaUnits: 0,
	ion: new Float32Array(TAIL_SAMPLES * 3),
	dust: new Float32Array(TAIL_SAMPLES * 3),
	ionUnits: 0,
	dustUnits: 0,
	dustShape: new Float64Array(TAIL_SAMPLES * 3),
	dustJD: Number.NaN,
})

/**
 * The dust tail's shape at `jd` into `out.dustShape`: a syndyne of `DUST_BETA` grains, the
 * oldest as old as a tail `lengthKm` long needs, sampled evenly along it and scaled so its
 * end lies at distance 1 from the nucleus.
 */
function writeDustShape(
	orbit: NonNullable<Body["orbit"]>,
	jd: number,
	cometKm: Float64Array,
	distanceKm: number,
	lengthKm: number,
	out: TailFrame,
): void {
	const shape = out.dustShape
	const mu = orbitMu(orbit)
	const oldest = dustAgeDays(mu, DUST_BETA, distanceKm, lengthKm)
	cometVelocity(orbit, jd, velocity)
	shape.fill(0)
	// the grain's distance grows as its age squared: ages as the square root, for even spacing
	for (let k = 2; k < TAIL_SAMPLES; k++) {
		const age = oldest * Math.sqrt(tailShare(k))
		grainOffsetKm(cometKm, velocity, mu, DUST_BETA, age, shape, k * 3)
	}
	const last = (TAIL_SAMPLES - 1) * 3
	const end = Math.hypot(shape[last], shape[last + 1], shape[last + 2])
	if (end > 0) for (let k = 0; k < shape.length; k++) shape[k] /= end
	out.dustJD = jd
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/** Brightness (0..1, the tails' opacity) at `activity`: a tail brightens as its comet wakes up. */
export const tailBrightness = (activity: number): number =>
	Math.sqrt(clamp01(activity))

/**
 * How far the coma has grown at `activity` (0..1, its size and its glow): it shows long
 * before the tails do, as on real comets far out (Hale-Bopp had a coma beyond Jupiter, its
 * tails grew near the Sun).
 */
export const comaGrowth = (activity: number): number =>
	Math.sqrt(Math.sqrt(clamp01(activity)))

const away = new Float64Array(3)
const cometKm = new Float64Array(3)
const velocity = new Float64Array(3)
const headKm = new Float64Array(3)
const probeKm = new Float64Array(3)
const reachKm = new Float64Array(3)

/** Most steps `trueReachKm` takes: it ends far sooner, once the point is drawn within 1e-9 of the target. */
const REACH_STEPS = 60

/** How far from the drawn nucleus (`headKm`) the point `reach` true km along `away` is drawn. */
function drawnReachKm(
	frame: FrontFrame,
	root: number,
	p: Float64Array,
	c: number,
	reach: number,
): number {
	mapTruePointKm(
		frame,
		root,
		root,
		p[c] + away[0] * reach,
		p[c + 1] + away[1] * reach,
		p[c + 2] + away[2] * reach,
		reachKm,
	)
	return Math.hypot(
		reachKm[0] - headKm[0],
		reachKm[1] - headKm[1],
		reachKm[2] - headKm[2],
	)
}

/**
 * True km along `away` from the nucleus (true position `p[c..c + 2]`, drawn at `headKm`)
 * whose drawn point lies `drawnKm` from the drawn nucleus. The drawing along the tail is
 * monotone but not linear, and a preset that enlarges the nucleus a lot puts its surface
 * and its coma's edge far out: in Poster (#54) Encke's 2 km nucleus is drawn 20,000 km
 * wide, so near perihelion the coma's edge lies some 20 million true km out, across the
 * anchor at Mercury's orbit where the drawn scale more than doubles. So the probe's linear
 * guess only starts the search: bracket the reach, then close in on it by false position
 * (Illinois), which needs a handful of steps.
 */
function trueReachKm(
	frame: FrontFrame,
	root: number,
	p: Float64Array,
	c: number,
	drawnKm: number,
	guessKm: number,
): number {
	let lo = 0
	let low = -drawnKm
	let hi = guessKm
	let high = drawnReachKm(frame, root, p, c, hi) - drawnKm
	for (let step = 0; high < 0 && step < REACH_STEPS; step++) {
		lo = hi
		low = high
		hi *= 2
		high = drawnReachKm(frame, root, p, c, hi) - drawnKm
	}
	if (!(high >= 0)) return hi
	let reach = hi
	let kept = 0
	for (let step = 0; step < REACH_STEPS; step++) {
		reach = (lo * high - hi * low) / (high - low)
		const miss = drawnReachKm(frame, root, p, c, reach) - drawnKm
		if (!(Math.abs(miss) > 1e-9 * drawnKm)) break
		if (miss < 0) {
			lo = reach
			low = miss
			if (kept < 0) high /= 2
			kept = -1
		} else {
			hi = reach
			high = miss
			if (kept > 0) low /= 2
			kept = 1
		}
	}
	return reach
}

const drawn = new Float64Array(3)

/** A true point (km) drawn like a body there, then made relative to the render origin (scene units). */
function drawPoint(
	frame: FrontFrame,
	root: number,
	x: number,
	y: number,
	z: number,
	out: Float32Array,
	at: number,
): void {
	mapTruePointKm(frame, root, root, x, y, z, drawn)
	out[at] = toUnits(drawn[0] - frame.originKm[0])
	out[at + 1] = toUnits(drawn[1] - frame.originKm[1])
	out[at + 2] = toUnits(drawn[2] - frame.originKm[2])
}

const span = (axis: Float32Array, from: number, to: number): number =>
	Math.hypot(
		axis[to * 3] - axis[from * 3],
		axis[to * 3 + 1] - axis[from * 3 + 1],
		axis[to * 3 + 2] - axis[from * 3 + 2],
	)

/**
 * The comet at body index `i` this frame: activity, true tail lengths, the coma and both
 * tails' drawn axes, from the comet's and the Sun's TRUE positions.
 */
export function writeTail(
	frame: FrontFrame & { readonly jd: number },
	i: number,
	out: TailFrame,
): TailFrame {
	const body = frame.bodies[i]
	const tail = body.tail
	const orbit = body.orbit
	const root = rootIndexOf(frame.bodies)
	const c = i * 3
	const p = frame.positionsKm
	const distance = antiSunDirection(p, c, p, root * 3, away)
	out.activity =
		tail === undefined || orbit === null
			? 0
			: cometActivity(
					tail,
					tail.lagDays === undefined
						? distance
						: activityDistanceKm(orbit, tail, frame.jd),
				)
	out.lengthKm = tail === undefined ? 0 : ionTailLengthKm(tail, out.activity)
	out.dustLengthKm =
		tail === undefined ? 0 : dustTailLengthKm(tail, out.activity)
	out.visible = out.lengthKm > 0 || out.dustLengthKm > 0
	if (!out.visible || orbit === null) return out

	// the nucleus as drawn, and how long a true km along the tail is drawn there
	mapTruePointKm(frame, root, root, p[c], p[c + 1], p[c + 2], headKm)
	mapTruePointKm(
		frame,
		root,
		root,
		p[c] + away[0] * COMA_RADIUS_KM,
		p[c + 1] + away[1] * COMA_RADIUS_KM,
		p[c + 2] + away[2] * COMA_RADIUS_KM,
		probeKm,
	)
	const drawnPerKm =
		Math.hypot(
			probeKm[0] - headKm[0],
			probeKm[1] - headKm[1],
			probeKm[2] - headKm[2],
		) / COMA_RADIUS_KM
	const nucleusKm = frame.displayRadiiKm[i]
	const comaKm = Math.max(
		drawnPerKm * COMA_RADIUS_KM * comaGrowth(out.activity),
		COMA_NUCLEUS_RADII * nucleusKm,
	)
	out.nucleusUnits = toUnits(nucleusKm)
	out.comaUnits = toUnits(comaKm)
	out.head[0] = toUnits(headKm[0] - frame.originKm[0])
	out.head[1] = toUnits(headKm[1] - frame.originKm[1])
	out.head[2] = toUnits(headKm[2] - frame.originKm[2])
	// true km from the nucleus to its drawn surface and to the coma's drawn edge
	const surface =
		drawnPerKm > 0
			? trueReachKm(frame, root, p, c, nucleusKm, nucleusKm / drawnPerKm)
			: 0
	const edge =
		drawnPerKm > 0
			? trueReachKm(frame, root, p, c, comaKm, comaKm / drawnPerKm)
			: 0

	cometKm[0] = p[c] - p[root * 3]
	cometKm[1] = p[c + 1] - p[root * 3 + 1]
	cometKm[2] = p[c + 2] - p[root * 3 + 2]
	const dustLength = out.dustLengthKm
	if (
		dustLength > 0 &&
		!(Math.abs(frame.jd - out.dustJD) <= DUST_REFRESH_DAYS)
	) {
		writeDustShape(orbit, frame.jd, cometKm, distance, dustLength, out)
	}
	const shape = out.dustShape
	for (let k = 0; k < TAIL_SAMPLES; k++) {
		const o = k * 3
		// a tail the comet does not grow (Encke's dust, 67P's gas) folds into the nucleus
		const from = k === 0 ? surface : edge
		const along = from + tailShare(k) * out.lengthKm
		if (out.lengthKm > 0) {
			drawPoint(
				frame,
				root,
				p[c] + away[0] * along,
				p[c + 1] + away[1] * along,
				p[c + 2] + away[2] * along,
				out.ion,
				o,
			)
		} else out.ion.set(out.head, o)
		if (dustLength > 0) {
			drawPoint(
				frame,
				root,
				p[c] + away[0] * from + shape[o] * dustLength,
				p[c + 1] + away[1] * from + shape[o + 1] * dustLength,
				p[c + 2] + away[2] * from + shape[o + 2] * dustLength,
				out.dust,
				o,
			)
		} else out.dust.set(out.head, o)
	}
	out.ionUnits = span(out.ion, 1, TAIL_SAMPLES - 1)
	out.dustUnits = span(out.dust, 1, TAIL_SAMPLES - 1)
	return out
}

/** Opacity along a tail at sample `k`: 0 at the nucleus's surface, full at the coma's edge, fading out to the end. */
export const tailAlpha = (k: number): number =>
	k === 0 ? 0 : (1 - tailShare(k)) ** 1.4

const toCamera = new Float64Array(3)

/**
 * A camera-facing ribbon along `axis` (TAIL_SAMPLES points, scene units) into `positions`
 * (2 vertices per sample): half width `widthShare` of the drawn length `lengthUnits` at the
 * end, at most `startHalf` (the coma's radius) at the start, never thinner than `minPx` on
 * screen.
 */
export function writeRibbon(
	axis: Float32Array,
	lengthUnits: number,
	widthShare: number,
	startHalf: number,
	minPx: number,
	camera: { x: number; y: number; z: number },
	pxPerUnitAtOne: number,
	positions: Float32Array,
	at: number,
): void {
	const endHalf = widthShare * lengthUnits
	const firstHalf = Math.min(0.25 * endHalf, startHalf)
	for (let k = 0; k < TAIL_SAMPLES; k++) {
		const s = tailShare(k)
		const o = k * 3
		const prev = Math.max(0, k - 1) * 3
		const next = Math.min(TAIL_SAMPLES - 1, k + 1) * 3
		const tx = axis[next] - axis[prev]
		const ty = axis[next + 1] - axis[prev + 1]
		const tz = axis[next + 2] - axis[prev + 2]
		toCamera[0] = camera.x - axis[o]
		toCamera[1] = camera.y - axis[o + 1]
		toCamera[2] = camera.z - axis[o + 2]
		// side = tangent x toCamera
		let sx = ty * toCamera[2] - tz * toCamera[1]
		let sy = tz * toCamera[0] - tx * toCamera[2]
		let sz = tx * toCamera[1] - ty * toCamera[0]
		const sl = Math.hypot(sx, sy, sz) || 1
		const distance = Math.hypot(toCamera[0], toCamera[1], toCamera[2])
		const minHalf =
			pxPerUnitAtOne > 0 ? (0.5 * minPx * distance) / pxPerUnitAtOne : 0
		const half = Math.max(
			firstHalf + (endHalf - firstHalf) * s,
			minHalf * (0.5 + 0.5 * s),
		)
		sx *= half / sl
		sy *= half / sl
		sz *= half / sl
		const v = at + k * 6
		positions[v] = axis[o] + sx
		positions[v + 1] = axis[o + 1] + sy
		positions[v + 2] = axis[o + 2] + sz
		positions[v + 3] = axis[o] - sx
		positions[v + 4] = axis[o + 1] - sy
		positions[v + 5] = axis[o + 2] - sz
	}
}
