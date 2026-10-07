/**
 * Spacecraft positions (issue #35, docs/ARCHITECTURE.md, "Spacecraft"). Pure:
 * no React, no three.js; per-frame functions write into caller-owned arrays.
 *
 * A trajectory is a list of segments of sparse Horizons states, each relative
 * to a centre body: the Sun (the root), or a planet while the craft is in its
 * neighbourhood. Between samples the state is rebuilt by cubic Hermite
 * interpolation (./hermite.ts). The TRUE position (for readouts: distances,
 * signal delay, speed) blends the two where they overlap: inside the planet
 * segment's inner radius (1 Hill radius) only the planet's counts, beyond its
 * outer radius (1.5) only the Sun's, in between a smoothstep of the distance
 * (the planets come from the app's Kepler model, which differs from JPL's by
 * up to a few tenths of a degree, so the two frames disagree a little).
 *
 * The DRAWN position (issue #56): far from every planet the craft is placed
 * like any non-body point, through the Sun-centred map (`displayOffset`
 * around the Sun). Each passage of a planet is an `encounter` with a time
 * window: within it the craft is drawn around the drawn planet by ./flyby.ts
 * (a drawn copy of its hyperbola, at the Sun-centred map's pace, handing over
 * to the Sun-centred placement by distance), and while it is bound to the
 * planet (a parking orbit, the orbits after an orbit insertion, JWST) like a
 * moon. `craftStateAt` is the one function that places a craft: the markers,
 * the paths, the camera framing (and a camera following a craft, #57) all
 * read it, so the marker always sits on its drawn path.
 *
 * Only the Sun and its direct children (planets) may be centres: their
 * position at any time is one Kepler propagation, which the path builder
 * needs for every vertex.
 */
import type { Body } from "@/data"
import type {
	Spacecraft,
	SpacecraftEvent,
	TrajectorySegment,
} from "@/data/spacecraftSchema"

import {
	CORE_RADII,
	GRAVITATIONAL_CONSTANT,
	buildFlybyTable,
	drawnAnomalyAt,
	drawnOffset,
	drawnTimeAt,
	hyperbolicAnomaly,
	nearWeight,
	osculatingHyperbola,
	prepareFlyby,
	trueTimeAt,
	type FlybyGeometry,
	type FlybyScale,
	type Hyperbola,
} from "./flyby"
import { bracket, hermitePosition, hermiteVelocity } from "./hermite"
import { propagate, type Vec3 } from "./kepler"
import { lightSeconds } from "./light"
import { childDistanceCurve, displayOffset, type ScaleSettings } from "./scale"
import { J2000_JD, UNIX_EPOCH_JD, MS_PER_DAY } from "./time"
import { AU_KM, SECONDS_PER_DAY } from "./units"

/** Julian Date of an ISO instant (`1977-09-05T12:56Z`). */
export const isoToJD = (iso: string): number =>
	UNIX_EPOCH_JD + Date.parse(iso) / MS_PER_DAY

/** A decoded segment: JDs and scene-axis states, ready for interpolation. */
export interface CraftSegment {
	readonly center: string
	/** Index of the centre in the bodies array the trajectory was bound to. */
	readonly centerIndex: number
	/** The centre is the root (the Sun). */
	readonly root: boolean
	/** km; `inner = outer = Infinity` when the segment alone places the craft. */
	readonly inner: number
	readonly outer: number
	readonly jd: Float64Array
	/** km, scene axes, 3 per sample. */
	readonly p: Float64Array
	/** km/s, scene axes, 3 per sample. */
	readonly v: Float64Array
	readonly from: number
	readonly to: number
}

/**
 * How a craft passes a planet (see ./flyby.ts): a flyby, the departure after
 * launch, an arrival (into orbit, or the end of the data on the way in), or a
 * stay around the planet only (JWST).
 */
export type EncounterKind = "flyby" | "departure" | "arrival" | "orbit"

/** One planet's say in drawing a craft, over a time window. */
export interface CraftEncounter {
	readonly kind: EncounterKind
	/** Index of the planet in the bodies array, and its id. */
	readonly planet: number
	readonly center: string
	/** The window (JD) within which this planet places the craft. */
	readonly from: number
	readonly to: number
	/**
	 * The hyperbolic passage [hyperFrom, hyperTo] (JD) within the window;
	 * the rest of the window the craft is bound to the planet.
	 */
	readonly hyperFrom: number
	readonly hyperTo: number
	/** null when the craft is only ever bound here. */
	readonly flyby: FlybyGeometry | null
	/** The last scale the passage was prepared for (memo). */
	cache: { scale: ScaleSettings; radiusKm: number; prepared: FlybyScale } | null
}

export interface CraftTrajectory {
	readonly id: string
	/** Segments centred on the root (the Sun), in time order. */
	readonly helio: readonly CraftSegment[]
	/** Segments centred on a planet, in time order. */
	readonly planetary: readonly CraftSegment[]
	/** Planet passages in time order, with disjoint windows (empty for bodies without mass, radius and orbit). */
	readonly encounters: readonly CraftEncounter[]
	/** Index of the root (the Sun). */
	readonly root: number
	/** The data covers [fromJD, toJD]. */
	readonly fromJD: number
	readonly toJD: number
}

/** What decoding needs of a body; mass, radius and orbit also let it draw passages. */
export type TrajectoryBody = Pick<Body, "parentId"> &
	Partial<Pick<Body, "radiusKm" | "massKg" | "orbit" | "rings">>

/** Ecliptic (x, y, z) -> scene (x, z, -y) for a flat array of vectors. */
function eclipticArrayToScene(values: readonly number[]): Float64Array {
	const out = new Float64Array(values.length)
	for (let k = 0; k < values.length; k += 3) {
		out[k] = values[k]
		out[k + 1] = values[k + 2]
		out[k + 2] = -values[k + 1]
	}
	return out
}

function decodeSegment(
	segment: TrajectorySegment,
	index: ReadonlyMap<string, number>,
	bodies: readonly TrajectoryBody[],
): CraftSegment {
	const centerIndex = index.get(segment.center)
	if (centerIndex === undefined) {
		throw new Error(`spacecraft: unknown centre "${segment.center}"`)
	}
	const center = bodies[centerIndex]
	const root = center.parentId === null
	const parent =
		center.parentId === null ? undefined : index.get(center.parentId)
	if (!root && (parent === undefined || bodies[parent].parentId !== null)) {
		throw new Error(
			`spacecraft: centre "${segment.center}" must be the root or orbit it`,
		)
	}
	const jd = Float64Array.from(segment.t, (t) => t + J2000_JD)
	return {
		center: segment.center,
		centerIndex,
		root,
		inner: segment.blend === null ? Infinity : segment.blend[0],
		outer: segment.blend === null ? Infinity : segment.blend[1],
		jd,
		p: eclipticArrayToScene(segment.p),
		v: eclipticArrayToScene(segment.v),
		from: jd[0],
		to: jd[jd.length - 1],
	}
}

/** Decodes a craft's trajectory `segments` against `bodies` (their `index`, as from `buildIndex`). */
export function decodeTrajectory(
	craft: Pick<Spacecraft, "id" | "dataFrom" | "dataTo"> &
		Partial<Pick<Spacecraft, "orbits">>,
	data: readonly TrajectorySegment[],
	bodies: readonly TrajectoryBody[],
	index: ReadonlyMap<string, number>,
): CraftTrajectory {
	const segments = data.map((segment) => decodeSegment(segment, index, bodies))
	const byStart = (a: CraftSegment, b: CraftSegment) => a.from - b.from
	const helio = segments.filter((s) => s.root).sort(byStart)
	const planetary = segments.filter((s) => !s.root).sort(byStart)
	const fromJD = Math.max(
		isoToJD(craft.dataFrom),
		Math.min(...segments.map((s) => s.from)),
	)
	const toJD = Math.min(
		isoToJD(craft.dataTo),
		Math.max(...segments.map((s) => s.to)),
	)
	const root = bodies.findIndex((body) => body.parentId === null)
	const parts = { helio, planetary, fromJD, toJD }
	return {
		id: craft.id,
		...parts,
		encounters: buildEncounters(parts, craft.orbits ?? [], bodies, root),
		root,
		fromJD,
		toJD,
	}
}

const covering = (
	segments: readonly CraftSegment[],
	jd: number,
): CraftSegment | null => {
	for (const segment of segments) {
		if (jd >= segment.from && jd <= segment.to) return segment
	}
	return null
}

/** State of `segment` at `jd` relative to its centre: position (km) into `p`, velocity (km/s) into `v`. */
export function segmentState(
	segment: CraftSegment,
	jd: number,
	p: Float64Array,
	v?: Float64Array,
): void {
	const i = bracket(segment.jd, jd)
	hermitePosition(segment.jd, segment.p, segment.v, i, i + 1, jd, p)
	if (v !== undefined) {
		hermiteVelocity(segment.jd, segment.p, segment.v, i, i + 1, jd, v)
	}
}

/**
 * Weight (0..1) of a planet segment against the Sun's at distance `d` km
 * from the planet: 1 inside `inner`, 0 beyond `outer`, a smoothstep between.
 */
export function blendWeight(inner: number, outer: number, d: number): number {
	if (!(d > inner)) return 1
	if (!(d < outer)) return 0
	const x = (outer - d) / (outer - inner)
	return x * x * (3 - 2 * x)
}

// --- encounters (built once per trajectory) ---------------------------------

type Parts = Pick<CraftTrajectory, "helio" | "planetary" | "fromJD" | "toJD">

const planetScratch: Vec3 = { x: 0, y: 0, z: 0 }
const offsetP = new Float64Array(3)
const offsetH = new Float64Array(3)

/**
 * The TRUE offset (km, scene axes) of the craft from planet `planet` at `jd`,
 * blending the planet's segment and the Sun's like the true position does,
 * with the planet where the app's model has it. False when no segment covers
 * `jd`.
 */
function trueOffsetAt(
	parts: Pick<Parts, "helio" | "planetary">,
	bodies: readonly TrajectoryBody[],
	planet: number,
	jd: number,
	out: Float64Array,
): boolean {
	const own = covering(parts.planetary, jd)
	const planetSegment = own !== null && own.centerIndex === planet ? own : null
	const helio = covering(parts.helio, jd)
	let weight = 0
	if (planetSegment !== null) {
		segmentState(planetSegment, jd, offsetP)
		weight =
			helio === null
				? 1
				: blendWeight(
						planetSegment.inner,
						planetSegment.outer,
						Math.hypot(offsetP[0], offsetP[1], offsetP[2]),
					)
	}
	if (weight < 1) {
		const orbit = bodies[planet].orbit
		if (helio === null || orbit == null) {
			if (planetSegment === null) return false
			weight = 1
		} else {
			segmentState(helio, jd, offsetH)
			propagate(orbit, jd, planetScratch)
			offsetH[0] -= planetScratch.x
			offsetH[1] -= planetScratch.y
			offsetH[2] -= planetScratch.z
		}
	}
	for (let k = 0; k < 3; k++) {
		out[k] =
			weight * (weight > 0 ? offsetP[k] : 0) +
			(1 - weight) * (weight < 1 ? offsetH[k] : 0)
	}
	return true
}

const stateP = new Float64Array(3)
const stateV = new Float64Array(3)

/** The craft's closest approach to the centre of planet segment `s` (JD), refined between samples. */
function closestApproach(s: CraftSegment): number {
	let best = Infinity
	let at = 0
	for (let k = 0; k < s.jd.length; k++) {
		const d = Math.hypot(s.p[3 * k], s.p[3 * k + 1], s.p[3 * k + 2])
		if (d < best) {
			best = d
			at = k
		}
	}
	let lo = s.jd[Math.max(0, at - 1)]
	let hi = s.jd[Math.min(s.jd.length - 1, at + 1)]
	const distance = (t: number) => {
		segmentState(s, t, stateP)
		return Math.hypot(stateP[0], stateP[1], stateP[2])
	}
	for (let i = 0; i < 80 && hi - lo > 1e-9; i++) {
		const a = lo + (hi - lo) * 0.381966
		const b = lo + (hi - lo) * 0.618034
		if (distance(a) < distance(b)) hi = b
		else lo = a
	}
	return (lo + hi) / 2
}

/** The osculating hyperbola of segment `s` at `jd`, or null if bound there. */
function hyperbolaAt(
	s: CraftSegment,
	jd: number,
	mu: number,
): Hyperbola | null {
	segmentState(s, jd, stateP, stateV)
	return osculatingHyperbola(stateP, stateV, jd, mu)
}

/** The first sample of a departure segment after which the craft has escaped (bound before: a parking orbit). */
function escapeSample(s: CraftSegment, mu: number): number {
	let lastBound = -1
	for (let k = 0; k < s.jd.length; k++) {
		const p = s.p.subarray(3 * k, 3 * k + 3)
		const v = s.v.subarray(3 * k, 3 * k + 3)
		if (osculatingHyperbola(p, v, s.jd[k], mu) === null) lastBound = k
		const r = Math.hypot(p[0], p[1], p[2])
		if (r > 0.5 * s.outer) break
	}
	return Math.min(s.jd.length - 1, lastBound + 1)
}

/**
 * The time (JD) from which an arriving craft stays bound to the planet (an
 * orbit insertion before the data ends), or null if it is still on its
 * hyperbola at the end.
 */
function captureSample(s: CraftSegment, mu: number): number | null {
	const bound = (k: number) =>
		osculatingHyperbola(
			s.p.subarray(3 * k, 3 * k + 3),
			s.v.subarray(3 * k, 3 * k + 3),
			s.jd[k],
			mu,
		) === null
	let k = s.jd.length - 1
	if (!bound(k)) return null
	while (k > 0 && bound(k - 1)) k--
	return s.jd[k]
}

/** The narrowest ramp (in F) between the drawing's pace and real time at a burn. */
const RAMP_MIN_WIDTH = 0.3
/** The compact drawing keeps true proportion out to this many times a planet's outer ring radius. */
const RING_MARGIN = 1.1
/** Tables reach this many core radii; beyond, the core's share is spent. */
const TABLE_REACH = 20000

interface DraftEncounter {
	kind: EncounterKind
	planet: number
	anchor: number
	segment: CraftSegment
	hyperbola: Hyperbola | null
	/** A bound phase before (departure) or after (arrival) the anchor. */
	bound: "before" | "after" | null
}

function draftEncounter(
	s: CraftSegment,
	orbits: readonly Pick<Spacecraft["orbits"][number], "center" | "from">[],
	mu: number,
	radiusKm: number,
): DraftEncounter {
	const base = { planet: s.centerIndex, segment: s }
	if (s.inner === Infinity) {
		// a forced centre (JWST at L2): only ever bound
		return {
			...base,
			kind: "orbit",
			anchor: (s.from + s.to) / 2,
			hyperbola: null,
			bound: null,
		}
	}
	const r = (k: number) =>
		Math.hypot(s.p[3 * k], s.p[3 * k + 1], s.p[3 * k + 2])
	if (r(0) < 2 * CORE_RADII * radiusKm) {
		// departure: from launch, after a parking orbit if there is one
		const k = escapeSample(s, mu)
		const p = s.p.subarray(3 * k, 3 * k + 3)
		const v = s.v.subarray(3 * k, 3 * k + 3)
		const hyperbola = osculatingHyperbola(p, v, s.jd[k], mu)
		return {
			...base,
			kind: hyperbola === null ? "orbit" : "departure",
			anchor: s.jd[k],
			hyperbola,
			bound: k > 0 ? "before" : null,
		}
	}
	const orbit = orbits.find(
		(o) =>
			o.center === s.center &&
			isoToJD(o.from) >= s.from &&
			isoToJD(o.from) <= s.to,
	)
	const last = s.jd.length - 1
	if (orbit !== undefined || r(last) < 0.5 * s.outer) {
		// arrival: into an orbit phase, or on the way in when the data ends
		// (Europa Clipper at Jupiter, whose predicted insertion is in the data
		// but is no orbit phase: drawn as a passage to the end)
		const capture =
			orbit !== undefined ? isoToJD(orbit.from) : captureSample(s, mu)
		// the approach, from a day before the capture
		const hyperbola = hyperbolaAt(
			s,
			Math.max(s.from, (capture ?? s.to) - 1),
			mu,
		)
		// into orbit, the passage ends at periapsis if the insertion comes after
		// it (the burn spans periapsis): from there on the craft is drawn as
		// bound, in real time, so the drawn periapsis is at the true one
		const anchor =
			orbit === undefined || hyperbola === null
				? s.to
				: Math.min(capture!, Math.max(s.from, hyperbola.tp))
		return {
			...base,
			kind: hyperbola === null ? "orbit" : "arrival",
			anchor,
			hyperbola,
			bound: orbit === undefined ? null : "after",
		}
	}
	const closest = closestApproach(s)
	const hyperbola = hyperbolaAt(s, closest, mu)
	return {
		...base,
		kind: hyperbola === null ? "orbit" : "flyby",
		anchor: hyperbola === null ? closest : hyperbola.tp,
		hyperbola,
		bound: null,
	}
}

/** The planet passages of a trajectory, with their windows and drawing tables. */
function buildEncounters(
	parts: Parts,
	orbits: readonly Pick<Spacecraft["orbits"][number], "center" | "from">[],
	bodies: readonly TrajectoryBody[],
	root: number,
): CraftEncounter[] {
	const drafts: DraftEncounter[] = []
	for (const s of parts.planetary) {
		const body = bodies[s.centerIndex]
		if (
			body.radiusKm === undefined ||
			body.massKg == null ||
			body.orbit == null ||
			root < 0
		) {
			continue
		}
		drafts.push(
			draftEncounter(
				s,
				orbits,
				GRAVITATIONAL_CONSTANT * body.massKg,
				body.radiusKm,
			),
		)
	}
	drafts.sort((a, b) => a.anchor - b.anchor)
	const sunMass = bodies[root]?.massKg ?? null
	const borders = drafts
		.slice(1)
		.map((draft, i) => border(parts, bodies, sunMass, drafts[i], draft))
	const encounters: CraftEncounter[] = []
	for (let i = 0; i < drafts.length; i++) {
		const draft = drafts[i]
		let from = i === 0 ? parts.fromJD : borders[i - 1]
		let to = i === drafts.length - 1 ? parts.toJD : borders[i]
		if (draft.kind === "orbit") {
			from = Math.max(from, draft.segment.from)
			to = Math.min(to, draft.segment.to)
		}
		const hyperFrom =
			draft.bound === "before"
				? draft.anchor
				: draft.kind === "orbit"
					? to
					: from
		const hyperTo = draft.bound === "after" ? draft.anchor : to
		encounters.push({
			kind: draft.kind,
			planet: draft.planet,
			center: draft.segment.center,
			from,
			to,
			hyperFrom,
			hyperTo,
			flyby:
				draft.hyperbola === null
					? null
					: flybyGeometry(draft, bodies, sunMass, from, to),
			cache: null,
		})
	}
	return encounters
}

/** Hill radius (km) of a planet orbiting the Sun (of mass `sunMass`). */
function hillRadiusKm(body: TrajectoryBody, sunMass: number): number {
	const orbit = body.orbit
	if (orbit == null || body.massKg == null) return 0
	return (
		orbit.semiMajorAxisKm *
		(1 - orbit.eccentricity) *
		Math.cbrt(body.massKg / (3 * sunMass))
	)
}

/**
 * Where one planet's window ends and the next one's begins (JD): where the
 * craft is as far from either in units of its Hill radius, so a big planet's
 * neighbourhood gets the room it needs (Cassini between Earth and Jupiter);
 * between two passages of the same planet, half way.
 */
function border(
	parts: Parts,
	bodies: readonly TrajectoryBody[],
	sunMass: number | null,
	a: DraftEncounter,
	b: DraftEncounter,
): number {
	const middle = (a.anchor + b.anchor) / 2
	if (a.planet === b.planet || sunMass === null) return middle
	const hillA = hillRadiusKm(bodies[a.planet], sunMass)
	const hillB = hillRadiusKm(bodies[b.planet], sunMass)
	if (!(hillA > 0 && hillB > 0)) return middle
	const offset = new Float64Array(3)
	const share = (jd: number, planet: number, hill: number) =>
		trueOffsetAt(parts, bodies, planet, jd, offset)
			? Math.hypot(offset[0], offset[1], offset[2]) / hill
			: NaN
	let lo = a.anchor
	let hi = b.anchor
	for (let i = 0; i < 60; i++) {
		const mid = (lo + hi) / 2
		const nearerA = share(mid, a.planet, hillA) < share(mid, b.planet, hillB)
		if (nearerA) lo = mid
		else hi = mid
	}
	const at = (lo + hi) / 2
	return Number.isFinite(at) ? at : middle
}

/** A passage's drawing is over within this share of the craft's orbit around the Sun on either side. */
const ORBIT_SHARE = 0.4

/**
 * The period (days) of the craft's orbit around the Sun on one leg of a
 * passage (its velocity there the planet's plus the leg's), or Infinity when
 * that is not bound.
 */
function helioPeriodDays(
	body: TrajectoryBody,
	sunMass: number | null,
	anchor: number,
	hyperbola: Hyperbola,
	leg: ArrayLike<number>,
): number {
	if (sunMass === null || body.orbit == null) return Infinity
	const mu = GRAVITATIONAL_CONSTANT * sunMass
	const h = 0.01
	const before: Vec3 = { x: 0, y: 0, z: 0 }
	const after: Vec3 = { x: 0, y: 0, z: 0 }
	propagate(body.orbit, anchor - h, before)
	propagate(body.orbit, anchor + h, after)
	const speed = Math.sqrt(hyperbola.mu / hyperbola.a)
	const toKmS = 1 / (2 * h * SECONDS_PER_DAY)
	const v = [
		(after.x - before.x) * toKmS + speed * leg[0],
		(after.y - before.y) * toKmS + speed * leg[1],
		(after.z - before.z) * toKmS + speed * leg[2],
	]
	const r = Math.hypot(
		(after.x + before.x) / 2,
		(after.y + before.y) / 2,
		(after.z + before.z) / 2,
	)
	const energy = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) / 2 - mu / r
	if (!(energy < 0)) return Infinity
	const semiMajor = -mu / (2 * energy)
	return (2 * Math.PI * Math.sqrt(semiMajor ** 3 / mu)) / SECONDS_PER_DAY
}

function flybyGeometry(
	draft: DraftEncounter,
	bodies: readonly TrajectoryBody[],
	sunMass: number | null,
	fromJD: number,
	toJD: number,
): FlybyGeometry {
	const hyperbola = draft.hyperbola!
	const { e, a, n, tp } = hyperbola
	const body = bodies[draft.planet]
	// within the window, and within `ORBIT_SHARE` of the craft's orbit around
	// the Sun (Parker Solar Probe's windows span more than one: the
	// planet-centred path curves right round, and a drawing out of step with it
	// by days would blend far-apart points of it)
	const from = Math.max(
		fromJD,
		draft.anchor -
			ORBIT_SHARE *
				helioPeriodDays(body, sunMass, draft.anchor, hyperbola, hyperbola.uIn),
	)
	const to = Math.min(
		toJD,
		draft.anchor +
			ORBIT_SHARE *
				helioPeriodDays(body, sunMass, draft.anchor, hyperbola, hyperbola.uOut),
	)
	const radiusKm = body.radiusKm!
	const anchorF =
		draft.kind === "flyby"
			? 0
			: hyperbolicAnomaly(e, (draft.anchor - tp) * SECONDS_PER_DAY * n)
	const anchorKm = a * (e * Math.cosh(anchorF) - 1)
	const coreKm = Math.max(
		CORE_RADII * radiusKm,
		1.2 * hyperbola.rp,
		draft.bound === null ? 0 : 1.2 * anchorKm,
	)
	const anomalyAtKm = (km: number) => Math.acosh(Math.max(1, (km / a + 1) / e))
	const reach = anomalyAtKm(TABLE_REACH * coreKm)
	const fromF = draft.kind === "departure" ? Math.min(0, anchorF) : -reach
	const toF = draft.kind === "arrival" ? Math.max(0, anchorF) : reach
	const coreF = anomalyAtKm(coreKm)
	// a parking orbit hands over to the slowed passage gradually; an orbit
	// insertion is a clean switch (ramping back to real time on the way in
	// would let the fast planet-centred motion show as a hook in the path)
	const ramp =
		draft.bound === "before"
			? { F: anchorF, width: Math.max(RAMP_MIN_WIDTH, coreF - anchorF) }
			: null
	// the compact profile: no margin beyond periapsis, out to the rings only
	// where there are some (they keep their places, drawn in true proportion
	// inside the knee), a faster fall-off
	const compactKm = Math.max(
		hyperbola.rp,
		RING_MARGIN * (body.rings?.outerRadiusKm ?? 0),
		draft.bound === null ? 0 : 1.2 * anchorKm,
	)
	// the true distance at the window's edges (where the catch-up has to be
	// over), within the tables' reach
	const edgeKm = [from, to].map((jd) =>
		Math.min(
			TABLE_REACH * coreKm,
			a *
				(e * Math.cosh(hyperbolicAnomaly(e, (jd - tp) * SECONDS_PER_DAY * n)) -
					1),
		),
	) as [number, number]
	const table = buildFlybyTable(
		hyperbola,
		coreKm,
		compactKm,
		fromF,
		toF,
		ramp,
		edgeKm,
	)
	propagate(body.orbit!, draft.anchor, planetScratch)
	const sunKm = Math.hypot(planetScratch.x, planetScratch.y, planetScratch.z)
	const sunDirection = Float64Array.of(
		planetScratch.x / sunKm,
		planetScratch.y / sunKm,
		planetScratch.z / sunKm,
	)
	return {
		hyperbola,
		table,
		anchorJD: draft.anchor,
		anchorF,
		sunKm,
		sunDirection,
		// a departure has only its outgoing side, an arrival its incoming one
		window:
			draft.kind === "departure"
				? [to, to]
				: draft.kind === "arrival"
					? [from, from]
					: [from, to],
	}
}

/** The encounter whose window holds `jd`, or null. */
export function encounterAt(
	trajectory: Pick<CraftTrajectory, "encounters">,
	jd: number,
): CraftEncounter | null {
	for (const encounter of trajectory.encounters) {
		if (jd >= encounter.from && jd <= encounter.to) return encounter
	}
	return null
}

/** Where the centres are, at the time being evaluated. */
export interface CentreFrame {
	readonly bodies: readonly Pick<Body, "radiusKm" | "parentId" | "orbit">[]
	/** True positions (km, scene axes), 3 per body. */
	readonly positionsKm: ArrayLike<number>
	/** Display positions (display km), 3 per body. */
	readonly displayKm: ArrayLike<number>
	readonly displayRadiiKm: ArrayLike<number>
	readonly scale: ScaleSettings
}

/** The passage's constants under the frame's scale (memoised per encounter). */
export function flybyScaleOf(
	trajectory: Pick<CraftTrajectory, "root">,
	encounter: CraftEncounter,
	frame: CentreFrame,
): FlybyScale | null {
	if (encounter.flyby === null) return null
	const radiusKm = frame.displayRadiiKm[encounter.planet]
	const cache = encounter.cache
	if (
		cache !== null &&
		cache.scale === frame.scale &&
		cache.radiusKm === radiusKm
	) {
		return cache.prepared
	}
	const prepared = prepareFlyby(encounter.flyby, frame.scale, {
		radiusKm: frame.bodies[encounter.planet].radiusKm,
		displayRadiusKm: radiusKm,
		rootRadiusKm: frame.bodies[trajectory.root].radiusKm,
		rootDisplayRadiusKm: frame.displayRadiiKm[trajectory.root],
	})
	encounter.cache = { scale: frame.scale, radiusKm, prepared }
	return prepared
}

/**
 * The true instant whose planet-relative motion the drawing shows at `jd`
 * (#56): during a passage the drawing runs slower than the clock near the
 * planet (./flyby.ts, "The pace"), elsewhere this is `jd` itself.
 */
export function drawnPhaseAt(
	trajectory: CraftTrajectory,
	jd: number,
	frame: CentreFrame,
): number {
	const encounter = encounterAt(trajectory, jd)
	if (
		encounter === null ||
		encounter.flyby === null ||
		jd < encounter.hyperFrom ||
		jd > encounter.hyperTo
	) {
		return jd
	}
	const prepared = flybyScaleOf(trajectory, encounter, frame)!
	if (prepared.identity) return jd
	return trueTimeAt(
		encounter.flyby.hyperbola,
		drawnAnomalyAt(encounter.flyby, prepared, jd),
	)
}

/** The state of a craft at one instant (written by `craftStateAt`). */
export interface CraftState {
	/** Inside the data range: false before `fromJD`, after `toJD`. */
	available: boolean
	/** True position (km, scene axes, the same frame as `positionsKm`). */
	readonly trueKm: Float64Array
	/** Velocity (km/s, scene axes) relative to the anchor (`anchorIndex`): the Sun, or the planet it is near. */
	readonly velocityKmS: Float64Array
	/** Drawn position (display km). */
	readonly displayKm: Float64Array
	/**
	 * The body the craft is placed around most (the planet while its segment
	 * weighs at least half, else the root): the neighbourhood it is in.
	 */
	anchorIndex: number
	/** Weight of the planet segment in the true position (0 when only the Sun's applies). */
	planetWeight: number
	/**
	 * The planet whose passage (or bound phase) draws the craft right now
	 * (#56), -1 when the Sun-centred map alone places it; and that drawing's
	 * weight (0..1, 1 while bound), the rest being the Sun-centred map's. A
	 * camera following the craft (#57) rescales with it on a scale change.
	 */
	drawnPlanet: number
	drawnWeight: number
}

export const createCraftState = (): CraftState => ({
	available: false,
	trueKm: new Float64Array(3),
	velocityKmS: new Float64Array(3),
	displayKm: new Float64Array(3),
	anchorIndex: -1,
	planetWeight: 0,
	drawnPlanet: -1,
	drawnWeight: 0,
})

/**
 * Draws a TRUE point (km, the frame of `positionsKm`) around body `anchor`
 * into `out` (display km). The default maps the offset from the anchor with
 * `displayOffset`; the scene passes one that also follows the anchored
 * reference frames (#31, `mapTruePointKm`).
 */
export type TruePointMapper = (
	anchor: number,
	x: number,
	y: number,
	z: number,
	out: Float64Array,
) => void

const rel = new Float64Array(3)
const vel = new Float64Array(3)
const mapped = new Float64Array(3)

const centreTrueScratch = new Float64Array(3)
const centreDisplayScratch = new Float64Array(3)

/** Reads a body's true and drawn position out of the frame. */
function centreOf(frame: CentreFrame, i: number): void {
	const o = i * 3
	for (let k = 0; k < 3; k++) {
		centreTrueScratch[k] = frame.positionsKm[o + k]
		centreDisplayScratch[k] = frame.displayKm[o + k]
	}
}

const planetTrue = new Float64Array(3)
const planetDrawn = new Float64Array(3)
const sunPlaced = new Float64Array(3)
const nearPlaced = new Float64Array(3)
const offsetThen = new Float64Array(3)
const skewTrue = new Float64Array(3)
const skewPlaced = new Float64Array(3)
const planetPlaced = new Float64Array(3)

/** The true point `trueKm` placed through the Sun-centred map, into `out`. */
function placeAroundSun(
	trajectory: CraftTrajectory,
	frame: CentreFrame,
	trueKm: Float64Array,
	centres: (frame: CentreFrame, index: number) => void,
	map: TruePointMapper | undefined,
	out: Float64Array,
): void {
	const root = trajectory.root
	if (map !== undefined) {
		map(root, trueKm[0], trueKm[1], trueKm[2], out)
		return
	}
	centres(frame, root)
	displayOffset(
		trueKm[0] - centreTrueScratch[0],
		trueKm[1] - centreTrueScratch[1],
		trueKm[2] - centreTrueScratch[2],
		frame.bodies[root].radiusKm,
		frame.displayRadiiKm[root],
		childDistanceCurve(frame.scale, true),
		out,
	)
	for (let k = 0; k < 3; k++) out[k] += centreDisplayScratch[k]
}

/** The drawn position of a craft at true position `state.trueKm` (see the module comment). */
function placeCraft(
	trajectory: CraftTrajectory,
	jd: number,
	frame: CentreFrame,
	state: CraftState,
	centres: (frame: CentreFrame, index: number) => void,
	map: TruePointMapper | undefined,
): void {
	const out = state.displayKm
	const encounter = encounterAt(trajectory, jd)
	state.drawnPlanet = -1
	state.drawnWeight = 0
	if (encounter === null) {
		placeAroundSun(trajectory, frame, state.trueKm, centres, map, out)
		return
	}
	const planet = encounter.planet
	centres(frame, planet)
	planetTrue.set(centreTrueScratch)
	planetDrawn.set(centreDisplayScratch)
	for (let k = 0; k < 3; k++) rel[k] = state.trueKm[k] - planetTrue[k]
	const passing =
		encounter.flyby !== null &&
		jd >= encounter.hyperFrom &&
		jd <= encounter.hyperTo
	if (!passing) {
		// bound: drawn like a moon (as the local track of an orbit phase is)
		state.drawnPlanet = planet
		state.drawnWeight = 1
		if (map !== undefined) {
			map(planet, state.trueKm[0], state.trueKm[1], state.trueKm[2], out)
			return
		}
		displayOffset(
			rel[0],
			rel[1],
			rel[2],
			frame.bodies[planet].radiusKm,
			frame.displayRadiiKm[planet],
			childDistanceCurve(frame.scale, false),
			out,
		)
		for (let k = 0; k < 3; k++) out[k] += planetDrawn[k]
		return
	}
	placeAroundSun(trajectory, frame, state.trueKm, centres, map, sunPlaced)
	const geometry = encounter.flyby!
	const prepared = flybyScaleOf(trajectory, encounter, frame)!
	if (prepared.identity || jd <= prepared.farJD[0] || jd >= prepared.farJD[1]) {
		// (past the hand-over, most of a long cruise: no need to find the phase)
		out.set(sunPlaced)
		return
	}
	const F = drawnAnomalyAt(geometry, prepared, jd)
	const weight = nearWeight(geometry.hyperbola, prepared, F)
	if (!(weight > 0)) {
		out.set(sunPlaced)
		return
	}
	state.drawnPlanet = planet
	state.drawnWeight = weight
	const then = trueTimeAt(geometry.hyperbola, F)
	if (!trueOffsetAt(trajectory, frame.bodies, planet, then, offsetThen)) {
		// no data at the matching true time: follow the osculating hyperbola
		const { a, b, e, p, q } = geometry.hyperbola
		const x = a * (e - Math.cosh(F))
		const y = b * Math.sinh(F)
		for (let k = 0; k < 3; k++) offsetThen[k] = x * p[k] + y * q[k]
	}
	drawnOffset(geometry, prepared, F, offsetThen, nearPlaced, skewTrue)
	// the legs' Sun-centred part, through the Sun-centred map itself
	for (let k = 0; k < 3; k++) skewTrue[k] += planetTrue[k]
	placeAroundSun(trajectory, frame, skewTrue, centres, map, skewPlaced)
	placeAroundSun(trajectory, frame, planetTrue, centres, map, planetPlaced)
	for (let k = 0; k < 3; k++) {
		const near =
			planetDrawn[k] + nearPlaced[k] + skewPlaced[k] - planetPlaced[k]
		out[k] = weight * near + (1 - weight) * sunPlaced[k]
	}
}

/**
 * The craft's true and drawn position at `jd`, with the centres where `frame`
 * has them (so `frame` must be at `jd` for the craft to sit right among the
 * bodies). Outside the data range `available` is false and nothing else is
 * written. This is the one function that places a craft: a camera that
 * follows one (#57) reads `state.displayKm` from it every frame.
 */
export function craftStateAt(
	trajectory: CraftTrajectory,
	jd: number,
	frame: CentreFrame,
	state: CraftState,
	centres: (frame: CentreFrame, index: number) => void = centreOf,
	map?: TruePointMapper,
): CraftState {
	if (!(jd >= trajectory.fromJD && jd <= trajectory.toJD)) {
		state.available = false
		return state
	}
	const planet = covering(trajectory.planetary, jd)
	const helio = covering(trajectory.helio, jd)
	let weight = 0
	if (planet !== null) {
		segmentState(planet, jd, rel)
		weight = blendWeight(
			planet.inner,
			planet.outer,
			Math.hypot(rel[0], rel[1], rel[2]),
		)
		if (helio === null) weight = 1
	}
	if (planet === null && helio === null) {
		state.available = false
		return state
	}
	state.available = true
	state.trueKm.fill(0)
	const anchor = planet !== null && weight >= 0.5 ? planet : (helio ?? planet)!
	if (planet !== null && weight > 0) {
		segmentState(planet, jd, rel)
		centres(frame, planet.centerIndex)
		for (let k = 0; k < 3; k++) {
			state.trueKm[k] += weight * (centreTrueScratch[k] + rel[k])
		}
	}
	if (helio !== null && weight < 1) {
		segmentState(helio, jd, rel)
		centres(frame, helio.centerIndex)
		for (let k = 0; k < 3; k++) {
			state.trueKm[k] += (1 - weight) * (centreTrueScratch[k] + rel[k])
		}
	}
	segmentState(anchor, jd, rel, vel)
	state.velocityKmS.set(vel)
	state.planetWeight = weight
	state.anchorIndex = anchor.centerIndex
	placeCraft(trajectory, jd, frame, state, centres, map)
	return state
}

/**
 * A centre lookup for another time than the frame's (for drawing a whole
 * path): the root stays where the frame has it, a planet is propagated from
 * its orbit to `jd` and drawn through the scale engine like the frame draws
 * it. Set `jd` before each `craftStateAt` call.
 */
export interface CentresAt {
	jd: number
	readonly lookup: (frame: CentreFrame, index: number) => void
}

export function createCentresAt(rootIndex: number): CentresAt {
	const planet: Vec3 = { x: 0, y: 0, z: 0 }
	const at: CentresAt = {
		jd: J2000_JD,
		lookup: (frame, i) => {
			const r = rootIndex * 3
			for (let k = 0; k < 3; k++) {
				centreTrueScratch[k] = frame.positionsKm[r + k]
				centreDisplayScratch[k] = frame.displayKm[r + k]
			}
			const body = frame.bodies[i]
			if (i === rootIndex || body.orbit === null) return
			propagate(body.orbit, at.jd, planet)
			const root = frame.bodies[rootIndex]
			displayOffset(
				planet.x,
				planet.y,
				planet.z,
				root.radiusKm,
				frame.displayRadiiKm[rootIndex],
				childDistanceCurve(frame.scale, true),
				mapped,
			)
			centreTrueScratch[0] += planet.x
			centreTrueScratch[1] += planet.y
			centreTrueScratch[2] += planet.z
			for (let k = 0; k < 3; k++) centreDisplayScratch[k] += mapped[k]
		},
	}
	return at
}

/** A path vertex is added wherever the craft turns by more than this around its centre (radians). */
export const PATH_MAX_TURN_RAD = 0.05
/** At most this many vertices between two stored samples. */
export const PATH_MAX_SUBDIVISIONS = 64
/** Spacing of the extra vertices along a drawn passage, in hyperbolic anomaly. */
export const PATH_FLYBY_STEP = 0.03

/**
 * Times (JD, ascending) at which to draw the path of `segments` between
 * `from` and `to`: every stored sample, and in between as many as keep the
 * turn around the centre per vertex under `PATH_MAX_TURN_RAD`, plus any
 * `extra` times (from `flybyPathTimes`).
 */
export function pathTimes(
	segments: readonly CraftSegment[],
	from: number,
	to: number,
	extra: readonly number[] = [],
): number[] {
	const times: number[] = []
	for (const segment of segments) {
		const { jd } = segment
		for (let i = 0; i + 1 < jd.length; i++) {
			if (jd[i + 1] < from || jd[i] > to) continue
			const a = i * 3
			const b = a + 3
			const r = Math.min(
				Math.hypot(segment.p[a], segment.p[a + 1], segment.p[a + 2]),
				Math.hypot(segment.p[b], segment.p[b + 1], segment.p[b + 2]),
			)
			const speed = Math.max(
				Math.hypot(segment.v[a], segment.v[a + 1], segment.v[a + 2]),
				Math.hypot(segment.v[b], segment.v[b + 1], segment.v[b + 2]),
			)
			const turn = (speed * (jd[i + 1] - jd[i]) * 86400) / Math.max(r, 1)
			const pieces = Math.min(
				PATH_MAX_SUBDIVISIONS,
				Math.max(1, Math.ceil(turn / PATH_MAX_TURN_RAD)),
			)
			for (let k = 0; k <= pieces; k++) {
				const t = jd[i] + ((jd[i + 1] - jd[i]) * k) / pieces
				if (t >= from && t <= to) times.push(t)
			}
		}
	}
	for (const t of extra) if (t >= from && t <= to) times.push(t)
	times.sort((a, b) => a - b)
	// drop repeats (segment edges, overlaps)
	return times.filter((t, k) => k === 0 || t - times[k - 1] > 1e-7)
}

/**
 * Extra path times (JD) along every drawn passage under the frame's scale:
 * the drawing slows the craft down near a planet (./flyby.ts), so its turn
 * is spread over days that the stored samples, dense only in true time,
 * would cross in a few vertices. Steps of `PATH_FLYBY_STEP` in hyperbolic
 * anomaly out to the end of the hand-over.
 */
export function flybyPathTimes(
	trajectory: CraftTrajectory,
	frame: CentreFrame,
	from: number,
	to: number,
): number[] {
	const times: number[] = []
	for (const encounter of trajectory.encounters) {
		const prepared = flybyScaleOf(trajectory, encounter, frame)
		const geometry = encounter.flyby
		if (prepared === null || geometry === null || prepared.identity) continue
		const lo = Math.max(from, encounter.hyperFrom)
		const hi = Math.min(to, encounter.hyperTo)
		if (!(hi > lo)) continue
		const { a, e } = geometry.hyperbola
		const reach = (km: number) => Math.acosh(Math.max(1, (km / a + 1) / e))
		const first = -reach(prepared.farKm[0])
		const last = reach(prepared.farKm[1])
		for (let F = first; F <= last; F += PATH_FLYBY_STEP) {
			const t = drawnTimeAt(geometry, prepared, F)
			if (t >= lo && t <= hi) times.push(t)
		}
	}
	return times
}

/**
 * Drawn positions (display km, 3 per time) of the craft at each of `times`,
 * each with the centres where they were at that time: a static path under the
 * frame's scale. Times without data repeat the previous vertex.
 */
export function fillPath(
	trajectory: CraftTrajectory,
	times: readonly number[],
	frame: CentreFrame,
	rootIndex: number,
	out: Float64Array,
): Float64Array {
	const centres = createCentresAt(rootIndex)
	const state = createCraftState()
	for (let k = 0; k < times.length; k++) {
		centres.jd = times[k]
		craftStateAt(trajectory, times[k], frame, state, centres.lookup)
		const o = k * 3
		if (state.available) {
			out[o] = state.displayKm[0]
			out[o + 1] = state.displayKm[1]
			out[o + 2] = state.displayKm[2]
		} else if (k > 0) {
			out[o] = out[o - 3]
			out[o + 1] = out[o - 2]
			out[o + 2] = out[o - 1]
		}
	}
	return out
}

/**
 * How far out (in drawn closest approaches) a passage is drawn relative to
 * its planet (#57, `passageTimes`).
 */
export const PASSAGE_REACH = 30

/**
 * Times (JD, ascending) at which to draw a passage relative to its planet
 * (#57): steps of `PATH_FLYBY_STEP` in hyperbolic anomaly along the drawn
 * hyperbola, out to where the planet-centred drawing hands over to the
 * Sun-centred map or `PASSAGE_REACH` drawn closest approaches, whichever is
 * nearer; only within the passage itself (an arrival ends at its capture).
 * Empty when the passage is drawn as the true path (true scale) or not at all.
 */
export function passageTimes(
	trajectory: CraftTrajectory,
	encounter: CraftEncounter,
	frame: CentreFrame,
): number[] {
	const prepared = flybyScaleOf(trajectory, encounter, frame)
	const geometry = encounter.flyby
	if (prepared === null || geometry === null || prepared.identity) return []
	const { a, e } = geometry.hyperbola
	// the drawn distance is about k times the true one near the planet, less beyond
	const reachKm = (PASSAGE_REACH * prepared.periapsisKm) / prepared.k
	const reach = (km: number) => Math.acosh(Math.max(1, (km / a + 1) / e))
	const first = -reach(Math.min(prepared.nearKm[0], reachKm))
	const last = reach(Math.min(prepared.nearKm[1], reachKm))
	const times: number[] = []
	for (let F = first; F <= last; F += PATH_FLYBY_STEP) {
		const t = drawnTimeAt(geometry, prepared, F)
		if (t >= encounter.hyperFrom && t <= encounter.hyperTo) times.push(t)
	}
	return times
}

/**
 * A passage drawn relative to its planet (#57): the craft's drawn offset from
 * the drawn planet (display km, 3 per time) at each of `times`, each with the
 * centres where they were at that time. Drawn round where the planet is now,
 * like a moon's orbit line, it is the hyperbola the drawing follows, with the
 * planet's true turn, and it passes through the marker at the frame's time.
 */
export function fillPassage(
	trajectory: CraftTrajectory,
	encounter: Pick<CraftEncounter, "planet">,
	times: readonly number[],
	frame: CentreFrame,
	out: Float64Array,
): Float64Array {
	const centres = createCentresAt(trajectory.root)
	const state = createCraftState()
	for (let k = 0; k < times.length; k++) {
		centres.jd = times[k]
		craftStateAt(trajectory, times[k], frame, state, centres.lookup)
		const o = k * 3
		if (!state.available) {
			if (k > 0) out.copyWithin(o, o - 3, o)
			continue
		}
		centres.lookup(frame, encounter.planet)
		for (let c = 0; c < 3; c++) {
			out[o + c] = state.displayKm[c] - centreDisplayScratch[c]
		}
	}
	return out
}

/**
 * A track around a planet at the frame's time: the craft's offsets from the
 * planet at each of `times` (one planet segment), drawn around where the
 * planet is NOW, the way a moon's orbit line is drawn. Writes display km,
 * 3 per time, into `out` and returns how many were written.
 */
export function fillTrack(
	segment: CraftSegment,
	times: ArrayLike<number>,
	frame: CentreFrame,
	out: Float64Array,
): number {
	const c = segment.centerIndex
	const body = frame.bodies[c]
	const curve = childDistanceCurve(frame.scale, segment.root)
	let written = 0
	for (let i = 0; i < times.length; i++) {
		const t = times[i]
		if (t < segment.from || t > segment.to) continue
		segmentState(segment, t, rel)
		displayOffset(
			rel[0],
			rel[1],
			rel[2],
			body.radiusKm,
			frame.displayRadiiKm[c],
			curve,
			mapped,
		)
		const o = written * 3
		for (let k = 0; k < 3; k++) {
			out[o + k] = frame.displayKm[c * 3 + k] + mapped[k]
		}
		written++
	}
	return written
}

/** What a craft is at `jd`, for the status line and for whether it is drawn. */
export type CraftPhase =
	/** Before launch. */
	| "planned"
	/** Launched, operating. */
	| "active"
	/** Mission over, the craft flies on unheard (Pioneer 10 and 11). */
	| "silent"
	/** Mission over, the craft no longer exists (Cassini). */
	| "destroyed"

export function craftPhase(
	craft: Pick<Spacecraft, "launch" | "end">,
	jd: number,
): CraftPhase {
	if (jd < isoToJD(craft.launch)) return "planned"
	if (craft.end === null || jd < isoToJD(craft.end.date)) return "active"
	return craft.end.kind
}

/** Whether a craft in `phase` exists in space (is drawn), given a position. */
export const isInSpace = (phase: CraftPhase): boolean =>
	phase === "active" || phase === "silent"

/** One-way light (radio) time between two true positions, seconds. */
export const lightTimeSeconds = (
	a: ArrayLike<number>,
	b: ArrayLike<number>,
): number => lightSeconds(distanceKm(a, b))

/** Distance between two true positions, km. */
export const distanceKm = (
	a: ArrayLike<number>,
	b: ArrayLike<number>,
): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

export const kmToAuValue = (km: number): number => km / AU_KM

/** Events in time order with their Julian Dates. */
export const eventsWithJD = (
	events: readonly SpacecraftEvent[],
): (SpacecraftEvent & { jd: number })[] =>
	events
		.map((event) => ({ ...event, jd: isoToJD(event.date) }))
		.sort((a, b) => a.jd - b.jd)
