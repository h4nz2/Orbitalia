/**
 * The scale engine (#8): how true sizes and distances become what the screen shows.
 *
 * True scale is the baseline. The simulation (kepler.ts, positions.ts) always
 * works in real kilometres; a `ScaleSettings` is a set of named, deliberate
 * lies applied on top of it, and only the renderer sees the result ("display
 * space", measured in display km). There are three independent factors, each
 * a curve that is the identity at true scale:
 *
 *  - `bodySize`      every radius, compressed toward the root body's radius.
 *                    The root (the Sun) always keeps its true size: it is the
 *                    ruler everything else is drawn against. A preset may size
 *                    moons separately (`moonSize`, against their own planet).
 *  - `orbitDistance` how far bodies orbiting the root are drawn (planets, and
 *                    later dwarf planets, comets, asteroids), in root radii.
 *  - `moonDistance`  how far bodies orbiting any other body are drawn (moons,
 *                    and anything else with a non-root parent), in parent radii.
 *
 * The one rule, and the single source of truth for every derived visual: a
 * body's display position is its parent's display position plus the true
 * parent -> child offset, kept in its true direction and rescaled to
 *
 *     parentDisplayRadius * mapDistance(curve, trueDistance / parentTrueRadius)
 *
 * Orbit lines, rings, labels, moons and camera framing all derive from the
 * display positions and radii computed here, never from factors of their own,
 * so nothing can detach from its parent when the scale changes.
 *
 * Consequences:
 *  - Directions from a parent to its children are always true (which side of
 *    the Sun a planet is on, conjunctions, Kepler's second law as swept
 *    angle). Only distances and sizes lie.
 *  - Nothing is ever drawn inside its parent: every curve is the identity up to
 *    a knee of at least one parent radius and only stretches or squeezes beyond it.
 *  - Whatever orbits within `knee` parent radii (rings, ring moons) keeps its
 *    true proportion to the parent's drawn size.
 *  - Facts (distances, light travel times, sizes shown as text) always come
 *    from the true values, never from display space.
 *
 * Pure: no React, no three.js. Per-frame functions write into caller-owned
 * typed arrays and allocate nothing.
 */
import type { OrbitingBody, WritableVec3 } from "./positions"

/** How radii are drawn. */
export interface SizeCurve {
	/**
	 * Power applied to `radius / rootRadius`: 1 = true. Below 1 small bodies
	 * grow relative to big ones (0.5 turns the Sun's 109 Earth-widths into
	 * about 10). Must be > 0.
	 */
	readonly exponent: number
}

/**
 * A drawn distance pinned by a preset (#54): `[true, drawn]`, both in parent
 * radii (true radii in, drawn radii out).
 */
export type DistanceAnchor = readonly [number, number]

/**
 * How distances from a parent are drawn, measured in the parent's radii
 * (true radii in, drawn radii out): the identity up to `knee`, then
 * `knee * (1 + gain * ((x / knee) ** exponent - 1))` (the power law), or,
 * with `anchors`, a curve through drawn distances pinned one by one.
 */
export interface DistanceCurve {
	/** Parent radii within which distances stay proportional to the parent's drawn size; >= 1. */
	readonly knee: number
	/** Power on the distance beyond the knee (in knees): 1 = proportional, below 1 pulls far orbits in more than near ones; > 0. */
	readonly exponent: number
	/** Multiplier on the stretch beyond the knee: 1 = none, below 1 pulls everything beyond the knee toward it; > 0. */
	readonly gain: number
	/**
	 * Drawn distances pinned one by one (#54, Poster: a poster spaces the
	 * planets by eye, which no power law can, since Venus and Earth are only
	 * 1.35x apart while Mars and Jupiter are 3.4x). Ascending in both columns,
	 * all beyond the knee. Between the knee (drawn at itself) and the anchors
	 * the curve is a monotone cubic (Fritsch-Carlson) in the log of the true
	 * distance; past the last anchor it goes on straight in the log at the last
	 * slope, so whatever lies beyond (dwarf planets, comets, spacecraft) keeps
	 * its order. See `anchoredDistance`.
	 */
	readonly anchors?: readonly DistanceAnchor[]
	/**
	 * Share of the anchored curve, 0..1 (default 1 when `anchors` is given):
	 * the drawn distance is `power ** (1 - w) * anchored ** w`, a geometric
	 * blend that stays monotone, so an animated switch (#21) to or from an
	 * anchored preset moves every body smoothly. At 1 the power law is unused.
	 */
	readonly anchorWeight?: number
}

/** The named, independent scale factors. */
export interface ScaleSettings {
	readonly bodySize: SizeCurve
	/**
	 * How moons (any body whose parent is not the root) are sized, against
	 * their parent: drawn radius = parent's drawn radius * (radius /
	 * parentRadius) ** exponent, so 1 keeps every moon true to its planet's
	 * drawn size. Absent: moons follow `bodySize` like every other body (the
	 * same as `moonSize = bodySize`), which is what every preset but Poster does.
	 */
	readonly moonSize?: SizeCurve
	readonly orbitDistance: DistanceCurve
	readonly moonDistance: DistanceCurve
	/**
	 * How tightly the overview frames the drawn system (#54), 0..1, blended
	 * in a switch: 0 (absent) the shared fit, 1 Poster's tight one
	 * (camera/framing.ts, `overviewDistance`). A framing hint, not a lie.
	 */
	readonly overviewFit?: number
}

export type ScaleFactor = keyof ScaleSettings

/** What the scale engine needs of a body. A schema `Body` satisfies it. */
export interface ScalableBody extends OrbitingBody {
	readonly radiusKm: number
}

const freezeCurve = (curve: DistanceCurve): void => {
	if (curve.anchors !== undefined) {
		for (const anchor of curve.anchors) Object.freeze(anchor)
		Object.freeze(curve.anchors)
	}
	Object.freeze(curve)
}

const deepFreeze = <T extends ScaleSettings>(scale: T): T => {
	Object.freeze(scale.bodySize)
	if (scale.moonSize !== undefined) Object.freeze(scale.moonSize)
	freezeCurve(scale.orbitDistance)
	freezeCurve(scale.moonDistance)
	return Object.freeze(scale)
}

/**
 * Named presets: the only way a scale should ever reach a user (#21 puts the
 * UI on them; a teacher never types a number). `trueScale` is the identity.
 *
 * The values are a product choice (docs/ARCHITECTURE.md, "Scale"), guarded by
 * src/sim/scale.test.ts.
 */
export const SCALE_PRESETS = {
	/** Real sizes, real distances. The planets are invisible specks; that is the lesson. */
	trueScale: deepFreeze({
		bodySize: { exponent: 1 },
		orbitDistance: { knee: 1, exponent: 1, gain: 1 },
		moonDistance: { knee: 3, exponent: 1, gain: 1 },
	}),
	/**
	 * What every diagram shows: sizes true to each other (the Sun really is
	 * 109 Earths wide), distances squeezed hard so the planets sit near it.
	 */
	textbook: deepFreeze({
		bodySize: { exponent: 1 },
		orbitDistance: { knee: 1, exponent: 0.53, gain: 0.12 },
		moonDistance: { knee: 3, exponent: 0.2, gain: 1 },
	}),
	/**
	 * Only the sizes lie (#21, "sizes and distances are separate lies"): bodies
	 * enlarged as in Everything visible, but the planets at their real distances
	 * from the Sun. Even ten times too big, they are lost in empty space. Moon
	 * systems keep Everything visible's gathering: with the planets enlarged, no
	 * moon distance can be true (Phobos would sit inside Mars), and gathered
	 * moons land near their true distance in kilometres (the Moon 1.4x too far).
	 */
	bigPlanets: deepFreeze({
		bodySize: { exponent: 0.5 },
		orbitDistance: { knee: 1, exponent: 1, gain: 1 },
		moonDistance: { knee: 3, exponent: 0.2, gain: 2 },
	}),
	/**
	 * The default the app opens in: small bodies enlarged, far orbits pulled
	 * in, moon systems gathered around their planets. Readable, pretty and
	 * dishonest, and to be labelled as such by #21.
	 */
	everythingVisible: deepFreeze({
		bodySize: { exponent: 0.5 },
		orbitDistance: { knee: 1, exponent: 0.52, gain: 1 },
		moonDistance: { knee: 3, exponent: 0.2, gain: 2 },
	}),
	/**
	 * The classroom poster (#54), the most distorted preset: every planet a
	 * recognisable disc in the whole-system view (Earth at least 12 px across
	 * on a 1366x768 laptop), in true order of size and distance, none touching
	 * another's orbit, the Sun inside Mercury's. Sizes are squeezed hard toward
	 * the Sun's (Jupiter 1.8 Earths across, the planets 5 to 60 times too big);
	 * the planets sit on drawn distances pinned one by one (anchors at each
	 * planet's mean distance, in solar radii, 50 to 500 times too close; the
	 * power law under them is Everything visible's, so a switch between the two
	 * only moves the planets in). Moons keep their true size against their
	 * planet and are gathered close outside its rings (the knee just clears
	 * Jupiter's), so the featured ones never cross a neighbouring orbit; the
	 * long tail is hidden (`HIDES_LONG_TAIL`). The overview frames the drawn
	 * system tight (`overviewFit`). Every number is at a limit the tests guard:
	 * src/sim/poster.test.ts, src/features/solarSystem/camera/poster.test.ts.
	 */
	poster: deepFreeze({
		bodySize: { exponent: 0.28 },
		moonSize: { exponent: 1 },
		orbitDistance: {
			knee: 1,
			exponent: 0.52,
			gain: 1,
			anchors: [
				[83.3, 1.54], // Mercury, 0.39 AU
				[155.6, 2.43], // Venus, 0.72 AU
				[215.1, 3.56], // Earth, 1 AU
				[327.7, 4.94], // Mars, 1.52 AU
				[1119, 7.06], // Jupiter, 5.2 AU
				[2051, 9.43], // Saturn, 9.5 AU
				[4127, 11.82], // Uranus, 19 AU
				[6468, 13.69], // Neptune, 30 AU
			],
		},
		moonDistance: { knee: 2.65, exponent: 0.05, gain: 1.76 },
		overviewFit: 1,
	}),
} as const satisfies Record<string, ScaleSettings>

export type ScalePresetId = keyof typeof SCALE_PRESETS

/** Preset ids in the order a UI should offer them: from the truth to the most readable lie. */
export const SCALE_PRESET_IDS: readonly ScalePresetId[] = Object.freeze([
	"trueScale",
	"textbook",
	"bigPlanets",
	"everythingVisible",
	"poster",
])

/**
 * Presets whose moon systems are packed too tight for the long tail of small
 * moons (#54): `isBodyShown` (src/store/sim.ts) hides them there, All moons
 * or not, so none crosses a neighbouring planet's orbit.
 */
export const HIDES_LONG_TAIL: ReadonlySet<ScalePresetId> = new Set(["poster"])

/** The preset the app opens in (a product decision, #8 / #21). */
export const DEFAULT_SCALE_PRESET: ScalePresetId = "everythingVisible"

export const TRUE_SCALE: ScaleSettings = SCALE_PRESETS.trueScale

export const isScalePresetId = (id: unknown): id is ScalePresetId =>
	typeof id === "string" && Object.hasOwn(SCALE_PRESETS, id)

/** The share of the anchored curve in `curve` (0 without anchors). */
export const anchorWeightOf = (curve: DistanceCurve): number =>
	curve.anchors === undefined || curve.anchors.length === 0
		? 0
		: (curve.anchorWeight ?? 1)

/** True when the curve maps every distance to itself. */
export const isIdentityCurve = (curve: DistanceCurve): boolean =>
	curve.exponent === 1 && curve.gain === 1 && !(anchorWeightOf(curve) > 0)

/** The power law beyond the knee (`x > knee`). */
const powerDistance = (curve: DistanceCurve, x: number): number =>
	curve.exponent === 1 && curve.gain === 1
		? x
		: curve.knee * (1 + curve.gain * ((x / curve.knee) ** curve.exponent - 1))

/**
 * An anchored curve's nodes (the knee first, then every anchor): the log of
 * the true distance `u`, the drawn distance `y` and the slope `m` (dy/du)
 * there. What `anchoredDistance` interpolates, and what the belt shader is fed.
 */
export interface AnchorSpline {
	readonly u: Float64Array
	readonly y: Float64Array
	readonly m: Float64Array
}

// per anchors array (presets are frozen, so the spline is built once), for the last knee asked
const splines = new WeakMap<
	readonly DistanceAnchor[],
	{ readonly knee: number; readonly spline: AnchorSpline }
>()

/**
 * The monotone cubic through (ln knee, knee) and every anchor, in the log of
 * the true distance (Fritsch-Carlson slopes: the weighted harmonic mean of
 * the neighbouring secants inside, the secant at the ends), so it never
 * overshoots between anchors and every distance keeps its order.
 */
export function anchorSpline(
	knee: number,
	anchors: readonly DistanceAnchor[],
): AnchorSpline {
	const cached = splines.get(anchors)
	if (cached !== undefined && cached.knee === knee) return cached.spline
	const n = anchors.length + 1
	const u = new Float64Array(n)
	const y = new Float64Array(n)
	const m = new Float64Array(n)
	u[0] = Math.log(knee)
	y[0] = knee
	for (let k = 1; k < n; k++) {
		u[k] = Math.log(anchors[k - 1][0])
		y[k] = anchors[k - 1][1]
	}
	const secant = (k: number) => (y[k + 1] - y[k]) / (u[k + 1] - u[k])
	m[0] = secant(0)
	m[n - 1] = secant(n - 2)
	for (let k = 1; k < n - 1; k++) {
		const d0 = secant(k - 1)
		const d1 = secant(k)
		const h0 = u[k] - u[k - 1]
		const h1 = u[k + 1] - u[k]
		const w0 = 2 * h1 + h0
		const w1 = h1 + 2 * h0
		m[k] = d0 > 0 && d1 > 0 ? (w0 + w1) / (w0 / d0 + w1 / d1) : 0
	}
	const spline = { u, y, m }
	splines.set(anchors, { knee, spline })
	return spline
}

/**
 * An anchored curve beyond the knee (`x > knee`), drawn parent radii: the
 * monotone cubic through the anchors, and past the last one a straight line
 * in the log at the last slope.
 */
export function anchoredDistance(
	knee: number,
	anchors: readonly DistanceAnchor[],
	x: number,
): number {
	const { u, y, m } = anchorSpline(knee, anchors)
	const v = Math.log(x)
	const last = u.length - 1
	if (v >= u[last]) return y[last] + m[last] * (v - u[last])
	let k = 0
	while (k < last - 1 && v >= u[k + 1]) k++
	const h = u[k + 1] - u[k]
	const t = (v - u[k]) / h
	const t2 = t * t
	const t3 = t2 * t
	return (
		(2 * t3 - 3 * t2 + 1) * y[k] +
		(t3 - 2 * t2 + t) * h * m[k] +
		(-2 * t3 + 3 * t2) * y[k + 1] +
		(t3 - t2) * h * m[k + 1]
	)
}

/**
 * Drawn distance for a true distance, both in parent radii (true radii in,
 * drawn radii out). The identity up to the knee; monotone; never below
 * `min(x, knee)`, so a body outside its parent stays outside it.
 */
export function mapDistance(curve: DistanceCurve, x: number): number {
	const { knee } = curve
	if (!(x > knee) || isIdentityCurve(curve)) return x
	const w = anchorWeightOf(curve)
	if (!(w > 0)) return powerDistance(curve, x)
	const anchored = anchoredDistance(knee, curve.anchors ?? [], x)
	if (w >= 1) return anchored
	return powerDistance(curve, x) ** (1 - w) * anchored ** w
}

/**
 * The inverse of `mapDistance`: the true distance (parent radii) that is drawn
 * at `y` drawn parent radii. Exact for the power law; for an anchored curve
 * (monotone, unbounded) solved by bisection in the log to the last bits.
 */
export function unmapDistance(curve: DistanceCurve, y: number): number {
	const { knee } = curve
	if (!(y > knee) || isIdentityCurve(curve)) return y
	if (!(anchorWeightOf(curve) > 0)) {
		return knee * ((y / knee - 1) / curve.gain + 1) ** (1 / curve.exponent)
	}
	if (!Number.isFinite(y)) return y
	let lo = Math.log(knee)
	let hi = lo + 1
	while (mapDistance(curve, Math.exp(hi)) < y && hi < 1e3)
		hi = lo + 2 * (hi - lo)
	for (let i = 0; i < 200 && hi - lo > 1e-15 * Math.max(1, Math.abs(hi)); i++) {
		const mid = (lo + hi) / 2
		if (mapDistance(curve, Math.exp(mid)) < y) lo = mid
		else hi = mid
	}
	return Math.exp((lo + hi) / 2)
}

/** `mapDistance(curve, x) / x`: how much longer (> 1) or shorter (< 1) a distance is drawn, relative to the parent's drawn size. */
export const distanceFactor = (curve: DistanceCurve, x: number): number =>
	x > 0 ? mapDistance(curve, x) / x : 1

/** A body's drawn radius (display km). The root, whose radius is `rootRadiusKm`, keeps its true size. */
export function displayRadiusKm(
	radiusKm: number,
	rootRadiusKm: number,
	size: SizeCurve,
): number {
	if (size.exponent === 1) return radiusKm
	return rootRadiusKm * (radiusKm / rootRadiusKm) ** size.exponent
}

/** The size curve moons (bodies whose parent is not the root) are drawn with: `moonSize`, else `bodySize`. */
export const moonSizeOf = (scale: ScaleSettings): SizeCurve =>
	scale.moonSize ?? scale.bodySize

/**
 * A moon's drawn radius (display km): its parent's drawn radius times
 * `(radius / parentRadius) ** moonSize.exponent`. When moons follow
 * `bodySize` (every preset but Poster) that is exactly `displayRadiusKm`,
 * and it is computed that way, to the last bit.
 */
export function displayMoonRadiusKm(
	radiusKm: number,
	parentRadiusKm: number,
	parentDisplayRadiusKm: number,
	rootRadiusKm: number,
	scale: ScaleSettings,
): number {
	const moon = moonSizeOf(scale)
	if (moon.exponent === scale.bodySize.exponent) {
		return displayRadiusKm(radiusKm, rootRadiusKm, scale.bodySize)
	}
	return parentDisplayRadiusKm * (radiusKm / parentRadiusKm) ** moon.exponent
}

/**
 * A length that belongs to a body (ring radii, an atmosphere, a label's offset
 * from the centre) as drawn: it scales with the body's drawn radius, so it can
 * never detach from it. Rings sit inside `moonDistance.knee` parent radii, the
 * zone where moons keep true proportions too, so ring moons stay in their gaps.
 */
export const displayBodyLengthKm = (
	lengthKm: number,
	radiusKm: number,
	displayRadiusKm: number,
): number => lengthKm * (displayRadiusKm / radiusKm)

/** How many times larger than true a body is drawn, measured against the (true-size) root. */
export const sizeExaggeration = (
	radiusKm: number,
	rootRadiusKm: number,
	size: SizeCurve,
): number => displayRadiusKm(radiusKm, rootRadiusKm, size) / radiusKm

/**
 * The curve that places the children of a body: `orbitDistance` around the
 * root, `moonDistance` around anything else. Depth decides, never the body
 * kind, so a new kind of body (a dwarf planet, a comet, a moon of a dwarf
 * planet) needs no special case.
 */
export const childDistanceCurve = (
	scale: ScaleSettings,
	parentIsRoot: boolean,
): DistanceCurve => (parentIsRoot ? scale.orbitDistance : scale.moonDistance)

/** Drawn distance (display km) of a child at `distanceKm` (true) from its parent. */
export function displayDistanceKm(
	distanceKm: number,
	parentRadiusKm: number,
	parentDisplayRadiusKm: number,
	curve: DistanceCurve,
): number {
	return parentDisplayRadiusKm * mapDistance(curve, distanceKm / parentRadiusKm)
}

/**
 * Maps a parent-centric offset (true km) to its display offset (display km)
 * and writes it into `out[at..at + 2]`: the same direction, rescaled to
 * `displayDistanceKm(|offset|, ...)`. This is the one function every body
 * position and every orbit line vertex goes through.
 */
export function displayOffset(
	x: number,
	y: number,
	z: number,
	parentRadiusKm: number,
	parentDisplayRadiusKm: number,
	curve: DistanceCurve,
	out: WritableVec3,
	at = 0,
): void {
	const distance = Math.sqrt(x * x + y * y + z * z)
	let factor = parentDisplayRadiusKm / parentRadiusKm
	if (distance > 0) {
		const n = distance / parentRadiusKm
		factor *= mapDistance(curve, n) / n
	}
	out[at] = x * factor
	out[at + 1] = y * factor
	out[at + 2] = z * factor
}

/**
 * The inverse of `displayOffset`: the parent-centric true offset (km) that is
 * drawn at display offset (x, y, z). A point in empty space kept in true km
 * relative to an anchor body (a free camera pivot, #15) goes back to exactly
 * the same drawn place under the same scale, and follows its neighbourhood
 * when the scale changes.
 */
export function trueOffset(
	x: number,
	y: number,
	z: number,
	parentRadiusKm: number,
	parentDisplayRadiusKm: number,
	curve: DistanceCurve,
	out: WritableVec3,
	at = 0,
): void {
	const drawn = Math.sqrt(x * x + y * y + z * z)
	let factor = parentRadiusKm / parentDisplayRadiusKm
	if (drawn > 0) {
		const n = drawn / parentDisplayRadiusKm
		factor = (unmapDistance(curve, n) * parentRadiusKm) / drawn
	}
	out[at] = x * factor
	out[at + 1] = y * factor
	out[at + 2] = z * factor
}

/** Index of the root (the first body without a parent); throws when there is none. */
export function rootIndexOf(bodies: readonly ScalableBody[]): number {
	const root = bodies.findIndex((body) => body.parentId === null)
	if (root < 0) throw new Error("scale: the bodies have no root")
	return root
}

/**
 * Drawn radius (display km) of every body, in `bodies` order: `bodySize`
 * against the root, moons (a parent other than the root) `moonSize` against
 * their parent (`displayMoonRadiusKm`).
 *
 * @param bodies topological order (every parent before its children) when the
 *               scale sizes moons on their own (`moonSize`)
 * @param out    reused when given and long enough, else a new array is allocated
 */
export function computeDisplayRadii(
	bodies: readonly ScalableBody[],
	scale: ScaleSettings,
	out?: Float64Array,
): Float64Array {
	const radii =
		out !== undefined && out.length >= bodies.length
			? out
			: new Float64Array(bodies.length)
	const rootRadius = bodies[rootIndexOf(bodies)].radiusKm
	const parents =
		moonSizeOf(scale).exponent === scale.bodySize.exponent
			? null
			: moonParents(bodies)
	for (let i = 0; i < bodies.length; i++) {
		const p = parents === null ? -1 : parents[i]
		radii[i] =
			p < 0
				? displayRadiusKm(bodies[i].radiusKm, rootRadius, scale.bodySize)
				: displayMoonRadiusKm(
						bodies[i].radiusKm,
						bodies[p].radiusKm,
						radii[p],
						rootRadius,
						scale,
					)
	}
	return radii
}

// per bodies array: built once, so a preset switch (one call per frame) allocates nothing
const moonParentCache = new WeakMap<readonly ScalableBody[], Int32Array>()

/**
 * Index of every moon's parent (a body whose parent is not the root), -1 for
 * the root and its children.
 *
 * @throws Error when a moon's parent is unknown or comes after it
 */
function moonParents(bodies: readonly ScalableBody[]): Int32Array {
	const cached = moonParentCache.get(bodies)
	if (cached !== undefined && cached.length === bodies.length) return cached
	const parents = new Int32Array(bodies.length).fill(-1)
	const index = new Map<string, number>()
	for (let i = 0; i < bodies.length; i++) {
		const body = bodies[i]
		index.set(body.id, i)
		if (body.parentId === null) continue
		const p = index.get(body.parentId)
		if (p === undefined) {
			throw new Error(
				`computeDisplayRadii: parent "${body.parentId}" of "${body.id}" is unknown or comes after it`,
			)
		}
		if (bodies[p].parentId !== null) parents[i] = p
	}
	moonParentCache.set(bodies, parents)
	return parents
}

/**
 * Display positions (display km, scene axes) of every body from their true
 * world positions: roots stay where they are, every other body goes to its
 * parent's display position plus `displayOffset` of its true offset.
 *
 * @param bodies        topological order (every parent before its children)
 * @param truePositions written by computePositions(), 3 doubles per body
 * @param displayRadii  written by computeDisplayRadii() for the same scale
 * @param index         prebuilt buildIndex(bodies) of this same array
 * @param out           reused when given and long enough, else allocated
 * @throws Error when a parent is unknown or comes after its child
 */
export function computeDisplayPositions(
	bodies: readonly ScalableBody[],
	truePositions: Float64Array,
	displayRadii: Float64Array,
	scale: ScaleSettings,
	index: ReadonlyMap<string, number>,
	out?: Float64Array,
): Float64Array {
	const needed = bodies.length * 3
	const display =
		out !== undefined && out.length >= needed ? out : new Float64Array(needed)
	for (let i = 0; i < bodies.length; i++) {
		const body = bodies[i]
		const o = i * 3
		if (body.parentId === null) {
			display[o] = truePositions[o]
			display[o + 1] = truePositions[o + 1]
			display[o + 2] = truePositions[o + 2]
			continue
		}
		const p = index.get(body.parentId)
		if (p === undefined || p >= i) {
			throw new Error(
				`computeDisplayPositions: parent "${body.parentId}" of "${body.id}" is unknown or comes after it`,
			)
		}
		const parent = bodies[p]
		const q = p * 3
		displayOffset(
			truePositions[o] - truePositions[q],
			truePositions[o + 1] - truePositions[q + 1],
			truePositions[o + 2] - truePositions[q + 2],
			parent.radiusKm,
			displayRadii[p],
			childDistanceCurve(scale, parent.parentId === null),
			display,
			o,
		)
		display[o] += display[q]
		display[o + 1] += display[q + 1]
		display[o + 2] += display[q + 2]
	}
	return display
}

const isPositive = (value: number): boolean =>
	Number.isFinite(value) && value > 0

const isShare = (value: number | undefined): boolean =>
	value === undefined || (Number.isFinite(value) && value >= 0 && value <= 1)

/** Anchors ascending in both columns, all beyond the knee (so the curve is monotone and never inside the parent). */
const isValidAnchors = (
	knee: number,
	anchors: readonly DistanceAnchor[] | undefined,
): boolean => {
	if (anchors === undefined) return true
	let x = knee
	let y = knee
	for (const anchor of anchors) {
		if (
			!Array.isArray(anchor) ||
			!Number.isFinite(anchor[0]) ||
			!Number.isFinite(anchor[1]) ||
			!(anchor[0] > x) ||
			!(anchor[1] > y)
		) {
			return false
		}
		x = anchor[0]
		y = anchor[1]
	}
	return true
}

const isValidCurve = (curve: DistanceCurve | undefined): boolean =>
	curve !== undefined &&
	Number.isFinite(curve.knee) &&
	curve.knee >= 1 &&
	isPositive(curve.exponent) &&
	isPositive(curve.gain) &&
	isValidAnchors(curve.knee, curve.anchors) &&
	isShare(curve.anchorWeight)

/** Every factor present, finite, exponents and gains positive, knees at least one parent radius, anchors ascending beyond the knee. */
export const isValidScale = (scale: ScaleSettings | undefined): boolean =>
	scale !== undefined &&
	scale.bodySize !== undefined &&
	isPositive(scale.bodySize.exponent) &&
	(scale.moonSize === undefined || isPositive(scale.moonSize.exponent)) &&
	isValidCurve(scale.orbitDistance) &&
	isValidCurve(scale.moonDistance) &&
	isShare(scale.overviewFit)

const sameAnchors = (
	a: readonly DistanceAnchor[] | undefined,
	b: readonly DistanceAnchor[] | undefined,
): boolean =>
	a === b ||
	(a !== undefined &&
		b !== undefined &&
		a.length === b.length &&
		a.every((anchor, k) => anchor[0] === b[k][0] && anchor[1] === b[k][1]))

const sameCurve = (a: DistanceCurve, b: DistanceCurve): boolean =>
	a.knee === b.knee &&
	a.exponent === b.exponent &&
	a.gain === b.gain &&
	anchorWeightOf(a) === anchorWeightOf(b) &&
	(!(anchorWeightOf(a) > 0) || sameAnchors(a.anchors, b.anchors))

export const sameScale = (a: ScaleSettings, b: ScaleSettings): boolean =>
	a.bodySize.exponent === b.bodySize.exponent &&
	moonSizeOf(a).exponent === moonSizeOf(b).exponent &&
	sameCurve(a.orbitDistance, b.orbitDistance) &&
	sameCurve(a.moonDistance, b.moonDistance) &&
	(a.overviewFit ?? 0) === (b.overviewFit ?? 0)

/** The preset these settings are, or null for any other mix (or mid-transition). */
export const presetOf = (scale: ScaleSettings): ScalePresetId | null =>
	SCALE_PRESET_IDS.find((id) => sameScale(SCALE_PRESETS[id], scale)) ?? null

export const isTrueScale = (scale: ScaleSettings): boolean =>
	sameScale(scale, TRUE_SCALE)

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
// gains are multiplicative: blend them geometrically so a transition moves evenly
const lerpLog = (a: number, b: number, t: number): number =>
	a === b ? a : a * (b / a) ** t

/**
 * The anchors of a blend: the one side's when only one has any (or both the
 * same), else each drawn distance blended geometrically (anchors at the same
 * true distances; with a different number of anchors the target's win).
 */
const lerpAnchors = (
	a: readonly DistanceAnchor[] | undefined,
	b: readonly DistanceAnchor[] | undefined,
	t: number,
): readonly DistanceAnchor[] | undefined => {
	if (a === undefined || a.length === 0 || sameAnchors(a, b)) return b ?? a
	if (b === undefined || b.length === 0) return a
	if (a.length !== b.length) return b
	return a.map((anchor, k): DistanceAnchor => [
		lerpLog(anchor[0], b[k][0], t),
		lerpLog(anchor[1], b[k][1], t),
	])
}

const lerpCurve = (
	a: DistanceCurve,
	b: DistanceCurve,
	t: number,
): DistanceCurve => {
	const power = {
		knee: lerp(a.knee, b.knee, t),
		exponent: lerp(a.exponent, b.exponent, t),
		gain: lerpLog(a.gain, b.gain, t),
	}
	const wa = anchorWeightOf(a)
	const wb = anchorWeightOf(b)
	if (!(wa > 0) && !(wb > 0)) return power
	return {
		...power,
		anchors: lerpAnchors(
			wa > 0 ? a.anchors : undefined,
			wb > 0 ? b.anchors : undefined,
			t,
		),
		anchorWeight: lerp(wa, wb, t),
	}
}

/**
 * The scale a fraction `t` (clamped to 0..1) of the way from `from` to `to`,
 * for animated preset changes (#21): exponents, knees, the anchored share and
 * the overview fit blend linearly, gains and anchored distances
 * geometrically. Returns `from` / `to` themselves at the ends, so a finished
 * transition is recognised by `presetOf`.
 */
export function interpolateScale(
	from: ScaleSettings,
	to: ScaleSettings,
	t: number,
): ScaleSettings {
	const f = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
	if (f === 0) return from
	if (f === 1) return to
	const blend: ScaleSettings = {
		bodySize: {
			exponent: lerp(from.bodySize.exponent, to.bodySize.exponent, f),
		},
		orbitDistance: lerpCurve(from.orbitDistance, to.orbitDistance, f),
		moonDistance: lerpCurve(from.moonDistance, to.moonDistance, f),
	}
	const moons =
		from.moonSize === undefined && to.moonSize === undefined
			? undefined
			: lerp(moonSizeOf(from).exponent, moonSizeOf(to).exponent, f)
	const fit =
		from.overviewFit === undefined && to.overviewFit === undefined
			? undefined
			: lerp(from.overviewFit ?? 0, to.overviewFit ?? 0, f)
	if (moons === undefined && fit === undefined) return blend
	return {
		...blend,
		...(moons === undefined ? {} : { moonSize: { exponent: moons } }),
		...(fit === undefined ? {} : { overviewFit: fit }),
	}
}
