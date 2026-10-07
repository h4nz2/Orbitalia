/**
 * How a spacecraft is drawn near a planet (issue #56, docs/ARCHITECTURE.md,
 * "Spacecraft"). Pure: no React, no three.js; the per-instant functions
 * allocate nothing.
 *
 * In a distorted scale the planet is drawn bigger than true and its moon
 * system is gathered around it (the moon curve), while the Sun-centred map
 * squeezes the planet's whole neighbourhood into a speck. A craft passing
 * the planet must be drawn in both: around the drawn planet near it, in the
 * Sun-centred map far from it. Mapping its planet-centred offset with the
 * moon curve alone (the radial squeeze of `displayOffset`) keeps circles
 * round but bends straight legs in toward the centre, and the two maps
 * disagree where they meet. Instead, near the planet the craft follows a
 * drawn copy of its own hyperbola:
 *
 *  - The shape. The drawn curve is built from the true one's direction of
 *    motion, point by point, with a local stretch: within `coreKm` of the
 *    planet a plain scale `k` (the drawn planet radius over the true one
 *    inside the moon curve's knee, so rings and inner moons keep their
 *    places; beyond the knee the factor that puts the closest approach on
 *    the moon curve), farther out relaxing smoothly to the stretch of the
 *    Sun-centred map. So near the planet the drawn curve is the true
 *    hyperbola scaled, with the true turn (the gravity assist), and far out
 *    its legs are what the Sun-centred map draws of them, through the map
 *    itself (an anchored curve's local scale changes too quickly across the
 *    millions of km of a leg to stand in for it, #54). The closest approach
 *    is drawn where the moon curve draws that distance: outside the drawn
 *    planet and on the same side of every moon's drawn orbit as in reality.
 *  - The pace. Drawn `k / A` times bigger than the Sun-centred map draws it
 *    (A: the stretch along the leg), the planet-centred motion would outrun
 *    the planet's own drawn motion by the same factor, and the Sun-centred
 *    path would show the planet-centred turn followed by a turn back (a
 *    hook, or a zigzag for a craft braking at Venus). So the craft travels
 *    its drawn curve at about the speed the Sun-centred map gives it: time
 *    near the planet runs slower for the drawing by the local stretch.
 *    Relative to the drawn planet it traces the drawn hyperbola, passing the
 *    closest point at the true instant; in the Sun's frame its path is a
 *    smooth curve with the heliocentric bend. Away from the planet the
 *    slowdown fades and the drawing keeps pace with the true craft again.
 *  - The window. A passage owns the stretch of time until the craft is as
 *    near another planet (in Hill radii), and at most `ORBIT_SHARE` of its
 *    orbit around the Sun (src/sim/spacecraft.ts). Where the slowdown would
 *    put the drawing out of step with the clock by more than `LAG_SHARE` of
 *    that, the passage is drawn more compactly (a second profile, a tighter
 *    turn that is still a smooth one), then the legs catch up by running
 *    faster than the craft for a while, and only then is the slowdown cut
 *    (Poster, whose planets are drawn hundreds to thousands of times bigger
 *    than the Sun-centred map draws their neighbourhoods).
 *  - The hand-over. What is left between the drawn legs and the Sun-centred
 *    placement (the drawn flyby's breadth, what is left of the lag) is
 *    blended away by a smoothstep of the drawing's distance, from where the
 *    slowdown is over and the Sun-centred map draws the leg well clear of
 *    the drawn flyby (found by a search through the map, not a linear
 *    guess) to the window's edge.
 *
 * At true scale every stretch is 1 and the drawing is the true path.
 *
 * Bound phases (a parking orbit before the escape burn, the orbits after an
 * orbit insertion, JWST around L2) are drawn like moons: `displayOffset` with
 * the moon curve, in real time, matching the local track of an orbit phase.
 */
import {
	anchorWeightOf,
	childDistanceCurve,
	displayOffset,
	isIdentityCurve,
	mapDistance,
	type ScaleSettings,
} from "./scale"
import { SECONDS_PER_DAY } from "./units"

import type { WritableVec3 } from "./positions"

/** Newton's gravitational constant in km^3 / (kg s^2). */
export const GRAVITATIONAL_CONSTANT = 6.6743e-20

/** Within this many planet radii the drawn hyperbola keeps true proportion (the moon curve's knee). */
export const CORE_RADII = 3
/** Beyond the core the drawn scale relaxes to the Sun-centred one: half way at `1 + 1 / RELAX_RATE` core radii ... */
export const RELAX_RATE = 2
/** ... and its excess falls off as (distance / core) ** -RELAX_POWER. */
export const RELAX_POWER = 1.5
/** The same for the compact drawing, used where a passage's window is too short for the roomy one (Poster) ... */
export const COMPACT_RATE = 6
export const COMPACT_POWER = 2
/**
 * ... which never turns more sharply than a circle this many times its core's
 * drawn radius: the fall-off alone would leave the rest of the turn to be
 * drawn at the Sun-centred map's scale, a corner where that is tiny.
 */
export const COMPACT_TURN = 1.2
/** Below this eccentricity a "flyby" is drawn as a bound orbit. */
const MIN_HYPERBOLIC_E = 1.001

const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number =>
	a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** An osculating hyperbola around a planet, in scene axes. */
export interface Hyperbola {
	/** Gravitational parameter of the planet, km^3/s^2. */
	readonly mu: number
	readonly e: number
	/** Semi-major axis (positive), km. */
	readonly a: number
	/** Semi-minor axis = impact parameter, km. */
	readonly b: number
	/** Semi-latus rectum, km. */
	readonly semiLatus: number
	/** Periapsis distance, km. */
	readonly rp: number
	/** Mean motion, rad/s. */
	readonly n: number
	/** Time of periapsis, JD. */
	readonly tp: number
	/** Unit vectors: towards periapsis, along the motion there, the orbit normal. */
	readonly p: Float64Array
	readonly q: Float64Array
	readonly h: Float64Array
	/** Directions of motion far before and far after periapsis. */
	readonly uIn: Float64Array
	readonly uOut: Float64Array
}

/**
 * The osculating hyperbola of a planet-centred state (position km, velocity
 * km/s) at `jd`, or null when the orbit is bound (or nearly parabolic).
 */
export function osculatingHyperbola(
	position: ArrayLike<number>,
	velocity: ArrayLike<number>,
	jd: number,
	mu: number,
): Hyperbola | null {
	const r = Math.hypot(position[0], position[1], position[2])
	const v2 = dot(velocity, velocity)
	const rv = dot(position, velocity)
	const hx = position[1] * velocity[2] - position[2] * velocity[1]
	const hy = position[2] * velocity[0] - position[0] * velocity[2]
	const hz = position[0] * velocity[1] - position[1] * velocity[0]
	const hn = Math.hypot(hx, hy, hz)
	const c = v2 - mu / r
	const ev = [0, 1, 2].map((k) => (c * position[k] - rv * velocity[k]) / mu)
	const e = Math.hypot(ev[0], ev[1], ev[2])
	if (!(e > MIN_HYPERBOLIC_E) || !(hn > 0)) return null
	const h = Float64Array.of(hx / hn, hy / hn, hz / hn)
	const p = Float64Array.of(ev[0] / e, ev[1] / e, ev[2] / e)
	const q = Float64Array.of(
		h[1] * p[2] - h[2] * p[1],
		h[2] * p[0] - h[0] * p[2],
		h[0] * p[1] - h[1] * p[0],
	)
	const semiLatus = (hn * hn) / mu
	const rp = semiLatus / (1 + e)
	const a = rp / (e - 1)
	const n = Math.sqrt(mu / (a * a * a))
	// time since periapsis from the true anomaly
	const nu = Math.atan2(dot(position, q), dot(position, p))
	const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2))
	const tp = jd - (e * Math.sinh(F) - F) / n / SECONDS_PER_DAY
	const cosInf = -1 / e
	const sinInf = Math.sqrt(1 - cosInf * cosInf)
	const uOut = new Float64Array(3)
	const uIn = new Float64Array(3)
	for (let k = 0; k < 3; k++) {
		uOut[k] = cosInf * p[k] + sinInf * q[k]
		uIn[k] = -cosInf * p[k] + sinInf * q[k]
	}
	return {
		mu,
		e,
		a,
		b: a * Math.sqrt(e * e - 1),
		semiLatus,
		rp,
		n,
		tp,
		p,
		q,
		h,
		uIn,
		uOut,
	}
}

/** Mean anomaly of the hyperbola at anomaly F. */
const meanAnomaly = (e: number, F: number): number => e * Math.sinh(F) - F

/** The hyperbolic anomaly F at mean anomaly M (Kepler's equation, Newton). */
export function hyperbolicAnomaly(e: number, M: number): number {
	let F = Math.asinh(M / e)
	for (let i = 0; i < 60; i++) {
		const step = (e * Math.sinh(F) - F - M) / (e * Math.cosh(F) - 1)
		F -= step
		if (Math.abs(step) < 1e-13 * (1 + Math.abs(F))) break
	}
	return F
}

/** The angle, in radians, by which the planet turned the craft (between the legs). */
export const turnAngle = (hyperbola: Pick<Hyperbola, "e">): number =>
	2 * Math.asin(1 / hyperbola.e)

/**
 * The drawing's tables along a hyperbola: integrals over the hyperbolic
 * anomaly F, from F = 0, of the weights that shape the drawn curve and its
 * pace. They depend on the hyperbola alone, so they are built once per
 * trajectory; a scale only scales them (see `prepareFlyby`).
 *
 * The local stretch at a point of the drawn curve is
 *
 *   M = k omega + (1 - omega) ((1 - eta) A + eta J),
 *
 * with omega the share of the core stretch (1 inside the core, falling off
 * beyond), eta the share of the Sun-centred map's skew (0 out to
 * `SKEW_FROM` core radii, 1 beyond `SKEW_TO`: until then the legs keep
 * their true directions), A the Sun-centred stretch along the leg (blended
 * from the incoming leg's to the outgoing one's by sigma, a smooth step
 * through periapsis) and J the Sun-centred map's stretch at the planet. With
 * rho the share of the slowdown (0 at an escape burn that ends a parking
 * orbit, so the pace is continuous there) and tau the share of the catch-up
 * on the legs (see `catchShare`), per node:
 *
 *   W = int omega dH,  Vi = int (1 - omega)(1 - eta)(1 - sigma) dH,
 *   Vo = int (1 - omega)(1 - eta) sigma dH (2D, perifocal),
 *   T = int rho omega dM,  To = int rho omega sigma dM,
 *   Ci = int rho tau (1 - sigma) dM,  Co = int rho tau sigma dM,
 *
 * and the rest of the arc, int (1 - omega) eta dH, is H(F) - H(0) - W - Vi - Vo.
 *
 * Every value is linear in omega, so the tables are kept for two relaxation
 * profiles, a roomy one and a compact one (a smaller core, a faster fall-off)
 * for passages whose window is too short for the roomy drawing; a scale
 * mixes them (`FlybyScale.compact`), exactly.
 */
export interface FlybyTable {
	/** F of the first node and the spacing. */
	readonly first: number
	readonly step: number
	readonly count: number
	/** 20 values per node: W (x, y), Vi (x, y), Vo (x, y), T, To, Ci, Co for the roomy profile, then for the compact one. */
	readonly values: Float64Array
	/** Their derivatives in F at each node (the integrands), for the Hermite interpolation. */
	readonly rates: Float64Array
	/** The core radius (km) of the roomy and of the compact profile. */
	readonly coreKm: number
	readonly compactKm: number
	/** The true distance (km) at the window's edge before and after periapsis: the catch-up is over well inside it. */
	readonly edgeKm: readonly [number, number]
	/** F where the slowdown ramp is 0 (a burn), and its half width; width 0 = no ramp. */
	readonly rampF: number
	readonly rampWidth: number
}

const PROFILE = 10
const STRIDE = 2 * PROFILE

/** The legs take on the Sun-centred map's skew between these many core radii. */
export const SKEW_FROM = 3
export const SKEW_TO = 100

/** Smoothstep on [0, 1]. */
export const smoothstep = (x: number): number =>
	x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x)

/** Share of the core stretch at distance `r` km for a core of `coreKm` relaxing at `rate` and `power`. */
export function coreShare(
	coreKm: number,
	r: number,
	rate = RELAX_RATE,
	power = RELAX_POWER,
): number {
	if (!(r > coreKm)) return 1
	const x = rate * (r / coreKm - 1)
	return (1 + x * x) ** (-power / 2)
}

/**
 * The core share of the compact profile at distance `r` km: a fast fall-off
 * beyond `compactKm`, but at least what keeps the drawn curve's radius of
 * curvature (the core share times the true one, `|H'|^3 / ab`) at
 * `COMPACT_TURN` times the core's.
 */
export function compactShare(
	hyp: Pick<Hyperbola, "a" | "b" | "e">,
	compactKm: number,
	r: number,
): number {
	const fast = coreShare(compactKm, r, COMPACT_RATE, COMPACT_POWER)
	if (!(fast < 1)) return 1
	const { a, b, e } = hyp
	const ch = Math.max(1, (r / a + 1) / e)
	const speed2 = (a * a + b * b) * ch * ch - a * a
	const curvatureRadius = (speed2 * Math.sqrt(speed2)) / (a * b)
	return Math.max(
		fast,
		Math.min(1, (COMPACT_TURN * compactKm) / curvatureRadius),
	)
}

/** The core share of the roomy and the compact profile, mixed by `compact` (0..1). */
export function mixedCoreShare(
	hyp: Pick<Hyperbola, "a" | "b" | "e">,
	table: Pick<FlybyTable, "coreKm" | "compactKm">,
	compact: number,
	r: number,
): number {
	const roomy = coreShare(table.coreKm, r)
	if (!(compact > 0)) return roomy
	const tight = compactShare(hyp, table.compactKm, r)
	return (1 - compact) * roomy + compact * tight
}

/** Share of the outgoing leg at anomaly F (through periapsis). */
export const outShare = (F: number): number => 0.5 * (1 + Math.tanh(F))

/** The catch-up on a leg rises from this many core radii out ... */
export const CATCH_FROM = 10
/** ... to these shares of the true distance at the window's edge, where it is in full and starts to fade, and is over at the second. */
export const CATCH_FADE_FROM = 0.25
export const CATCH_FADE_TO = 0.75
/** The catch-up runs the drawing at most 1 / (1 - this) times faster than the craft. */
export const CATCH_MAX = 0.8

/**
 * Share of the catch-up at distance `r` km on one side of periapsis (`edgeKm`
 * the true distance at that side's window edge): where the slowdown near the
 * planet would leave the drawing out of step with the clock by more than its
 * window can take (`LAG_SHARE`), the legs make it up by running faster than
 * the craft (`FlybyScale.catchIn`). The share rises and falls smoothly and
 * linearly in the distance, so evenly in time along the leg, and the drawn
 * craft never changes speed abruptly (Poster, #54).
 */
export function catchShare(
	table: Pick<FlybyTable, "coreKm">,
	edgeKm: number,
	r: number,
): number {
	const from = CATCH_FROM * table.coreKm
	const fadeTo = CATCH_FADE_TO * edgeKm
	if (!(r > from) || !(r < fadeTo)) return 0
	const fadeFrom = Math.max(CATCH_FADE_FROM * edgeKm, (from + fadeTo) / 2)
	const rise = smoothstep((r - from) / (fadeFrom - from))
	return rise * (1 - smoothstep((r - fadeFrom) / (fadeTo - fadeFrom)))
}

/** Share of the Sun-centred map's skew at distance `r` km. */
export function skewShare(coreKm: number, r: number): number {
	const x = r / coreKm
	if (!(x > SKEW_FROM)) return 0
	return smoothstep(Math.log(x / SKEW_FROM) / Math.log(SKEW_TO / SKEW_FROM))
}

const rampShare = (
	table: Pick<FlybyTable, "rampF" | "rampWidth">,
	F: number,
) =>
	table.rampWidth > 0
		? smoothstep(Math.abs(F - table.rampF) / table.rampWidth)
		: 1

/** The integrands at F (d/dF of the tabulated values), both profiles. */
function integrands(
	hyp: Pick<Hyperbola, "a" | "b" | "e">,
	table: Pick<
		FlybyTable,
		"coreKm" | "compactKm" | "edgeKm" | "rampF" | "rampWidth"
	>,
	F: number,
	out: Float64Array,
): void {
	const { a, b, e } = hyp
	const ch = Math.cosh(F)
	const dM = e * ch - 1
	const r = a * dM
	const sigma = outShare(F)
	const skew = skewShare(table.coreKm, r)
	const dHx = -a * Math.sinh(F)
	const dHy = b * ch
	const ramp = rampShare(table, F)
	const catchUp = ramp * catchShare(table, table.edgeKm[F < 0 ? 0 : 1], r) * dM
	for (let p = 0; p < 2; p++) {
		const omega =
			p === 0
				? coreShare(table.coreKm, r)
				: compactShare(hyp, table.compactKm, r)
		const plain = (1 - omega) * (1 - skew)
		const pace = ramp * omega * dM
		const o = p * PROFILE
		out[o] = omega * dHx
		out[o + 1] = omega * dHy
		out[o + 2] = plain * (1 - sigma) * dHx
		out[o + 3] = plain * (1 - sigma) * dHy
		out[o + 4] = plain * sigma * dHx
		out[o + 5] = plain * sigma * dHy
		out[o + 6] = pace
		out[o + 7] = pace * sigma
		out[o + 8] = catchUp * (1 - sigma)
		out[o + 9] = catchUp * sigma
	}
}

/** Table spacing in F; cubic Hermite with exact derivatives makes this plenty. */
const TABLE_STEP = 0.04

/**
 * Builds the tables of `hyp` for anomalies [fromF, toF] (fromF <= 0 <= toF).
 * Beyond the ends the values are held (see `tableAt`), so the range only
 * needs to reach where the core share has died out.
 */
export function buildFlybyTable(
	hyp: Pick<Hyperbola, "a" | "b" | "e">,
	coreKm: number,
	compactKm: number,
	fromF: number,
	toF: number,
	ramp: { F: number; width: number } | null = null,
	edgeKm: readonly [number, number] = [0, 0],
): FlybyTable {
	const step = TABLE_STEP
	const below = Math.max(0, Math.ceil(-fromF / step))
	const above = Math.max(0, Math.ceil(toF / step))
	const count = below + above + 1
	const values = new Float64Array(count * STRIDE)
	const rates = new Float64Array(count * STRIDE)
	const shape = {
		coreKm,
		compactKm,
		edgeKm,
		rampF: ramp?.F ?? 0,
		rampWidth: ramp?.width ?? 0,
	}
	const f0 = new Float64Array(STRIDE)
	const fm = new Float64Array(STRIDE)
	const f1 = new Float64Array(STRIDE)
	integrands(hyp, shape, 0, f0)
	rates.set(f0, below * STRIDE)
	// Simpson outwards from F = 0 (node `below`) in both directions
	for (const dir of [1, -1]) {
		const steps = dir > 0 ? above : below
		for (let i = 1; i <= steps; i++) {
			const fa = dir * (i - 1) * step
			const fb = dir * i * step
			integrands(hyp, shape, fa, f0)
			integrands(hyp, shape, (fa + fb) / 2, fm)
			integrands(hyp, shape, fb, f1)
			const prev = (below + dir * (i - 1)) * STRIDE
			const next = (below + dir * i) * STRIDE
			const h = fb - fa
			for (let k = 0; k < STRIDE; k++) {
				values[next + k] =
					values[prev + k] + (h / 6) * (f0[k] + 4 * fm[k] + f1[k])
			}
			rates.set(f1, next)
		}
	}
	return { first: -below * step, step, count, values, rates, ...shape }
}

const both = new Float64Array(STRIDE)

/** The tabulated values at F, the two profiles mixed by `compact`, into `out` (8 values). */
export function mixedTableAt(
	hyp: Pick<Hyperbola, "a" | "b" | "e">,
	table: FlybyTable,
	compact: number,
	F: number,
	out: Float64Array,
): void {
	tableAt(hyp, table, F, both)
	for (let k = 0; k < PROFILE; k++) {
		out[k] = (1 - compact) * both[k] + compact * both[PROFILE + k]
	}
}

/** The tabulated values at F (both profiles, 16) into `out`, held beyond the ends, where the core share is spent. */
export function tableAt(
	hyp: Pick<Hyperbola, "a" | "b" | "e">,
	table: FlybyTable,
	F: number,
	out: Float64Array,
): void {
	const { first, step, count, values, rates } = table
	const last = first + (count - 1) * step
	if (F <= first || F >= last) {
		const o = F <= first ? 0 : (count - 1) * STRIDE
		for (let k = 0; k < STRIDE; k++) out[k] = values[o + k]
		return
	}
	const i = Math.min(count - 2, Math.floor((F - first) / step))
	const fa = first + i * step
	const u = (F - fa) / step
	const u2 = u * u
	const u3 = u2 * u
	const h00 = 2 * u3 - 3 * u2 + 1
	const h10 = (u3 - 2 * u2 + u) * step
	const h01 = -2 * u3 + 3 * u2
	const h11 = (u3 - u2) * step
	const a = i * STRIDE
	const b = a + STRIDE
	for (let k = 0; k < STRIDE; k++) {
		out[k] =
			h00 * values[a + k] +
			h10 * rates[a + k] +
			h01 * values[b + k] +
			h11 * rates[b + k]
	}
}

/** Everything about drawing one hyperbolic passage that does not depend on the scale. */
export interface FlybyGeometry {
	readonly hyperbola: Hyperbola
	readonly table: FlybyTable
	/** The instant (JD) at which the drawing is in step with the craft; its anomaly. */
	readonly anchorJD: number
	readonly anchorF: number
	/** The planet's true distance from the Sun at the anchor (km) and the direction to it. */
	readonly sunKm: number
	readonly sunDirection: Float64Array
	/** The window's edges (JD): by then the drawing has handed over to the Sun-centred map. */
	readonly window: readonly [number, number]
}

/** The scale-dependent constants of a drawn passage (`prepareFlyby`). */
export interface FlybyScale {
	/** The drawing is the true path (true scale). */
	readonly identity: boolean
	/** Share of the compact relaxation profile (0 roomy, 1 compact), see `FlybyTable`. */
	readonly compact: number
	/** Core stretch (drawn km per true km) and the drawn closest approach (km). */
	readonly k: number
	readonly periapsisKm: number
	/** The Sun-centred map's stretch at the planet, along and across the Sun line (J). */
	readonly radial: number
	readonly tangential: number
	/** Its stretch along the incoming and the outgoing leg. */
	readonly legIn: number
	readonly legOut: number
	/**
	 * The slowdown near the planet on each leg, `D - 1` inside the core:
	 * `k / A - 1`, cut down where the drawing would lag behind the clock by
	 * more than `LAG_SHARE` of the time to its window's edge (Poster).
	 */
	readonly slowIn: number
	readonly slowOut: number
	/**
	 * The catch-up on each leg (0..`CATCH_MAX`): where the slowdown would leave
	 * the drawing out of step by more than `LAG_SHARE` of the time to its
	 * window's edge, the legs run faster than the craft by this share times
	 * `catchShare` to make it up.
	 */
	readonly catchIn: number
	readonly catchOut: number
	/** Hand-over: smoothstep from `nearKm` to `farKm` (true distance), before and after periapsis. */
	readonly nearKm: readonly [number, number]
	readonly farKm: readonly [number, number]
	/** When (drawn time, JD) the hand-over is over on each side: outside, the Sun-centred map alone places the craft. */
	readonly farJD: readonly [number, number]
	/** The pace term at the anchor (see `drawnTimeAt`). */
	readonly anchorTerm: number
	/** The last solve of `drawnAnomalyAt`, its starting point for the next (times come in order). */
	readonly hint?: { jd: number; F: number }
}

/** What a passage needs to know about the planet and the scale. */
export interface FlybyPlanet {
	readonly radiusKm: number
	readonly displayRadiusKm: number
	/** The Sun's (root's) true and drawn radius: the Sun-centred map is measured in them. */
	readonly rootRadiusKm: number
	readonly rootDisplayRadiusKm: number
}

/** Hand-over starts where the Sun-centred map draws the leg this many drawn flyby breadths out ... */
const HANDOVER_START = 2
/** ... and ends this many times farther; squeezed by a short window, it spans at most this ratio. */
const HANDOVER_RATIO = 3
const HANDOVER_SPAN = 30
/** The hand-over is over before the craft is this many times the planet's distance from the Sun away from it. */
const HANDOVER_SUN_SHARE = 1
/** The drawing lags behind the clock by at most this share of the time to its window's edge. */
export const LAG_SHARE = 0.25

/**
 * The Sun-centred map's stretch at `distanceKm` from the Sun: along the Sun
 * line (`radial`) and across it (`tangential`), drawn km per true km.
 */
export function sunStretch(
	scale: ScaleSettings,
	rootRadiusKm: number,
	distanceKm: number,
): { radial: number; tangential: number } {
	const curve = scale.orbitDistance
	const x = distanceKm / rootRadiusKm
	const tangential = mapDistance(curve, x) / x
	if (isIdentityCurve(curve) || !(x > curve.knee)) {
		return { radial: 1, tangential }
	}
	if (anchorWeightOf(curve) > 0) {
		// an anchored curve (#54) is a smooth spline: its slope, numerically
		const h = 1e-4
		const radial =
			(mapDistance(curve, x * Math.exp(h)) -
				mapDistance(curve, x * Math.exp(-h))) /
			(x * (Math.exp(h) - Math.exp(-h)))
		return { radial, tangential }
	}
	const radial =
		curve.gain * curve.exponent * (x / curve.knee) ** (curve.exponent - 1)
	return { radial, tangential }
}

type Stretch = Pick<FlybyScale, "radial" | "tangential">

/** J v: the Sun-centred map's stretch applied to `v`, into `out`. */
function applySunStretch(
	stretch: Stretch,
	sunDirection: ArrayLike<number>,
	v: ArrayLike<number>,
	out: WritableVec3,
): void {
	const along = (stretch.radial - stretch.tangential) * dot(v, sunDirection)
	for (let k = 0; k < 3; k++) {
		out[k] = stretch.tangential * v[k] + along * sunDirection[k]
	}
}

const legScratch = new Float64Array(3)

const legScale = (
	stretch: Stretch,
	sunDirection: ArrayLike<number>,
	u: ArrayLike<number>,
): number => {
	applySunStretch(stretch, sunDirection, u, legScratch)
	return Math.hypot(legScratch[0], legScratch[1], legScratch[2])
}

const table8 = new Float64Array(PROFILE)
const tableBoth = new Float64Array(STRIDE)

/** What sets the drawing's pace. */
type Pace = Pick<
	FlybyScale,
	"compact" | "slowIn" | "slowOut" | "catchIn" | "catchOut"
>

/** The slowed-down mean anomaly at F (the drawn time, times n, from periapsis). */
function paceTerm(geometry: FlybyGeometry, pace: Pace, F: number): number {
	mixedTableAt(geometry.hyperbola, geometry.table, pace.compact, F, table8)
	const [, , , , , , T, To, Ci, Co] = table8
	return (
		meanAnomaly(geometry.hyperbola.e, F) +
		pace.slowIn * (T - To) +
		pace.slowOut * To -
		pace.catchIn * Ci -
		pace.catchOut * Co
	)
}

/**
 * How far out of step with the clock (days) the drawing ends up at anomaly F,
 * per unit of slowdown on the incoming leg and on the outgoing one, and per
 * unit of catch-up on each (`[slowIn, slowOut, catchIn, catchOut]`), for the
 * roomy profile (`[0]`) and the compact one (`[1]`): it is linear in all of
 * them and in the mix.
 */
function lagPerUnit(geometry: FlybyGeometry, F: number): number[][] {
	const { hyperbola, table } = geometry
	tableAt(hyperbola, table, geometry.anchorF, tableBoth)
	const atAnchor = Array.from(tableBoth)
	tableAt(hyperbola, table, F, tableBoth)
	const day = hyperbola.n * SECONDS_PER_DAY
	return [0, PROFILE].map((o) => {
		const at = (k: number) => (tableBoth[o + k] - atAnchor[o + k]) / day
		return [at(6) - at(7), at(7), -at(8), -at(9)]
	})
}

const probeShape = new Float64Array(3)
const probeTrue = new Float64Array(3)
const probeSun = new Float64Array(3)
const reachPoint = new Float64Array(3)
const reachDrawn = new Float64Array(3)
const reachPlanet = new Float64Array(3)

/**
 * The anomaly, between `fromF` and `toF` (one side of periapsis), at which the
 * Sun-centred map draws the hyperbola `targetKm` (display km) away from where
 * it draws the planet: found by bisection, since an anchored curve's local
 * scale changes quickly across a few million km (#54). `toF` when even that
 * is nearer.
 */
function sunReachF(
	geometry: FlybyGeometry,
	scale: ScaleSettings,
	planet: FlybyPlanet,
	fromF: number,
	toF: number,
	targetKm: number,
): number {
	const { hyperbola, sunKm, sunDirection } = geometry
	const curve = childDistanceCurve(scale, true)
	const drawn = (x: number, y: number, z: number, out: Float64Array) =>
		displayOffset(
			x,
			y,
			z,
			planet.rootRadiusKm,
			planet.rootDisplayRadiusKm,
			curve,
			out,
		)
	drawn(
		sunKm * sunDirection[0],
		sunKm * sunDirection[1],
		sunKm * sunDirection[2],
		reachPlanet,
	)
	const away = (F: number) => {
		perifocalToScene(
			hyperbola,
			hyperbola.a * (hyperbola.e - Math.cosh(F)),
			hyperbola.b * Math.sinh(F),
			reachPoint,
		)
		drawn(
			sunKm * sunDirection[0] + reachPoint[0],
			sunKm * sunDirection[1] + reachPoint[1],
			sunKm * sunDirection[2] + reachPoint[2],
			reachDrawn,
		)
		return Math.hypot(
			reachDrawn[0] - reachPlanet[0],
			reachDrawn[1] - reachPlanet[1],
			reachDrawn[2] - reachPlanet[2],
		)
	}
	if (away(fromF) >= targetKm) return fromF
	if (!(away(toF) > targetKm)) return toF
	let lo = fromF
	let hi = toF
	for (let i = 0; i < 50; i++) {
		const mid = (lo + hi) / 2
		if (away(mid) < targetKm) lo = mid
		else hi = mid
	}
	return hi
}

/**
 * The constants of drawing `geometry` under `scale`: the core stretch, the
 * drawn closest approach (on the moon curve), the Sun-centred map's stretch
 * at the planet, and where the hand-over lies.
 */
export function prepareFlyby(
	geometry: FlybyGeometry,
	scale: ScaleSettings,
	planet: FlybyPlanet,
): FlybyScale {
	const { hyperbola } = geometry
	const R = planet.radiusKm
	const Rd = planet.displayRadiusKm
	const moon = scale.moonDistance
	const periapsisKm = Rd * mapDistance(moon, hyperbola.rp / R)
	const k = hyperbola.rp < moon.knee * R ? Rd / R : periapsisKm / hyperbola.rp
	const stretch = sunStretch(scale, planet.rootRadiusKm, geometry.sunKm)
	const legIn = legScale(stretch, geometry.sunDirection, hyperbola.uIn)
	const legOut = legScale(stretch, geometry.sunDirection, hyperbola.uOut)
	const identity =
		Math.abs(k - 1) < 1e-12 &&
		Math.abs(periapsisKm - hyperbola.rp) < 1e-9 * hyperbola.rp &&
		Math.abs(stretch.radial - 1) < 1e-12 &&
		Math.abs(stretch.tangential - 1) < 1e-12
	// the slowdown, within the lag budget of each side's window: drawn more
	// compactly if the roomy drawing would lag too far behind, then made up on
	// the legs (the catch-up), and only if even that is not enough, with less
	// slowdown (on both sides alike: a pace that differs between the legs
	// changes through periapsis, where the drawn flyby is)
	const natural = [k / legIn - 1, k / legOut - 1]
	const { table } = geometry
	const ends = [table.first, table.first + (table.count - 1) * table.step]
	const lags = ends.map((end) => lagPerUnit(geometry, end))
	const budgets = ([0, 1] as const).map((side) => {
		const available =
			side === 0
				? geometry.anchorJD - geometry.window[0]
				: geometry.window[1] - geometry.anchorJD
		return available > 0 ? LAG_SHARE * available : Infinity
	})
	let compact = 0
	for (const side of [0, 1] as const) {
		const [roomy, tight] = lags[side].map((per) =>
			Math.abs(natural[0] * per[0] + natural[1] * per[1]),
		)
		if (roomy > budgets[side]) {
			compact = Math.max(
				compact,
				tight < budgets[side] ? (roomy - budgets[side]) / (roomy - tight) : 1,
			)
		}
	}
	const mixed = (side: 0 | 1, k: number) =>
		(1 - compact) * lags[side][0][k] + compact * lags[side][1][k]
	const lagOf = (side: 0 | 1, cut: number) =>
		cut * Math.abs(natural[0] * mixed(side, 0) + natural[1] * mixed(side, 1))
	// the catch-up undoes the lag (per unit, the opposite sign on either side)
	const perCatch = ([0, 1] as const).map((side) =>
		Math.max(Math.abs(mixed(side, 2 + side)), 1e-12),
	)
	let cut = 1
	for (const side of [0, 1] as const) {
		const lag = lagOf(side, 1)
		const most = budgets[side] + CATCH_MAX * perCatch[side]
		if (lag > most) cut = Math.min(cut, most / lag)
	}
	const catches = ([0, 1] as const).map((side) =>
		Math.min(
			CATCH_MAX,
			Math.max(0, (lagOf(side, cut) - budgets[side]) / perCatch[side]),
		),
	)
	const slowIn = cut * natural[0]
	const slowOut = cut * natural[1]
	const [catchIn, catchOut] = catches
	const anchorTerm = paceTerm(
		geometry,
		{ compact, slowIn, slowOut, catchIn, catchOut },
		geometry.anchorF,
	)
	const prepared = {
		identity,
		compact,
		k,
		periapsisKm,
		radial: stretch.radial,
		tangential: stretch.tangential,
		legIn,
		legOut,
		slowIn,
		slowOut,
		catchIn,
		catchOut,
		nearKm: [0, 0] as [number, number],
		farJD: [0, 0] as [number, number],
		farKm: [0, 0] as [number, number],
		anchorTerm,
		hint: { jd: Number.NaN, F: Number.NaN },
	}
	// the drawn flyby's breadth on each leg: how far its drawn leg lies from
	// where the Sun-centred map puts the craft at the same instant, some way
	// out along the leg (the Sun-centred offset near the planet is J times the
	// true one)
	const { coreKm } = geometry.table
	const probeF = Math.acosh(
		(30 * coreKm) / hyperbola.a / hyperbola.e + 1 / hyperbola.e,
	)
	for (const side of [0, 1] as const) {
		const F = side === 0 ? -probeF : probeF
		drawnShape(geometry, prepared, F, probeShape)
		const t = drawnTimeAt(geometry, prepared, F)
		const trueF = hyperbolicAnomaly(
			hyperbola.e,
			(t - hyperbola.tp) * SECONDS_PER_DAY * hyperbola.n,
		)
		perifocalToScene(
			hyperbola,
			hyperbola.a * (hyperbola.e - Math.cosh(trueF)),
			hyperbola.b * Math.sinh(trueF),
			probeTrue,
		)
		applySunStretch(prepared, geometry.sunDirection, probeTrue, probeSun)
		const breadth = Math.max(
			periapsisKm,
			Math.hypot(
				probeShape[0] - probeSun[0],
				probeShape[1] - probeSun[1],
				probeShape[2] - probeSun[2],
			),
		)
		// the hand-over starts once the slowdown is over (the pace within 5 %
		// of the clock's), so the drawn leg keeps pace with the Sun-centred one,
		// and where the Sun-centred map draws the leg well clear of the drawn
		// flyby, so the blend does not cut through it ...
		const slow = Math.abs(side === 0 ? slowIn : slowOut)
		const paced = pacedKm(hyperbola, table, compact, slow)
		// ... and is over before the window ends (the hand-over follows the
		// drawing's phase, which lags behind the clock)
		const edgeF = drawnAnomalyAt(geometry, prepared, geometry.window[side])
		const edgeKm = hyperbola.a * (hyperbola.e * Math.cosh(edgeF) - 1)
		const clearF = sunReachF(
			geometry,
			scale,
			planet,
			F,
			side === 0 ? Math.min(F, edgeF) : Math.max(F, edgeF),
			HANDOVER_START * breadth,
		)
		const clearKm = hyperbola.a * (hyperbola.e * Math.cosh(clearF) - 1)
		const least = Math.max(paced, 1.2 * SKEW_TO * coreKm)
		let near = Math.max(least, clearKm)
		let far = HANDOVER_RATIO * near
		const limit = Math.min(0.95 * edgeKm, HANDOVER_SUN_SHARE * geometry.sunKm)
		if (far > limit) {
			// a short window: the hand-over takes all of it from where it may
			// start (a slow blend of a big difference is gentler than a quick one)
			far = Math.max(limit, 2 * coreKm)
			near = Math.max(
				Math.min(least, far / HANDOVER_RATIO),
				far / HANDOVER_SPAN,
			)
		}
		prepared.nearKm[side] = near
		prepared.farKm[side] = far
		const farF = Math.acosh(Math.max(1, (far / hyperbola.a + 1) / hyperbola.e))
		prepared.farJD[side] = drawnTimeAt(
			geometry,
			prepared,
			side === 0 ? -farF : farF,
		)
	}
	return prepared
}

/** Where the slowdown `slow` x core share has fallen to 5 %, km (bisection in the log). */
function pacedKm(
	hyp: Pick<Hyperbola, "a" | "b" | "e">,
	table: Pick<FlybyTable, "coreKm" | "compactKm">,
	compact: number,
	slow: number,
): number {
	const share = (r: number) => slow * mixedCoreShare(hyp, table, compact, r)
	const core = Math.min(table.coreKm, table.compactKm)
	if (!(share(core) > 0.05)) return core
	let lo = Math.log(core)
	let hi = lo + 1
	while (share(Math.exp(hi)) > 0.05 && hi < 80) hi += 1
	for (let i = 0; i < 60; i++) {
		const mid = (lo + hi) / 2
		if (share(Math.exp(mid)) > 0.05) lo = mid
		else hi = mid
	}
	return Math.exp(hi)
}

/** Perifocal (x towards periapsis, y along the motion there) to scene axes, into `out`. */
function perifocalToScene(
	hyperbola: Pick<Hyperbola, "p" | "q">,
	x: number,
	y: number,
	out: WritableVec3,
): void {
	for (let k = 0; k < 3; k++) {
		out[k] = x * hyperbola.p[k] + y * hyperbola.q[k]
	}
}

/**
 * The drawn time (JD) at which the drawn craft is at anomaly F: near the
 * planet true time runs slower for the drawing by the drawn stretch over the
 * Sun-centred one, and on the legs faster where it catches up:
 * `D = 1 + rho (omega (k / A - 1) - tau c)` (A blended from one leg's to the
 * other's through periapsis; `slowIn` and `slowOut` are the `k / A - 1`, at
 * most, `catchIn` and `catchOut` the c).
 */
export function drawnTimeAt(
	geometry: FlybyGeometry,
	prepared: Pace & Pick<FlybyScale, "anchorTerm">,
	F: number,
): number {
	const term = paceTerm(geometry, prepared, F)
	return (
		geometry.anchorJD +
		(term - prepared.anchorTerm) / (geometry.hyperbola.n * SECONDS_PER_DAY)
	)
}

/** d(drawn time)/dF, JD per unit F. */
function drawnRate(geometry: FlybyGeometry, prepared: Pace, F: number): number {
	const { e, a, n } = geometry.hyperbola
	const { table } = geometry
	const ch = Math.cosh(F)
	const r = a * (e * ch - 1)
	const omega = mixedCoreShare(geometry.hyperbola, table, prepared.compact, r)
	const tau = catchShare(table, table.edgeKm[F < 0 ? 0 : 1], r)
	const sigma = outShare(F)
	const rho = rampShare(table, F)
	const pace =
		1 +
		rho *
			(omega * ((1 - sigma) * prepared.slowIn + sigma * prepared.slowOut) -
				tau * ((1 - sigma) * prepared.catchIn + sigma * prepared.catchOut))
	return (pace * (e * ch - 1)) / (n * SECONDS_PER_DAY)
}

/**
 * The anomaly F at which the drawn craft is at drawn time `jd` (the inverse
 * of `drawnTimeAt`, which increases with F): a bracket, then Newton.
 */
export function drawnAnomalyAt(
	geometry: FlybyGeometry,
	prepared: Pace & Pick<FlybyScale, "anchorTerm" | "hint">,
	jd: number,
): number {
	const { hint } = prepared
	if (hint !== undefined && Number.isFinite(hint.F)) {
		// Newton from the last solve: a few steps for the next sample of a path
		// or the next frame
		let F = hint.F
		let err = jd - hint.jd
		for (let i = 0; i < 8; i++) {
			const step = err / drawnRate(geometry, prepared, F)
			if (!Number.isFinite(step)) break
			F += step
			if (Math.abs(step) < 1e-12 * (1 + Math.abs(F))) {
				hint.jd = jd
				hint.F = F
				return F
			}
			err = jd - drawnTimeAt(geometry, prepared, F)
		}
	}
	const F = bracketedAnomalyAt(geometry, prepared, jd)
	if (hint !== undefined) {
		hint.jd = jd
		hint.F = F
	}
	return F
}

function bracketedAnomalyAt(
	geometry: FlybyGeometry,
	prepared: Pace & Pick<FlybyScale, "anchorTerm">,
	jd: number,
): number {
	const { e, n, tp } = geometry.hyperbola
	// when the drawing runs slow, the drawn craft lags behind the true one on
	// both sides of the anchor, towards it: the true anomaly and the anchor's
	// bracket it (widened below if a scale makes it run fast instead)
	const trueF = hyperbolicAnomaly(e, (jd - tp) * SECONDS_PER_DAY * n)
	let lo = Math.min(trueF, geometry.anchorF)
	let hi = Math.max(trueF, geometry.anchorF)
	for (let i = 0; i < 60 && drawnTimeAt(geometry, prepared, lo) > jd; i++) {
		lo -= 1 + Math.abs(lo)
	}
	for (let i = 0; i < 60 && drawnTimeAt(geometry, prepared, hi) < jd; i++) {
		hi += 1 + Math.abs(hi)
	}
	let F = (lo + hi) / 2
	for (let i = 0; i < 80; i++) {
		const err = drawnTimeAt(geometry, prepared, F) - jd
		if (err > 0) hi = F
		else lo = F
		let next = F - err / drawnRate(geometry, prepared, F)
		if (!(next > lo && next < hi)) next = (lo + hi) / 2
		if (Math.abs(next - F) < 1e-12 * (1 + Math.abs(F))) return next
		F = next
	}
	return F
}

const shapeJ = new Float64Array(3)
const shapeU = new Float64Array(3)

type ShapeScale = Pick<
	FlybyScale,
	"compact" | "k" | "periapsisKm" | "radial" | "tangential" | "legIn" | "legOut"
>

/**
 * The drawn curve at anomaly F in its two parts:
 *   G(F) = rp' p + k W + A_in Vi + A_out Vo + J Y,  Y = H(F) - H(0) - W - Vi - Vo,
 * the integral of the true curve's direction of motion under the local
 * stretch M (see `FlybyTable`). Writes the planet-centred part (display km
 * from the drawn planet) into `out` and Y, the stretch of arc the Sun-centred
 * map draws (TRUE km from the planet), into `skew`.
 */
function shapeParts(
	geometry: FlybyGeometry,
	prepared: ShapeScale,
	F: number,
	out: WritableVec3,
	skew: WritableVec3,
): void {
	const { hyperbola } = geometry
	mixedTableAt(hyperbola, geometry.table, prepared.compact, F, table8)
	const [wx, wy, ix, iy, ox, oy] = table8
	perifocalToScene(
		hyperbola,
		hyperbola.a * (1 - Math.cosh(F)) - wx - ix - ox,
		hyperbola.b * Math.sinh(F) - wy - iy - oy,
		skew,
	)
	const { k, legIn, legOut } = prepared
	perifocalToScene(
		hyperbola,
		prepared.periapsisKm + k * wx + legIn * ix + legOut * ox,
		k * wy + legIn * iy + legOut * oy,
		out,
	)
}

/**
 * The drawn curve at anomaly F, drawn km from the drawn planet (scene axes),
 * with the Sun-centred map's part linearised at the planet (J Y): the shape
 * near the planet, where that is exact enough. Placing a craft maps Y through
 * the Sun-centred map itself (`drawnOffset`).
 */
export function drawnShape(
	geometry: FlybyGeometry,
	prepared: ShapeScale,
	F: number,
	out: WritableVec3,
): void {
	shapeParts(geometry, prepared, F, out, shapeU)
	applySunStretch(prepared, geometry.sunDirection, shapeU, shapeJ)
	for (let c = 0; c < 3; c++) out[c] += shapeJ[c]
}

/** The true time (JD) on the osculating hyperbola at anomaly F. */
export const trueTimeAt = (hyperbola: Hyperbola, F: number): number =>
	hyperbola.tp + meanAnomaly(hyperbola.e, F) / (hyperbola.n * SECONDS_PER_DAY)

/**
 * Weight (0..1) of the planet-centred drawing when the drawn craft is at
 * anomaly F: by the osculating distance at the drawing's phase, from the
 * hand-over's start to its end on that side of periapsis.
 */
export function nearWeight(
	hyperbola: Pick<Hyperbola, "a" | "e">,
	prepared: Pick<FlybyScale, "nearKm" | "farKm">,
	F: number,
): number {
	const side = F < 0 ? 0 : 1
	const r = hyperbola.a * (hyperbola.e * Math.cosh(F) - 1)
	const near = prepared.nearKm[side]
	const far = prepared.farKm[side]
	return 1 - smoothstep((r - near) / (far - near))
}

const deviation = new Float64Array(3)

/**
 * The drawn offset of a craft whose drawn curve is at anomaly F and whose
 * TRUE offset from the planet at the matching true time is `trueOffset` (km):
 * the drawn curve plus the real path's departure from the osculating
 * hyperbola, under the local stretch. In two parts, like `shapeParts`: `out`
 * (display km from the drawn planet) and `skew` (TRUE km from the planet),
 * which the caller draws through the Sun-centred map (the drawing of planet +
 * skew, less the drawing of the planet), not through its linearisation J:
 * an anchored curve's local scale changes quickly across the millions of km
 * a leg runs before the hand-over (#54). Within the core this is exactly
 * `k * trueOffset`, whatever the path.
 */
export function drawnOffset(
	geometry: FlybyGeometry,
	prepared: ShapeScale,
	F: number,
	trueOffset: ArrayLike<number>,
	out: WritableVec3,
	skew: WritableVec3,
): void {
	const { hyperbola } = geometry
	shapeParts(geometry, prepared, F, out, skew)
	perifocalToScene(
		hyperbola,
		hyperbola.a * (hyperbola.e - Math.cosh(F)),
		hyperbola.b * Math.sinh(F),
		deviation,
	)
	for (let k = 0; k < 3; k++) deviation[k] = trueOffset[k] - deviation[k]
	const r = hyperbola.a * (hyperbola.e * Math.cosh(F) - 1)
	const { coreKm } = geometry.table
	const omega = mixedCoreShare(hyperbola, geometry.table, prepared.compact, r)
	const eta = skewShare(coreKm, r)
	const sigma = outShare(F)
	const leg = prepared.legIn * (1 - sigma) + prepared.legOut * sigma
	const plain = prepared.k * omega + (1 - omega) * (1 - eta) * leg
	for (let k = 0; k < 3; k++) {
		out[k] += plain * deviation[k]
		skew[k] += (1 - omega) * eta * deviation[k]
	}
}
