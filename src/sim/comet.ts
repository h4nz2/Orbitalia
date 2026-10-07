/**
 * Comets (#23, checked against real comets in #55): when they wake up, how long and how
 * bright their tails grow and where they point. Pure, true kilometres only.
 *
 * A comet's nucleus is a few kilometres of ice and dust. Far from the Sun it is inert;
 * sunlight warms it as it falls inward, the ice turns straight to gas, and the gas and the
 * dust it carries off make the coma and the tails. The tails always point AWAY from the Sun,
 * pushed by sunlight and the solar wind, not trailing behind the comet: on the way out the
 * tail goes first. That surprise is what the drawing shows, so the direction here is the
 * true anti-Sun direction from the true positions (the #22 lighting model's Sun direction),
 * never a direction measured in the drawn, scaled scene.
 *
 * Every comet wakes up at its own distance (`tail.onsetKm`: big Hale-Bopp already had a coma
 * at 13 AU, little Encke wakes up only inside 1.6 AU) and is fully active from `tail.fullKm`
 * in. In between its activity climbs steeply, as a power of the distance (`ACTIVITY_POWER`),
 * from 0 at the onset to 1. Activity drives everything drawn: the coma, the tails'
 * brightness and their length, which grows to the longest tail observed (`ionLengthKm`,
 * `dustLengthKm`; 0 for a tail the comet does not grow) and saturates there. A comet that is
 * more active after perihelion than before (Halley, 67P) has a lag (`lagDays`): it answers
 * to where it was that many days earlier. The values and their sources are in
 * data/ourDB.json.
 *
 * The dust tail is a syndyne: where grains that sunlight pushes with `beta` times the Sun's
 * pull are now, if they left the nucleus over the last days or weeks with the comet's own
 * velocity. Each grain moves on its own Kepler orbit round a Sun that pulls it with
 * (1 - beta) of its gravity, so it falls behind the comet: the tail curves back along the
 * orbit, barely far from the Sun, strongly when the comet whips round a close perihelion.
 */
import type { Tail } from "@/data/schema"

import {
	meanAnomalyAt,
	orbitalPeriodToMeanMotion,
	propagate,
	TWO_PI,
	type OrbitElements,
	type Vec3,
} from "./kepler"

/** What the activity of a comet depends on (a schema `Tail` satisfies it). */
export type TailActivity = Pick<Tail, "onsetKm" | "fullKm" | "lagDays">

/**
 * How steeply a comet's activity (its tails' length) climbs toward the Sun: as distance to
 * this power. It fits Halley's tail on its way in, in 1985/86: 1.8, 4 and 13 million km at
 * 1.85, 1.35 and 0.95 AU, against 50 million km at 0.7 AU (IAUC 4142, 4152, Kronk; ESO).
 */
export const ACTIVITY_POWER = 4

/**
 * 0 (asleep) .. 1 (fully active) at `distanceKm` from the Sun: 0 from `tail.onsetKm` out,
 * 1 from `tail.fullKm` in, between them `(full / r)^ACTIVITY_POWER` lowered and stretched
 * so that it starts from 0 at the onset: continuous, and rising all the way in.
 */
export function cometActivity(
	tail: Pick<Tail, "onsetKm" | "fullKm">,
	distanceKm: number,
): number {
	if (!(distanceKm < tail.onsetKm)) return 0
	if (distanceKm <= tail.fullKm) return 1
	const floor = (tail.fullKm / tail.onsetKm) ** ACTIVITY_POWER
	return ((tail.fullKm / distanceKm) ** ACTIVITY_POWER - floor) / (1 - floor)
}

const lagged: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * The distance from the Sun (km) a comet's activity answers to at `jd`: where it was
 * `tail.lagDays` earlier (its true distance now for a comet without a lag).
 */
export function activityDistanceKm(
	orbit: OrbitElements,
	tail: Pick<Tail, "lagDays">,
	jd: number,
): number {
	propagate(orbit, jd - (tail.lagDays ?? 0), lagged)
	return Math.hypot(lagged.x, lagged.y, lagged.z)
}

/** A comet's activity (0..1) at `jd`. */
export const activityAt = (
	orbit: OrbitElements,
	tail: TailActivity,
	jd: number,
): number => cometActivity(tail, activityDistanceKm(orbit, tail, jd))

/** True length (km) of the gas tail at `activity`: the longest observed, times the activity (0 without one). */
export const ionTailLengthKm = (
	tail: Pick<Tail, "ionLengthKm">,
	activity: number,
): number => tail.ionLengthKm * Math.min(1, Math.max(0, activity))

/** True length (km) of the dust tail at `activity` (0 without one). */
export const dustTailLengthKm = (
	tail: Pick<Tail, "dustLengthKm">,
	activity: number,
): number => tail.dustLengthKm * Math.min(1, Math.max(0, activity))

/**
 * Unit vector from the Sun through the comet (both TRUE positions, km), written into
 * `out[at..at + 2]`: the direction every tail points. Zero when they coincide.
 */
export function antiSunDirection(
	comet: ArrayLike<number>,
	cometAt: number,
	sun: ArrayLike<number>,
	sunAt: number,
	out: Float64Array,
	at = 0,
): number {
	const x = comet[cometAt] - sun[sunAt]
	const y = comet[cometAt + 1] - sun[sunAt + 1]
	const z = comet[cometAt + 2] - sun[sunAt + 2]
	const d = Math.hypot(x, y, z)
	const k = d > 0 ? 1 / d : 0
	out[at] = x * k
	out[at + 1] = y * k
	out[at + 2] = z * k
	return d
}

/** Julian Date of the first perihelion passage strictly after `jd`. */
export function nextPerihelionJD(orbit: OrbitElements, jd: number): number {
	const n = orbitalPeriodToMeanMotion(orbit.periodDays)
	const m = meanAnomalyAt(orbit, jd)
	const days = (TWO_PI - m) / n
	return jd + (days > 0 ? days : orbit.periodDays)
}

/** Julian Date of the last perihelion passage at or before `jd`. */
export const previousPerihelionJD = (
	orbit: OrbitElements,
	jd: number,
): number => nextPerihelionJD(orbit, jd) - orbit.periodDays

/**
 * Radiation pressure over gravity of the grains drawn as the dust tail's axis: about
 * micrometre grains, a bright part of most dust tails (NEOWISE's syndyne bands lie below
 * beta 0.82 and above 1.2: Afghan et al. 2024, PSJ 5, doi 10.3847/PSJ/ad856b).
 */
export const DUST_BETA = 0.5

/** The Sun's pull (km^3/day^2) that the orbit's own period implies: n^2 a^3. */
export const orbitMu = (orbit: OrbitElements): number => {
	const n = orbitalPeriodToMeanMotion(orbit.periodDays)
	return n * n * orbit.semiMajorAxisKm ** 3
}

/** Stumpff function C(z) = (1 - cos sqrt z) / z, its series near 0. */
function stumpffC(z: number): number {
	if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z
	if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z
	return 1 / 2 - z / 24
}

/** Stumpff function S(z) = (sqrt z - sin sqrt z) / sqrt z^3, its series near 0. */
function stumpffS(z: number): number {
	if (z > 1e-6) {
		const s = Math.sqrt(z)
		return (s - Math.sin(s)) / (s * s * s)
	}
	if (z < -1e-6) {
		const s = Math.sqrt(-z)
		return (Math.sinh(s) - s) / (s * s * s)
	}
	return 1 / 6 - z / 120
}

/**
 * Two-body motion from a state vector, for any orbit (elliptic, parabolic, hyperbolic) and
 * either direction in time: the position `dt` days after a body at `p` (km) moving at `v`
 * (km/day) round a centre at the origin pulling with `mu` (km^3/day^2), written into
 * `out[at..at + 2]`, and its velocity into `velocity` when given. Universal variables
 * (Curtis, "Orbital Mechanics for Engineering Students", algorithms 3.3 and 3.4).
 */
export function propagateState(
	p: ArrayLike<number>,
	v: ArrayLike<number>,
	mu: number,
	dt: number,
	out: Float64Array,
	at = 0,
	velocity?: Float64Array,
): void {
	if (!(mu > 0)) {
		// nothing pulls (beta = 1): a straight line
		out[at] = p[0] + v[0] * dt
		out[at + 1] = p[1] + v[1] * dt
		out[at + 2] = p[2] + v[2] * dt
		if (velocity !== undefined) {
			velocity[0] = v[0]
			velocity[1] = v[1]
			velocity[2] = v[2]
		}
		return
	}
	const r0 = Math.hypot(p[0], p[1], p[2])
	const v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]
	const sqrtMu = Math.sqrt(mu)
	const radial = (p[0] * v[0] + p[1] * v[1] + p[2] * v[2]) / r0
	const alpha = 2 / r0 - v2 / mu
	// Newton on the universal anomaly chi, from the short-arc guess
	let chi = (sqrtMu * dt) / r0
	for (let k = 0; k < 30; k++) {
		const chi2 = chi * chi
		const z = alpha * chi2
		const c = stumpffC(z)
		const s = stumpffS(z)
		const f =
			((r0 * radial) / sqrtMu) * chi2 * c +
			(1 - alpha * r0) * chi2 * chi * s +
			r0 * chi -
			sqrtMu * dt
		const df =
			((r0 * radial) / sqrtMu) * chi * (1 - z * s) +
			(1 - alpha * r0) * chi2 * c +
			r0
		const step = f / df
		chi -= step
		if (Math.abs(step) < 1e-12 * (Math.abs(chi) + 1)) break
	}
	const chi2 = chi * chi
	const z = alpha * chi2
	const c = stumpffC(z)
	const s = stumpffS(z)
	const f = 1 - (chi2 / r0) * c
	const g = dt - ((chi2 * chi) / sqrtMu) * s
	const x = f * p[0] + g * v[0]
	const y = f * p[1] + g * v[1]
	const w = f * p[2] + g * v[2]
	out[at] = x
	out[at + 1] = y
	out[at + 2] = w
	if (velocity === undefined) return
	const r = Math.hypot(x, y, w)
	const fDot = (sqrtMu / (r * r0)) * (z * chi * s - chi)
	const gDot = 1 - (chi2 / r) * c
	velocity[0] = fDot * p[0] + gDot * v[0]
	velocity[1] = fDot * p[1] + gDot * v[1]
	velocity[2] = fDot * p[2] + gDot * v[2]
}

/** Half the time step (days) of a comet's velocity by central differences. */
const VELOCITY_STEP_DAYS = 1e-3

const before: Vec3 = { x: 0, y: 0, z: 0 }
const after: Vec3 = { x: 0, y: 0, z: 0 }

/** A comet's velocity (km/day, scene axes) at `jd`, written into `out`. */
export function cometVelocity(
	orbit: OrbitElements,
	jd: number,
	out: Float64Array,
): void {
	propagate(orbit, jd - VELOCITY_STEP_DAYS, before)
	propagate(orbit, jd + VELOCITY_STEP_DAYS, after)
	const k = 1 / (2 * VELOCITY_STEP_DAYS)
	out[0] = (after.x - before.x) * k
	out[1] = (after.y - before.y) * k
	out[2] = (after.z - before.z) * k
}

const releasedAt = new Float64Array(3)
const releasedVelocity = new Float64Array(3)

/**
 * Where a dust grain of `beta` that left the nucleus `ageDays` ago is now, relative to the
 * comet: the comet is at `cometKm` (from the Sun, km) moving at `velocity` (km/day) round a
 * Sun pulling with `mu` (`orbitMu`); the grain left with the comet's velocity then and has
 * felt only (1 - beta) of that pull since. Written into `out[at..at + 2]`: one point of a
 * syndyne.
 */
export function grainOffsetKm(
	cometKm: ArrayLike<number>,
	velocity: ArrayLike<number>,
	mu: number,
	beta: number,
	ageDays: number,
	out: Float64Array,
	at = 0,
): void {
	// the comet then: back along its own orbit
	propagateState(
		cometKm,
		velocity,
		mu,
		-ageDays,
		releasedAt,
		0,
		releasedVelocity,
	)
	propagateState(
		releasedAt,
		releasedVelocity,
		(1 - beta) * mu,
		ageDays,
		out,
		at,
	)
	out[at] -= cometKm[0]
	out[at + 1] -= cometKm[1]
	out[at + 2] -= cometKm[2]
}

/**
 * How long ago (days) the oldest grain of a dust tail `lengthKm` long left the nucleus,
 * for a comet `distanceKm` from a Sun pulling with `mu`: a grain pushed out with beta g
 * (g = mu / r^2) covers beta g t^2 / 2 in time t.
 */
export const dustAgeDays = (
	mu: number,
	beta: number,
	distanceKm: number,
	lengthKm: number,
): number => Math.sqrt((2 * lengthKm * distanceKm * distanceKm) / (beta * mu))
