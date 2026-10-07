/**
 * Pure transformation data/ourDB.json -> Body[] (see docs/ARCHITECTURE.md, "Data model").
 *
 * No I/O happens here: the caller passes the parsed source, a `fileExists` check for
 * public/ paths and a `ringsFor` lookup for the ring files other agents produce.
 * That keeps the mapping unit-testable with small fixtures.
 */
import { z } from "zod"

import { Rings as RingsSchema, SMALL_BODY_KINDS } from "../../src/data/schema"
import type {
	Appearance,
	Belt,
	BeltZone,
	Body,
	BodyKind,
	BodyTextures,
	ImageCredit,
	Orbit,
	Rings,
	Rotation,
} from "../../src/data/schema"
import type { Vec3 } from "../../src/sim/kepler"
import { eclipticDirection } from "../../src/sim/rotation"
import { HOURS_PER_DAY } from "../../src/sim/time"
import { AU_KM } from "../../src/sim/units"

import { rotateElementsToEcliptic } from "./frames"
import { spreadPhases } from "./hash"
import { IAU_ORIENTATIONS, PLANET_OBLATENESS } from "./iau"
import { slug } from "./names"
import { normalizeName } from "./names"
import { parseMass, parseNumber } from "./numbers"
import { creditsOf, resolveSurfaces, surfacePath } from "./surfaces"
import { applyPlanetTextures } from "./planetTextures"
import { densityKgPerM3, laplaceRadiusKm, periodDaysFromKepler } from "./orbit"
import {
	first,
	isRecord,
	nonZero,
	num,
	positive,
	positiveAbs,
	rec,
	records,
	str,
} from "./source"
import type { Raw } from "./source"

/** J2000 epoch as a Julian Date; every element in the source refers to it. */
export const J2000 = 2451545.0

/** Shared texture for moons that have none of their own (the Moon's map, #37). */
export const PLACEHOLDER_TEXTURE = "/assets/textures/earth/satellites/moon.jpg"

/**
 * Stand-in surfaces for small bodies without a map of their own (#23): a neutral rock texture,
 * and a darker one for comet nuclei (among the darkest surfaces in the solar system).
 */
export const SMALL_BODY_TEXTURES: Readonly<Partial<Record<BodyKind, string>>> =
	{
		dwarfPlanet: "/assets/textures/asteroid.jpg",
		asteroid: "/assets/textures/asteroid.jpg",
		comet: "/assets/textures/asteroid_dark.jpg",
	}

/** Added to Earth when the file exists. */
export const EARTH_NIGHT_TEXTURE = "/assets/textures/earth/earth_night.jpg"

/** Radius for moons with neither a mean radius nor a diameter. */
export const DEFAULT_MOON_RADIUS_KM = 5

/**
 * Planets whose rings come from data/rings/<id>.json: Uranus and Neptune are missing from the
 * source, its Jupiter ring (an opaque copy of a Saturn-like texture) is replaced by the real,
 * faint structure (halo, main ring, Amalthea gossamer ring), and Saturn's strips (of unknown
 * origin) by its measured ring profile.
 */
export const EXTERNAL_RING_PLANETS: readonly string[] = [
	"jupiter",
	"saturn",
	"uranus",
	"neptune",
]

/** A regular moon whose period is further than this from Kepler's third law gets a warning. */
export const KEPLER_PERIOD_TOLERANCE = 0.1

/** Mean densities outside this range (kg/m^3) get a warning: a mass or size typo. */
/**
 * A moon whose spin period is within this fraction of its orbital period is synchronous
 * (tidally locked); every such moon in the source agrees to better than 0.1 %.
 */
export const SYNCHRONOUS_TOLERANCE = 0.01

export const DENSITY_RANGE_KG_PER_M3: readonly [number, number] = [100, 10000]

/** Descriptive fields passed through into `info`, in output order. */
export const INFO_KEYS: readonly string[] = [
	"gravity",
	"density",
	"avgTemp",
	"discoveredBy",
	"discoveryDate",
	"alternativeName",
	"lengthOfDay",
	"orbitalVelocity",
	"composition",
	"mass",
	"vol",
	"dimension",
	"escape",
	"surfaceTemps",
	"flattening",
	"equaRadius",
	"polarRadius",
	"bodyType",
	// extra dictionary fields (src/data/solarDictionary.ts) so it can switch to bodies.json
	"diameter",
	"perihelion",
	"aphelion",
	"orbitalPeriod",
	"orbitalInclination",
	"axialTilt",
	"orbitPositionOffset",
]

const TEXTURE_KEYS = ["base", "topo", "specular", "clouds", "night"] as const
type TextureKey = (typeof TEXTURE_KEYS)[number]

export interface BuildOptions {
	/** true when a root-absolute public path ("/assets/...") exists on disk */
	fileExists: (publicPath: string) => boolean
	/** parsed data/rings/<planetId>.json, or null when there is no such file */
	ringsFor: (planetId: string) => unknown
	/**
	 * parsed data/featured-moons.json (#17): planet id -> moon id -> the story in one line.
	 * Absent: no moon is featured.
	 */
	featuredMoons?: unknown
	/**
	 * parsed data/moon-surfaces.json (#37): every moon's surface map and its source. Absent: moons
	 * keep the source's textures (or the shared placeholder).
	 */
	surfaces?: unknown
	/** parsed data/moon-surfaces.built.json: moon id -> { color } of its generated map */
	builtSurfaces?: unknown
	/**
	 * parsed data/planet-textures.json: the source of every Sun and planet texture. Absent: the
	 * textures are not credited (unit fixtures).
	 */
	planetTextures?: unknown
}

export interface BuildStats {
	total: number
	perKind: Record<BodyKind, number>
	moonsPerPlanet: Record<string, number>
	radiusEstimated: number
	phaseSynthetic: number
	/** moons whose equator-relative source elements were rotated into the ecliptic */
	equatorRotated: number
	periodDerived: number
	placeholderTextures: number
	rings: number
	/** small bodies in the source without real orbital elements, left out (#23) */
	smallBodiesSkipped: number
	/** moons flagged `featured` (data/featured-moons.json) */
	featured: number
}

export interface BuildResult {
	bodies: Body[]
	belts: Belt[]
	stats: BuildStats
	/** non-fatal findings, for stderr */
	warnings: string[]
	/** image sources in use, with credit and licence (src/data/credits.json; #37) */
	credits: ImageCredit[]
}

/** A data problem that must stop the build (missing planet texture, malformed ring file, ...). */
export class BuildError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "BuildError"
	}
}

interface Context {
	options: BuildOptions
	warnings: string[]
	usedIds: Set<string>
	equatorRotated: number
	smallBodiesSkipped: number
}

interface MoonRecord {
	raw: Raw
	fromSatellites: boolean
}

interface PlanetInfo {
	id: string
	name: string
	massKg: number | null
	/** IAU north pole as an ecliptic unit vector; null without IAU data */
	poleEcliptic: Vec3 | null
	/** moons inside it have equator-relative source inclinations; null when it cannot be computed */
	laplaceRadiusKm: number | null
}

const round = (value: number, decimals: number): number => {
	const factor = 10 ** decimals
	return Math.round(value * factor) / factor
}

/** Three decimals, kept inside [0, 360) after rounding. */
const roundAngle = (deg: number): number => {
	const rounded = round(deg, 3)
	return rounded >= 360 ? 0 : rounded
}

const byOrbitThenId = (a: Body, b: Body): number => {
	const diff = (a.orbit?.semiMajorAxisKm ?? 0) - (b.orbit?.semiMajorAxisKm ?? 0)
	if (diff !== 0) return diff
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const uniqueId = (
	base: string,
	parentId: string | null,
	ctx: Context,
): string => {
	let id = base
	if (ctx.usedIds.has(id) && parentId !== null) {
		id = `${base}${parentId}`
		ctx.warnings.push(`id collision: "${base}" is taken, using "${id}"`)
	}
	for (let n = 2; ctx.usedIds.has(id); n++) {
		id = `${base}${parentId ?? ""}${n}`
	}
	ctx.usedIds.add(id)
	return id
}

/** Drops null/undefined/"" everywhere and, at the top level, 0 (the source's "unknown"). */
const cleanInfoValue = (value: unknown, topLevel: boolean): unknown => {
	if (value === null || value === undefined) return undefined
	if (typeof value === "string") {
		return value.trim() === "" ? undefined : value
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return undefined
		return topLevel && value === 0 ? undefined : value
	}
	if (Array.isArray(value)) {
		const items = value
			.map((item) => cleanInfoValue(item, false))
			.filter((item) => item !== undefined)
		return items.length > 0 ? items : undefined
	}
	if (isRecord(value)) {
		const out: Raw = {}
		for (const [key, item] of Object.entries(value)) {
			const cleaned = cleanInfoValue(item, false)
			if (cleaned !== undefined) out[key] = cleaned
		}
		return Object.keys(out).length > 0 ? out : undefined
	}
	return value
}

const infoOf = (sources: readonly Raw[]): Record<string, unknown> => {
	const info: Record<string, unknown> = {}
	for (const key of INFO_KEYS) {
		for (const source of sources) {
			const value = cleanInfoValue(source[key], true)
			if (value !== undefined) {
				info[key] = value
				break
			}
		}
	}
	return info
}

/**
 * True when the shared placeholder is a real texture of this planet's moons (it depicts the
 * Moon, so under Earth it is the Moon's own map and keeps its bump map).
 */
export const ownsPlaceholderTexture = (planetId: string): boolean =>
	PLACEHOLDER_TEXTURE.startsWith(`/assets/textures/${planetId}/`)

/** A body drawn with the shared placeholder instead of a texture of its own. */
export const usesPlaceholderTexture = (
	body: Pick<Body, "parentId" | "textures">,
): boolean =>
	body.textures.base === PLACEHOLDER_TEXTURE &&
	(body.parentId === null || !ownsPlaceholderTexture(body.parentId))

/**
 * Curated presentation hints of a moon (#17, `Appearance` in the schema): `tint` ("#rrggbb")
 * and `veiled` from its source records. A malformed tint is dropped with a warning; nothing
 * curated gives nothing (the key is left out).
 */
const appearanceOf = (
	sources: readonly Raw[],
	label: string,
	ctx: Context,
): Pick<Body, "appearance"> => {
	const appearance: Appearance = {}
	const tint = first(sources, (raw) => str(raw.tint))
	if (tint !== null) {
		if (/^#[0-9a-f]{6}$/i.test(tint)) appearance.tint = tint.toLowerCase()
		else ctx.warnings.push(`${label}: tint "${tint}" is not #rrggbb, dropped`)
	}
	if (sources.some((raw) => raw.veiled === true)) appearance.veiled = true
	return Object.keys(appearance).length === 0 ? {} : { appearance }
}

const resolveTextures = (
	source: Raw | null,
	kind: BodyKind,
	label: string,
	ctx: Context,
	extra: Partial<Record<TextureKey, string>> = {},
): BodyTextures => {
	const wanted: Partial<Record<TextureKey, string>> = {}
	for (const key of TEXTURE_KEYS) {
		const path = str(source?.[key])
		if (path !== null) wanted[key] = path
	}
	Object.assign(wanted, extra)

	const found: Partial<Record<TextureKey, string>> = {}
	for (const key of TEXTURE_KEYS) {
		const path = wanted[key]
		if (path === undefined) continue
		if (ctx.options.fileExists(path)) {
			found[key] = path
		} else if (kind === "moon" || SMALL_BODY_KINDS.includes(kind)) {
			ctx.warnings.push(
				`${label}: texture ${key} "${path}" is missing under public/, dropped`,
			)
		} else {
			throw new BuildError(
				`${label}: texture ${key} "${path}" is missing under public/`,
			)
		}
	}

	if (found.base === undefined) {
		const stand = SMALL_BODY_TEXTURES[kind]
		if (stand !== undefined && ctx.options.fileExists(stand)) {
			return { base: stand }
		}
		if (kind !== "moon") {
			throw new BuildError(`${label}: no base texture`)
		}
		return { base: PLACEHOLDER_TEXTURE }
	}
	const textures: BodyTextures = { base: found.base }
	for (const key of TEXTURE_KEYS) {
		if (key !== "base" && found[key] !== undefined) textures[key] = found[key]
	}

	return textures
}

const assemble = (
	fields: Omit<Body, "radiusEstimated" | "tail"> & {
		radiusEstimated: boolean
		tail?: Body["tail"]
	},
): Body => ({
	id: fields.id,
	name: fields.name,
	kind: fields.kind,
	parentId: fields.parentId,
	radiusKm: fields.radiusKm,
	...(fields.radiusEstimated ? { radiusEstimated: true } : {}),
	massKg: fields.massKg,
	orbit: fields.orbit,
	rotation: fields.rotation,
	textures: fields.textures,
	...(fields.appearance === undefined ? {} : { appearance: fields.appearance }),
	rings: fields.rings,
	...(fields.tail === undefined ? {} : { tail: fields.tail }),
	info: fields.info,
})

const radiusOf = (
	sources: readonly Raw[],
	fallbackKm: number | null,
): { radiusKm: number; radiusEstimated: boolean } => {
	const meanRadius = first(sources, (raw) => positive(num(raw.meanRadius)))
	if (meanRadius !== null)
		return { radiusKm: meanRadius, radiusEstimated: false }
	const diameter = first(sources, (raw) => positive(num(raw.diameter)))
	if (diameter !== null)
		return { radiusKm: diameter / 2, radiusEstimated: true }
	if (fallbackKm === null) {
		throw new BuildError("no mean radius or diameter in the source")
	}
	return { radiusKm: fallbackKm, radiusEstimated: true }
}

/** Warns when mass and radius give a density no solid or gas body has: a typo in one of them. */
const checkDensity = (
	label: string,
	massKg: number | null,
	radiusKm: number,
	ctx: Context,
): void => {
	if (massKg === null) return
	const density = densityKgPerM3(massKg, radiusKm)
	const [min, max] = DENSITY_RANGE_KG_PER_M3
	if (density < min || density > max) {
		ctx.warnings.push(
			`${label}: mean density ${Math.round(density)} kg/m3 is implausible (mass ${massKg} kg, radius ${radiusKm} km)`,
		)
	}
}

/**
 * Spin from the source, normalized to one encoding of "retrograde". The export gives the
 * right-hand-rule obliquity (Venus 177.36, Uranus 97.77: above 90 means the spin vector
 * points south) AND flags the same fact with a negative `sideralRotation`. bodies.json keeps
 * the tilt to the IAU north pole (180 - tilt, so north-up maps stay upright) and lets the
 * period's sign alone carry the direction. IAU poles and prime meridians attach by id.
 */
const rotationOf = (sources: readonly Raw[], id: string): Rotation => {
	let periodHours = first(sources, (raw) => nonZero(num(raw.sideralRotation)))
	let axialTiltDeg = first(sources, (raw) => num(raw.axialTilt)) ?? 0
	if (axialTiltDeg > 90) {
		axialTiltDeg = round(180 - axialTiltDeg, 4)
		if (periodHours !== null) periodHours = -Math.abs(periodHours)
	}
	const iau = IAU_ORIENTATIONS[id]
	if (iau === undefined) return { periodHours, axialTiltDeg }
	const { rotationRateDegPerDay, ...pole } = iau
	return {
		periodHours: round((360 * HOURS_PER_DAY) / rotationRateDegPerDay, 9),
		axialTiltDeg,
		...pole,
	}
}

/**
 * Marks tidally locked moons `synchronous`. A moon with a spin period is locked when the
 * period matches its orbital period. A moon without one is ASSUMED locked when it is a
 * regular moon (inside its planet's Laplace radius): every regular moon with a measured
 * rotation is, tides lock such moons within the age of the solar system, and the IAU
 * models them so. It then gets its orbital period as spin period (`rotationAssumed` in
 * `info`). A curated `rotationChaotic` (Hyperion, which tumbles) or an irregular moon
 * without a period keeps a null period: no spin rather than a made-up one.
 */
export const synchronousRotation = (
	rotation: Rotation,
	orbitPeriodDays: number,
	isRegular: boolean,
	chaotic: boolean,
): { rotation: Rotation; assumed: boolean } => {
	const period = rotation.periodHours
	if (period !== null) {
		const ratio = Math.abs(period) / HOURS_PER_DAY / orbitPeriodDays
		const locked = Math.abs(ratio - 1) <= SYNCHRONOUS_TOLERANCE
		return {
			rotation: locked ? { ...rotation, synchronous: true } : rotation,
			assumed: false,
		}
	}
	if (!isRegular || chaotic) return { rotation, assumed: false }
	return {
		rotation: {
			...rotation,
			periodHours: round(orbitPeriodDays * HOURS_PER_DAY, 4),
			synchronous: true,
		},
		assumed: true,
	}
}

const ringsOf = (raw: Raw, planetId: string, ctx: Context): Rings | null => {
	const source = rec(raw.rings)
	if (source !== null) {
		const inner = positive(num(source.innerRadius))
		const outer = positive(num(source.outerRadius))
		const textures = rec(source.textures)
		const alpha = str(textures?.base)
		const color = str(textures?.colorMap)
		if (inner === null || outer === null || alpha === null || color === null) {
			throw new BuildError(`${planetId}: incomplete ring data in the source`)
		}
		return checkRings(
			{
				innerRadiusKm: inner,
				outerRadiusKm: outer,
				textures: { alpha, color },
			},
			planetId,
			ctx,
		)
	}

	const external = ctx.options.ringsFor(planetId)
	if (external === null || external === undefined) {
		if (EXTERNAL_RING_PLANETS.includes(planetId)) {
			ctx.warnings.push(
				`${planetId}: no ring data (data/rings/${planetId}.json not found), rings left null`,
			)
		}
		return null
	}
	const parsed = RingsSchema.safeParse(external)
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
			.join("; ")
		throw new BuildError(
			`${planetId}: invalid data/rings/${planetId}.json (${issues})`,
		)
	}
	const { innerRadiusKm, outerRadiusKm, textures, castsShadow } = parsed.data
	return checkRings(
		{
			innerRadiusKm,
			outerRadiusKm,
			textures: { alpha: textures.alpha, color: textures.color },
			...(castsShadow === undefined ? {} : { castsShadow }),
		},
		planetId,
		ctx,
	)
}

const checkRings = (rings: Rings, planetId: string, ctx: Context): Rings => {
	for (const [key, path] of Object.entries(rings.textures)) {
		if (!ctx.options.fileExists(path)) {
			throw new BuildError(
				`${planetId}: ring texture ${key} "${path}" is missing under public/`,
			)
		}
	}
	return rings
}

const buildSun = (raw: Raw, ctx: Context): Body => {
	const name = str(raw.englishName) ?? str(raw.name)
	if (name === null) throw new BuildError("the sun has no name")
	const id = uniqueId(slug(name), null, ctx)
	const radius = radiusOf([raw], null)
	const massKg = parseMass(raw.mass)
	checkDensity(name, massKg, radius.radiusKm, ctx)
	return assemble({
		id,
		name,
		kind: "star",
		parentId: null,
		...radius,
		massKg,
		orbit: null,
		rotation: rotationOf([raw], id),
		textures: resolveTextures(rec(raw.textures), "star", name, ctx),
		rings: null,
		info: infoOf([raw]),
	})
}

/** The epoch of a record's elements: a curated `epochJD` (small bodies, #23), else J2000. */
const epochOf = (sources: readonly Raw[]): number =>
	first(sources, (raw) => positive(num(raw.epochJD))) ?? J2000

/**
 * A small body (#23) is emitted only with real orbital elements: a semi-major axis, a period
 * and a phase (node, periapsis and anomaly not all 0). Most of the source's asteroids and two
 * of its comets (Shoemaker-Levy 9, destroyed in 1994; Hyakutake) have none and are left out:
 * a body drawn in a made-up place teaches the wrong sky.
 */
export const hasRealElements = (raw: Raw): boolean =>
	positive(num(raw.semimajorAxis)) !== null &&
	positiveAbs(num(raw.sideralOrbit)) !== null &&
	[raw.longAscNode, raw.argPeriapsis, raw.mainAnomaly].some(
		(value) => nonZero(num(value)) !== null,
	)

/** The source (a link or a citation) a curated tail value needs, or a build error. */
const tailSource = (sources: Raw | null, key: string, label: string): void => {
	if (str(sources?.[key]) === null) {
		throw new BuildError(`${label}: the tail's ${key} has no source`)
	}
}

/**
 * A comet's curated `tail` (#23, #55): where it wakes up and where it is fully active
 * (`onsetAu`, `fullAu`), its longest observed tails (`ionLengthKm`, `dustLengthKm`, 0 for one
 * it does not grow) and an optional `lagDays`, each with its source in `sources`. AU in the source, km in the output;
 * anything missing, inconsistent or without a source stops the build.
 */
export const tailOf = (raw: Raw, label = "comet"): Body["tail"] => {
	const tail = rec(raw.tail)
	if (tail === null) return undefined
	const onsetAu = positive(num(tail.onsetAu))
	const fullAu = positive(num(tail.fullAu))
	const ionLengthKm = num(tail.ionLengthKm)
	const dustLengthKm = num(tail.dustLengthKm)
	const lagDays = num(tail.lagDays)
	if (
		onsetAu === null ||
		fullAu === null ||
		ionLengthKm === null ||
		dustLengthKm === null ||
		ionLengthKm < 0 ||
		dustLengthKm < 0 ||
		!(ionLengthKm > 0 || dustLengthKm > 0) ||
		!(fullAu < onsetAu)
	) {
		throw new BuildError(`${label}: incomplete tail`)
	}
	const sources = rec(tail.sources)
	for (const key of ["onset", "full", "ionLength", "dustLength"]) {
		tailSource(sources, key, label)
	}
	if (lagDays !== null && lagDays !== 0) tailSource(sources, "lag", label)
	return {
		onsetKm: Math.round(onsetAu * AU_KM),
		fullKm: Math.round(fullAu * AU_KM),
		ionLengthKm,
		dustLengthKm,
		...(lagDays === null || lagDays === 0 ? {} : { lagDays }),
	}
}

const buildPlanet = (
	raw: Raw,
	sunId: string,
	ctx: Context,
	kind: BodyKind = "planet",
): Body => {
	const name = str(raw.englishName) ?? str(raw.name)
	if (name === null) throw new BuildError(`a ${kind} has no name`)
	const semiMajorAxisKm =
		positive(num(raw.semimajorAxis)) ?? positive(num(raw.distanceFromParent))
	const periodDays =
		positiveAbs(num(raw.sideralOrbit)) ?? positiveAbs(num(raw.orbitalPeriod))
	if (semiMajorAxisKm === null || periodDays === null) {
		throw new BuildError(`${name}: ${kind} without semi-major axis or period`)
	}
	const id = uniqueId(slug(name), sunId, ctx)
	const orbit: Orbit = {
		semiMajorAxisKm,
		eccentricity: num(raw.eccentricity) ?? 0,
		inclinationDeg: num(raw.inclination) ?? num(raw.orbitalInclination) ?? 0,
		longAscNodeDeg: num(raw.longAscNode) ?? 0,
		argPeriapsisDeg: num(raw.argPeriapsis) ?? 0,
		meanAnomalyDeg: num(raw.mainAnomaly) ?? 0,
		periodDays,
		epochJD: epochOf([raw]),
	}
	const extraTextures: Partial<Record<TextureKey, string>> =
		id === "earth" && ctx.options.fileExists(EARTH_NIGHT_TEXTURE)
			? { night: EARTH_NIGHT_TEXTURE }
			: {}
	const radius = radiusOf([raw], null)
	const massKg = parseMass(raw.mass)
	checkDensity(name, massKg, radius.radiusKm, ctx)
	return assemble({
		id,
		name,
		kind,
		parentId: sunId,
		...radius,
		massKg,
		orbit,
		rotation: rotationOf([raw], id),
		textures: resolveTextures(
			rec(raw.textures),
			kind,
			name,
			ctx,
			extraTextures,
		),
		rings: ringsOf(raw, id, ctx),
		tail: tailOf(raw, name),
		info: infoOf([raw]),
	})
}

/**
 * What the moons of a planet need from it: mass (Kepler), the IAU pole (to rotate
 * equator-relative elements) and the Laplace radius (which moons those are).
 */
const planetInfoOf = (planet: Body, sunMassKg: number | null): PlanetInfo => {
	const { rotation, orbit, massKg } = planet
	const poleEcliptic =
		rotation.poleRaDeg !== undefined && rotation.poleDecDeg !== undefined
			? eclipticDirection(rotation.poleRaDeg, rotation.poleDecDeg)
			: null
	const oblateness = PLANET_OBLATENESS[planet.id]
	const laplace =
		oblateness !== undefined &&
		orbit !== null &&
		massKg !== null &&
		sunMassKg !== null
			? laplaceRadiusKm(
					oblateness.j2,
					oblateness.equatorialRadiusKm,
					orbit.semiMajorAxisKm,
					orbit.eccentricity,
					massKg,
					sunMassKg,
				)
			: null
	return {
		id: planet.id,
		name: planet.name,
		massKg,
		poleEcliptic,
		laplaceRadiusKm: laplace,
	}
}

/**
 * Groups the `moons` (API export) and `satellites` (hand-curated) entries of a planet by
 * normalized English name. API records come first in every group so they win ties.
 */
const collectMoonGroups = (
	planetRaw: Raw,
	planet: PlanetInfo,
	ctx: Context,
): MoonRecord[][] => {
	const groups = new Map<string, MoonRecord[]>()
	const add = (key: string, record: MoonRecord): void => {
		const group = groups.get(key)
		if (group === undefined) {
			groups.set(key, [record])
			return
		}
		if (record.fromSatellites && group.some((g) => g.fromSatellites)) {
			ctx.warnings.push(
				`${planet.name}: duplicate satellites entry "${str(record.raw.name)}", the first one wins`,
			)
		}
		group.push(record)
	}

	for (const raw of records(planetRaw.moons)) {
		if ("ISS" in raw) continue
		const name = str(raw.englishName) ?? str(raw.name)
		if (name === null) {
			ctx.warnings.push(`${planet.name}: skipping a moons entry without a name`)
			continue
		}
		add(normalizeName(name), { raw, fromSatellites: false })
	}
	for (const raw of records(planetRaw.satellites)) {
		const name = str(raw.name)
		if (name === null) {
			ctx.warnings.push(
				`${planet.name}: skipping a satellites entry without a name`,
			)
			continue
		}
		add(normalizeName(name), { raw, fromSatellites: true })
	}

	for (const group of groups.values()) {
		if (!group.some((g) => !g.fromSatellites)) {
			ctx.warnings.push(
				`${planet.name}: satellites entry "${str(group[0].raw.name)}" has no API partner in moons[], using its curated fields`,
			)
		}
	}
	if (groups.size > 0 && planet.poleEcliptic === null) {
		ctx.warnings.push(
			`${planet.name}: no IAU pole, its moons' orbit planes are taken as ecliptic-relative`,
		)
	}
	if (groups.size > 0 && planet.laplaceRadiusKm === null) {
		ctx.warnings.push(
			`${planet.name}: no J2 or mass for a Laplace radius, its moons' orbit planes are taken as ecliptic-relative`,
		)
	}
	return [...groups.values()]
}

const buildMoon = (
	group: MoonRecord[],
	planet: PlanetInfo,
	ctx: Context,
): Body | null => {
	const sources = group.map((g) => g.raw)
	const name =
		first(sources, (raw) => str(raw.englishName)) ??
		first(sources, (raw) => str(raw.name))
	if (name === null) return null
	const label = `${planet.name}/${name}`

	const semiMajorAxisKm =
		first(sources, (raw) => positive(num(raw.semimajorAxis))) ??
		first(sources, (raw) => positive(num(raw.distanceFromParent)))
	if (semiMajorAxisKm === null) {
		ctx.warnings.push(`${label}: skipped, no usable semi-major axis`)
		return null
	}
	// inside the Laplace radius the source inclination refers to the planet's equator
	const isRegular =
		planet.laplaceRadiusKm !== null && semiMajorAxisKm < planet.laplaceRadiusKm

	let periodDerived = false
	let periodDays =
		first(sources, (raw) => positiveAbs(num(raw.sideralOrbit))) ??
		first(sources, (raw) => positiveAbs(parseNumber(raw.orbitalPeriod)))
	if (periodDays === null) {
		if (planet.massKg === null) {
			ctx.warnings.push(
				`${label}: skipped, no usable period and no parent mass`,
			)
			return null
		}
		periodDays = round(periodDaysFromKepler(semiMajorAxisKm, planet.massKg), 4)
		periodDerived = true
		ctx.warnings.push(
			`${label}: no period in the source, derived ${periodDays} d from Kepler's third law`,
		)
	} else if (isRegular && planet.massKg !== null) {
		const kepler = periodDaysFromKepler(semiMajorAxisKm, planet.massKg)
		const deviation = periodDays / kepler - 1
		if (Math.abs(deviation) > KEPLER_PERIOD_TOLERANCE) {
			ctx.warnings.push(
				`${label}: period ${periodDays} d is ${Math.round(100 * Math.abs(deviation))} % ${deviation > 0 ? "longer" : "shorter"} than Kepler's third law gives (${round(kepler, 4)} d)`,
			)
		}
	}

	const id = uniqueId(slug(name), planet.id, ctx)

	let inclinationDeg =
		first(sources, (raw) => num(raw.inclination)) ??
		first(sources, (raw) => num(raw.orbitalInclination)) ??
		0
	let longAscNodeDeg = first(sources, (raw) => num(raw.longAscNode)) ?? 0
	let argPeriapsisDeg = first(sources, (raw) => num(raw.argPeriapsis)) ?? 0
	let meanAnomalyDeg = first(sources, (raw) => num(raw.mainAnomaly)) ?? 0
	const phaseSynthetic =
		longAscNodeDeg === 0 && argPeriapsisDeg === 0 && meanAnomalyDeg === 0
	if (phaseSynthetic) {
		;({ longAscNodeDeg, argPeriapsisDeg, meanAnomalyDeg } = spreadPhases(id))
		if (isRegular && planet.poleEcliptic !== null) {
			// the spread node and periapsis are relative to the equator; rotate all three angles
			const rotated = rotateElementsToEcliptic(
				{ inclinationDeg, longAscNodeDeg, argPeriapsisDeg },
				planet.poleEcliptic,
			)
			inclinationDeg = roundAngle(rotated.inclinationDeg)
			longAscNodeDeg = roundAngle(rotated.longAscNodeDeg)
			argPeriapsisDeg = roundAngle(rotated.argPeriapsisDeg)
			ctx.equatorRotated++
		}
	}

	const orbit: Orbit = {
		semiMajorAxisKm,
		eccentricity: first(sources, (raw) => num(raw.eccentricity)) ?? 0,
		inclinationDeg,
		longAscNodeDeg,
		argPeriapsisDeg,
		meanAnomalyDeg,
		periodDays,
		epochJD: epochOf(sources),
		...(phaseSynthetic ? { phaseSynthetic: true } : {}),
		...precessionOf(sources),
	}

	const textureSource =
		group.find((g) => g.fromSatellites && rec(g.raw.textures) !== null) ??
		group.find((g) => rec(g.raw.textures) !== null)
	let textures = resolveTextures(
		textureSource === undefined ? null : rec(textureSource.raw.textures),
		"moon",
		label,
		ctx,
	)
	if (
		textures.base === PLACEHOLDER_TEXTURE &&
		!ownsPlaceholderTexture(planet.id)
	) {
		// curated entries pair the placeholder with the Moon's bump map: not this moon's relief
		textures = { base: PLACEHOLDER_TEXTURE }
	}

	const info = infoOf(sources)
	if (periodDerived) info.periodDerived = true
	const spin = synchronousRotation(
		rotationOf(sources, id),
		periodDays,
		isRegular,
		sources.some((raw) => raw.rotationChaotic === true),
	)
	if (spin.assumed) info.rotationAssumed = true

	const radius = radiusOf(sources, DEFAULT_MOON_RADIUS_KM)
	const massKg = first(sources, (raw) => parseMass(raw.mass))
	checkDensity(label, massKg, radius.radiusKm, ctx)

	return assemble({
		id,
		name,
		kind: "moon",
		parentId: planet.id,
		...radius,
		massKg,
		orbit,
		rotation: spin.rotation,
		textures,
		...appearanceOf(sources, label, ctx),
		rings: null,
		info,
	})
}

/**
 * Curated secular drift of a moon's orbit (the Moon: node regression and apsidal
 * precession, from the Meeus ch. 47 mean elements); both rates or nothing.
 */
const precessionOf = (sources: readonly Raw[]): Pick<Orbit, "precession"> => {
	const nodeDegPerDay = first(sources, (raw) =>
		num(raw.nodePrecessionDegPerDay),
	)
	const argPeriapsisDegPerDay = first(sources, (raw) =>
		num(raw.argPeriapsisPrecessionDegPerDay),
	)
	if (nodeDegPerDay === null || argPeriapsisDegPerDay === null) return {}
	return { precession: { nodeDegPerDay, argPeriapsisDegPerDay } }
}

const statsOf = (bodies: Body[], planets: Body[], ctx: Context): BuildStats => {
	const perKind: Record<BodyKind, number> = {
		star: 0,
		planet: 0,
		dwarfPlanet: 0,
		moon: 0,
		asteroid: 0,
		comet: 0,
	}
	const moonsPerPlanet: Record<string, number> = {}
	for (const planet of planets) moonsPerPlanet[planet.id] = 0
	let radiusEstimated = 0
	let phaseSynthetic = 0
	let periodDerived = 0
	let placeholderTextures = 0
	let rings = 0
	let featured = 0
	for (const body of bodies) {
		if (body.featured) featured++
		perKind[body.kind]++
		if (body.kind === "moon" && body.parentId !== null) {
			moonsPerPlanet[body.parentId] = (moonsPerPlanet[body.parentId] ?? 0) + 1
		}
		if (body.radiusEstimated) radiusEstimated++
		if (body.orbit?.phaseSynthetic) phaseSynthetic++
		if (body.info.periodDerived === true) periodDerived++
		if (usesPlaceholderTexture(body)) placeholderTextures++
		if (body.rings !== null) rings++
	}
	return {
		total: bodies.length,
		perKind,
		moonsPerPlanet,
		radiusEstimated,
		phaseSynthetic,
		equatorRotated: ctx.equatorRotated,
		periodDerived,
		placeholderTextures,
		rings,
		smallBodiesSkipped: ctx.smallBodiesSkipped,
		featured,
	}
}

/** data/featured-moons.json: planet id -> moon id -> why it is featured (one line). */
const FeaturedMoons = z.record(
	z.string(),
	z.record(z.string(), z.string().trim().min(1)),
)

/**
 * Flags the curated moons `featured` (#17), in place. Every listed moon must exist and
 * orbit the planet it is listed under; anything else stops the build, so the curated
 * set can never silently shrink when the source data changes.
 */
export const markFeatured = (bodies: Body[], source: unknown): void => {
	if (source === undefined) return
	const parsed = FeaturedMoons.safeParse(
		Object.fromEntries(
			Object.entries(rec(source) ?? {}).filter(([key]) => !key.startsWith("$")),
		),
	)
	if (!parsed.success) {
		throw new BuildError(
			`invalid data/featured-moons.json (${parsed.error.issues.map((issue) => issue.message).join("; ")})`,
		)
	}
	const index = new Map(bodies.map((body, i) => [body.id, i]))
	for (const [planetId, moons] of Object.entries(parsed.data)) {
		for (const moonId of Object.keys(moons)) {
			const i = index.get(moonId)
			const moon = i === undefined ? undefined : bodies[i]
			if (moon === undefined || moon.kind !== "moon") {
				throw new BuildError(
					`featured moon "${moonId}" is not a moon in the data`,
				)
			}
			if (moon.parentId !== planetId) {
				throw new BuildError(
					`featured moon "${moonId}" orbits "${moon.parentId}", not "${planetId}"`,
				)
			}
			bodies[i as number] = { ...moon, featured: true }
		}
	}
}

/**
 * Credits the Sun's and the planets' textures (data/planet-textures.json) in front of the
 * moons' `moonCredits`, and gives them their `surface`, in place.
 */
const withPlanetTextures = (
	bodies: Body[],
	options: Pick<BuildOptions, "planetTextures" | "surfaces">,
	moonCredits: ImageCredit[],
): ImageCredit[] => {
	if (options.planetTextures === undefined) return moonCredits
	try {
		return applyPlanetTextures(
			bodies,
			options.planetTextures,
			options.surfaces,
			moonCredits,
		)
	} catch (error) {
		throw new BuildError(error instanceof Error ? error.message : String(error))
	}
}

/** data/moon-surfaces.built.json: moon id -> the generated map's mean colour. */
const BuiltSurfaces = z.record(
	z.string(),
	z.object({ color: z.string().regex(/^#[0-9a-f]{6}$/) }).loose(),
)

/**
 * Gives every moon its surface from data/moon-surfaces.json (#37), in place: the texture,
 * where it comes from (`surface`) and its mean colour (`appearance.color`, drawn until the map
 * has loaded). Colours are baked into the maps, so curated tints no longer apply to moons. A
 * moon without a surface, a surface for something that is not a moon of that planet, or a
 * missing image stops the build. Returns the credits of the sources in use.
 */
export const applySurfaces = (
	bodies: Body[],
	options: Pick<BuildOptions, "surfaces" | "builtSurfaces" | "fileExists">,
): ImageCredit[] => {
	if (options.surfaces === undefined) return []
	let resolved: ReturnType<typeof resolveSurfaces>
	try {
		resolved = resolveSurfaces(options.surfaces)
	} catch (error) {
		throw new BuildError(error instanceof Error ? error.message : String(error))
	}
	const built = BuiltSurfaces.safeParse(options.builtSurfaces ?? {})
	if (!built.success) {
		throw new BuildError("invalid data/moon-surfaces.built.json")
	}
	const usage: { bodyId: string; sourceId: string }[] = []
	const moons = new Set<string>()
	bodies.forEach((body, i) => {
		if (body.kind !== "moon") return
		moons.add(body.id)
		const surface = resolved.byId.get(body.id)
		if (surface === undefined) {
			throw new BuildError(
				`moon "${body.id}" has no surface in data/moon-surfaces.json`,
			)
		}
		if (surface.planet !== body.parentId) {
			throw new BuildError(
				`data/moon-surfaces.json puts "${body.id}" under "${surface.planet}", but it orbits "${body.parentId}"`,
			)
		}
		const base = surfacePath(surface.planet, body.id)
		if (!options.fileExists(base)) {
			throw new BuildError(
				`${body.id}: ${base} is missing under public/ (run pnpm gen:surfaces)`,
			)
		}
		const color = built.data[body.id]?.color
		const kind =
			surface.kind === "map"
				? "map"
				: surface.recipe.pattern === "haze"
					? "haze"
					: "painted"
		const rest: Body = { ...body }
		delete rest.appearance
		bodies[i] = {
			...rest,
			textures: { base },
			...(color === undefined ? {} : { appearance: { color } }),
			surface: {
				kind,
				source: surface.sourceId,
				...(surface.kind === "map" && surface.filled ? { filled: true } : {}),
			},
		}
		usage.push({ bodyId: body.id, sourceId: surface.sourceId })
	})
	for (const id of resolved.byId.keys()) {
		if (!moons.has(id)) {
			throw new BuildError(
				`data/moon-surfaces.json lists "${id}", which is not a moon in the data`,
			)
		}
	}
	return creditsOf(resolved.catalogue, usage)
}

/**
 * Builds the topologically ordered body list: the Sun, the planets by semi-major axis,
 * then each planet's moons (by semi-major axis) grouped right after the planet block.
 */
export const buildBodies = (
	source: unknown,
	options: BuildOptions,
): BuildResult => {
	const db = rec(source)
	if (db === null) throw new BuildError("the source is not a JSON object")
	const suns = records(db.suns)
	if (suns.length !== 1) {
		throw new BuildError(`expected exactly one sun, found ${suns.length}`)
	}
	const ctx: Context = {
		options,
		warnings: [],
		usedIds: new Set(),
		equatorRotated: 0,
		smallBodiesSkipped: 0,
	}

	const sun = buildSun(suns[0], ctx)
	const planetEntries = records(db.planets)
		.map((raw) => ({ raw, body: buildPlanet(raw, sun.id, ctx) }))
		.sort((a, b) => byOrbitThenId(a.body, b.body))

	const bodies: Body[] = [sun, ...planetEntries.map((entry) => entry.body)]
	const pushMoons = (raw: Raw, body: Body): void => {
		const planet = planetInfoOf(body, sun.massKg)
		const moons = collectMoonGroups(raw, planet, ctx)
			.map((group) => buildMoon(group, planet, ctx))
			.filter((moon): moon is Body => moon !== null)
			.sort(byOrbitThenId)
		bodies.push(...moons)
	}
	for (const { raw, body } of planetEntries) pushMoons(raw, body)

	// the small bodies (#23) come after the planets' moons, so existing indices stay put:
	// dwarf planets, asteroids and comets by semi-major axis, then the dwarf planets' moons
	const smallEntries = SMALL_BODY_SOURCES.flatMap(([key, kind]) =>
		records(db[key])
			.filter((raw) => {
				if (hasRealElements(raw)) return true
				ctx.smallBodiesSkipped++
				return false
			})
			.map((raw) => ({ raw, body: buildPlanet(raw, sun.id, ctx, kind) }))
			.sort((a, b) => byOrbitThenId(a.body, b.body)),
	)
	bodies.push(...smallEntries.map((entry) => entry.body))
	for (const { raw, body } of smallEntries) pushMoons(raw, body)

	markFeatured(bodies, options.featuredMoons)
	const credits = withPlanetTextures(
		bodies,
		options,
		applySurfaces(bodies, options),
	)

	return {
		bodies,
		belts: buildBelts(db, sun.id),
		stats: statsOf(
			bodies,
			[...planetEntries, ...smallEntries]
				.map((entry) => entry.body)
				.filter((body) => body.kind !== "asteroid" && body.kind !== "comet"),
			ctx,
		),
		warnings: ctx.warnings,
		credits,
	}
}

/** Source arrays of the small bodies and the kind each one holds. */
const SMALL_BODY_SOURCES: readonly (readonly [string, BodyKind])[] = [
	["dwarfPlanets", "dwarfPlanet"],
	["asteroids", "asteroid"],
	["comets", "comet"],
]

/** Source keys of the belts (#23), in output order. */
export const BELT_SOURCES: readonly string[] = ["asteroidBelt", "kuiperBelt"]

const beltZoneOf = (raw: Raw, label: string): BeltZone => {
	const a = Array.isArray(raw.semiMajorAxisAu) ? raw.semiMajorAxisAu : []
	const e = Array.isArray(raw.eccentricity) ? raw.eccentricity : []
	const share = positive(num(raw.share))
	const sigma = num(raw.inclinationSigmaDeg)
	const aMin = positive(num(a[0]))
	const aMax = positive(num(a[1]))
	const eMin = num(e[0])
	const eMax = num(e[1])
	if (
		share === null ||
		sigma === null ||
		aMin === null ||
		aMax === null ||
		eMin === null ||
		eMax === null ||
		aMax < aMin ||
		eMax < eMin
	) {
		throw new BuildError(`${label}: incomplete belt zone`)
	}
	const perihelionMin = positive(num(raw.perihelionMinAu))
	return {
		share,
		semiMajorAxisKm: [Math.round(aMin * AU_KM), Math.round(aMax * AU_KM)],
		eccentricity: [eMin, eMax],
		inclinationSigmaDeg: sigma,
		...(perihelionMin === null
			? {}
			: { perihelionMinKm: Math.round(perihelionMin * AU_KM) }),
	}
}

/**
 * The belts (#23) from the curated `asteroidBelt` and `kuiperBelt` records: how many dots,
 * the real population they stand for and the zones the dots are spread over (AU in the
 * source, km in the output). A belt without zones is left out.
 */
export const buildBelts = (db: Raw, sunId: string): Belt[] =>
	BELT_SOURCES.flatMap((key): Belt[] => {
		const raw = rec(db[key])
		if (raw === null || !Array.isArray(raw.zones)) return []
		const name = str(raw.name) ?? key
		const members = rec(raw.members)
		const dots = positive(num(raw.dots))
		const count = positive(num(members?.count))
		const minDiameterKm = positive(num(members?.minDiameterKm))
		const meanSeparationKm = positive(num(raw.meanSeparationKm))
		const color = str(raw.color)
		const extent = rec(raw.distanceFromParent)
		const extentMin = positive(num(extent?.min))
		const extentMax = positive(num(extent?.max))
		if (
			extentMin === null ||
			extentMax === null ||
			dots === null ||
			count === null ||
			minDiameterKm === null ||
			meanSeparationKm === null ||
			color === null
		) {
			throw new BuildError(`${name}: incomplete belt`)
		}
		const zones = records(raw.zones).map((zone) => beltZoneOf(zone, name))
		const total = zones.reduce((sum, zone) => sum + zone.share, 0)
		if (Math.abs(total - 1) > 1e-6) {
			throw new BuildError(`${name}: zone shares sum to ${total}, not 1`)
		}
		return [
			{
				id: slug(name),
				name,
				parentId: sunId,
				dots: Math.round(dots),
				color,
				members: { count, minDiameterKm },
				meanSeparationKm,
				extentKm: [extentMin, extentMax],
				zones,
			},
		]
	})
