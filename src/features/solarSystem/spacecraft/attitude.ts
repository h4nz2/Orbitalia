/**
 * Which way a spacecraft's model faces, and how Juno spins (issue #73,
 * docs/ARCHITECTURE.md, "Spacecraft", Models in the scene). Pure: plain
 * arrays in scene axes (ecliptic north is +Y), no three.js objects.
 *
 * Every model is normalised so that +Z must point at what the craft points
 * at (#72, `CraftModel.points`): the high-gain antenna at Earth (the
 * Voyagers, the Pioneers, New Horizons, Cassini, Juno), the heat shield, the
 * sunshield or the solar arrays at the Sun (Parker, JWST, Europa Clipper).
 * That is the simple, physically true rule; real attitudes vary by mission
 * phase (a camera turned to a moon, a burn), which the scene does not show.
 * The direction is taken between the drawn positions, so the dish points at
 * Earth as drawn on screen. The roll, free in that rule, keeps +Y as close
 * to ecliptic north as it can, so a model never flips or wobbles.
 */
import {
	MAX_SPIN_STEP_MS,
	MIN_SECONDS_PER_EARTH_TURN,
	type SpinMode,
} from "@/sim"

/** Below this length (of +Y's projection) the pointing axis is too close to the pole to roll by it. */
const POLE_EPSILON = 1e-3

/**
 * The model's axes in scene axes, into `basis` (x, y, z, three numbers
 * each): +Z along `toTarget`, +Y towards ecliptic north as far as +Z allows,
 * +X completing a right-handed frame. When +Z points (nearly) at a pole, the
 * roll keeps the +Y `basis` held before (a craft passing under the pole does
 * not spin round), else scene +X's. Returns false (basis untouched) for a
 * zero direction.
 */
export function craftAttitude(
	toTarget: ArrayLike<number>,
	basis: Float64Array,
): boolean {
	const length = Math.hypot(toTarget[0], toTarget[1], toTarget[2])
	if (!(length > 0)) return false
	const zx = toTarget[0] / length
	const zy = toTarget[1] / length
	const zz = toTarget[2] / length
	// north minus its part along +Z
	let yx = -zy * zx
	let yy = 1 - zy * zy
	let yz = -zy * zz
	let ylength = Math.hypot(yx, yy, yz)
	if (ylength < POLE_EPSILON) {
		// the +Y held before, else scene +X, minus its part along +Z
		let px = basis[3]
		let py = basis[4]
		let pz = basis[5]
		if (!(Math.hypot(px, py, pz) > 0)) {
			px = 1
			py = 0
			pz = 0
		}
		let along = px * zx + py * zy + pz * zz
		yx = px - along * zx
		yy = py - along * zy
		yz = pz - along * zz
		ylength = Math.hypot(yx, yy, yz)
		if (ylength < POLE_EPSILON) {
			along = zx
			yx = 1 - along * zx
			yy = -along * zy
			yz = -along * zz
			ylength = Math.hypot(yx, yy, yz)
		}
	}
	yx /= ylength
	yy /= ylength
	yz /= ylength
	// x = y × z
	basis[0] = yy * zz - yz * zy
	basis[1] = yz * zx - yx * zz
	basis[2] = yx * zy - yy * zx
	basis[3] = yx
	basis[4] = yy
	basis[5] = yz
	basis[6] = zx
	basis[7] = zy
	basis[8] = zz
	return true
}

/**
 * The shortest real time one turn of a spinning craft may take on screen in
 * each spin mode (#13), seconds. Juno turns twice a minute, 720 times faster
 * than Earth: true to the clock it would strobe at almost any speed, even
 * where the planets still turn watchably, so in `realistic` it is capped
 * like the planets are in `slowed` (true below the cap: one turn in 30 s at
 * real time); `slow` and `stopped` as for the planets.
 */
export const CRAFT_MIN_SECONDS_PER_TURN: Readonly<Record<SpinMode, number>> = {
	realistic: MIN_SECONDS_PER_EARTH_TURN.slowed,
	slowed: MIN_SECONDS_PER_EARTH_TURN.slowed,
	slow: MIN_SECONDS_PER_EARTH_TURN.slow,
	stopped: MIN_SECONDS_PER_EARTH_TURN.stopped,
}

/** A spinning craft's turn about +Z, mutated in place every frame (like the planets' `SpinClock`). */
export interface CraftSpin {
	/** The angle about +Z, radians, in [0, 2π). */
	angle: number
	/** Simulation time of the last update (JD). */
	simJD: number
	/** Real time of the last update (ms, performance.now()). */
	realMs: number
}

export const createCraftSpin = (jd: number, realMs: number): CraftSpin => ({
	angle: 0,
	simJD: jd,
	realMs,
})

/**
 * Advances `spin` to simulation time `simJD` at real time `realMs` for a
 * craft turning `rpm` times a minute, and returns the angle: the simulation
 * step's turn, forwards or backwards with the clock, capped to one turn per
 * `CRAFT_MIN_SECONDS_PER_TURN[mode]` of real time (a long frame gap counts
 * as `MAX_SPIN_STEP_MS`), so a jump in time or a fast clock turns it
 * watchably instead of strobing.
 */
export function advanceCraftSpin(
	spin: CraftSpin,
	simJD: number,
	realMs: number,
	mode: SpinMode,
	rpm: number,
): number {
	const turns = (simJD - spin.simJD) * 1440 * rpm
	const realStep = Math.min(Math.max(realMs - spin.realMs, 0), MAX_SPIN_STEP_MS)
	spin.simJD = simJD
	spin.realMs = realMs
	const limit = realStep / 1000 / CRAFT_MIN_SECONDS_PER_TURN[mode]
	const step = Math.min(Math.max(turns, -limit), limit)
	if (Number.isFinite(step) && step !== 0) {
		const angle = (spin.angle + step * 2 * Math.PI) % (2 * Math.PI)
		spin.angle = angle < 0 ? angle + 2 * Math.PI : angle
	}
	return spin.angle
}
