/**
 * Zod schemas for src/data/bodies.json. This is the data model from docs/ARCHITECTURE.md;
 * the TypeScript types are inferred from the schemas, never declared twice.
 *
 * The build (`pnpm build:data`, scripts/build-bodies.ts) validates its output with
 * `BodiesFile` before writing; the app casts the JSON and src/data/bodies.test.ts
 * re-validates it, so module load stays cheap.
 */
import { z } from "zod"

/**
 * What a body is (#23 added the small bodies). Placement and drawing never depend on it
 * (the scale engine goes by depth in the hierarchy); it names the body, picks its group in
 * the focus picker, its label and marker tier and whether the "Small bodies" layer hides it.
 */
export const BodyKind = z.enum([
	"star",
	"planet",
	"dwarfPlanet",
	"moon",
	"asteroid",
	"comet",
])

/** Kinds shown only with the "Small bodies" layer (and their moons); see `isSmallBody` in "@/data". */
export const SMALL_BODY_KINDS: readonly BodyKind[] = [
	"dwarfPlanet",
	"asteroid",
	"comet",
]

export const Orbit = z.object({
	semiMajorAxisKm: z.number().positive(),
	eccentricity: z.number().min(0).lt(1),
	/**
	 * To the ecliptic. Moons with synthetic phases inside their planet's Laplace radius had the
	 * source's equator-relative inclination rotated into the ecliptic by the build (parent IAU pole).
	 */
	inclinationDeg: z.number(),
	longAscNodeDeg: z.number(),
	argPeriapsisDeg: z.number(),
	/** at epochJD */
	meanAnomalyDeg: z.number(),
	/** sidereal orbital period */
	periodDays: z.number().positive(),
	/** 2451545.0 (J2000) for all source data */
	epochJD: z.number(),
	/** true when node, periapsis and anomaly were all 0 in the source and were spread from hash(id) */
	phaseSynthetic: z.boolean().optional(),
	/**
	 * Secular drift of the orbit's orientation in degrees per day (the Moon: its node regresses
	 * once in 18.6 years, its perigee advances once in 8.85). `periodDays` stays the sidereal
	 * period of the mean longitude; see `orbitAt` in src/sim/kepler.ts.
	 */
	precession: z
		.object({
			nodeDegPerDay: z.number(),
			argPeriapsisDegPerDay: z.number(),
		})
		.optional(),
})

export const BodyTextures = z.object({
	base: z.string().min(1),
	topo: z.string().min(1).optional(),
	specular: z.string().min(1).optional(),
	clouds: z.string().min(1).optional(),
	night: z.string().min(1).optional(),
})

/**
 * Curated presentation hints beside the textures (#17): `tint`, an sRGB "#rrggbb" the colour
 * map is multiplied with, and `veiled`, an opaque haze hides the surface in visible light, so
 * only the tint is drawn. Since #37 every moon has its own map with its colours baked in, so
 * no moon uses either; they remain for bodies that need them. `color` (#37) is the map's mean
 * colour, drawn until the map has loaded (maps load only when the body is near, see
 * "Moon surfaces" in docs/ARCHITECTURE.md).
 */
export const Appearance = z.object({
	tint: z
		.string()
		.regex(/^#[0-9a-f]{6}$/)
		.optional(),
	veiled: z.literal(true).optional(),
	color: z
		.string()
		.regex(/^#[0-9a-f]{6}$/)
		.optional(),
})

/**
 * Where a moon's surface map comes from (#37, data/moon-surfaces.json): `map` is a real
 * spacecraft map, `painted` a surface painted from what is known (colour, brightness, the kind
 * of terrain) because no spacecraft has mapped the moon, `haze` Titan's haze as seen in visible
 * light. `filled`: part of a real map was never photographed and is filled in to match.
 * `source` is the id of its entry in src/data/credits.json. The Sun and the planets carry one
 * too (data/planet-textures.json): `painted` for cloud bands painted after spacecraft photos,
 * `haze` for Venus, whose clouds hide the ground.
 */
export const Surface = z.object({
	kind: z.enum(["map", "painted", "haze"]),
	source: z.string().min(1),
	filled: z.literal(true).optional(),
})

/**
 * One image source with its credit and licence (src/data/credits.json, built from
 * data/planet-textures.json and data/moon-surfaces.json). The help page (#43) lists these; `bodies` are the ids that show it.
 */
export const ImageCredit = z.object({
	id: z.string().min(1),
	kind: z.enum(["map", "painted"]),
	title: z.string().min(1),
	credit: z.string().min(1),
	short: z.string().min(1),
	url: z.string().min(1),
	licence: z.string().min(1),
	licenceUrl: z.string().min(1),
	note: z.string().min(1).optional(),
	bodies: z.array(z.string().min(1)).min(1),
})
export const CreditsFile = z.array(ImageCredit)

export const Rings = z
	.object({
		innerRadiusKm: z.number().positive(),
		outerRadiusKm: z.number().positive(),
		textures: z.object({
			alpha: z.string().min(1),
			color: z.string().min(1),
		}),
		/**
		 * false: the rings cast no shadow on their planet. For rings drawn far more opaque than
		 * they are (Jupiter's and Neptune's, optical depth 1e-6 to 0.1, exaggerated so they can be
		 * seen at all): their real shadow is invisible, and the exaggerated one would draw dark
		 * lines across the planet that are not there. Absent: they cast one (Saturn, Uranus).
		 */
		castsShadow: z.boolean().optional(),
	})
	.refine((rings) => rings.outerRadiusKm > rings.innerRadiusKm, {
		message: "outerRadiusKm must be larger than innerRadiusKm",
		path: ["outerRadiusKm"],
	})

/**
 * Spin: `periodHours` alone carries the direction (negative = retrograde), `axialTiltDeg` is the
 * obliquity to the body's own orbit measured to the IAU north pole (0..90). The Sun, the planets
 * and the Moon also carry the IAU 2015 north pole (ICRF right ascension / declination) and the
 * prime meridian angle W0 at J2000; see src/sim/rotation.ts for how they are used. `synchronous`
 * marks a tidally locked moon (its period then equals its orbital period).
 */
export const Rotation = z
	.object({
		periodHours: z.number().nullable(),
		axialTiltDeg: z.number().min(0).max(90),
		poleRaDeg: z.number().optional(),
		poleDecDeg: z.number().min(-90).max(90).optional(),
		primeMeridianDeg: z.number().optional(),
		/** tidally locked: the prime meridian faces the parent (src/sim/rotation.ts synchronousAngle) */
		synchronous: z.literal(true).optional(),
	})
	.refine(
		(rotation) =>
			(rotation.poleRaDeg === undefined) ===
			(rotation.poleDecDeg === undefined),
		{
			message: "poleRaDeg and poleDecDeg come together",
			path: ["poleDecDeg"],
		},
	)

/**
 * A comet's activity and tails (#23, #55), a presentation hint like `rings`, from what was
 * observed (the sources are in data/ourDB.json): it wakes up inside `onsetKm` from the Sun
 * and is fully active inside `fullKm`; its tails then reach the longest observed lengths
 * (true km; 0: a tail it does not grow, as Encke's dust tail or 67P's ion tail). `lagDays`:
 * its activity answers to where it was that many days earlier (more active after
 * perihelion); absent, 0. src/sim/comet.ts turns this into what is drawn.
 */
export const Tail = z
	.object({
		onsetKm: z.number().positive(),
		fullKm: z.number().positive(),
		ionLengthKm: z.number().nonnegative(),
		dustLengthKm: z.number().nonnegative(),
		lagDays: z.number().optional(),
	})
	.refine((tail) => tail.fullKm < tail.onsetKm, {
		message: "a comet is fully active closer to the Sun than it wakes up",
		path: ["fullKm"],
	})
	.refine((tail) => tail.ionLengthKm > 0 || tail.dustLengthKm > 0, {
		message: "a comet with a tail has at least one",
		path: ["ionLengthKm"],
	})

export const Body = z
	.object({
		/** unique slug: "sun", "earth", "moon", "io", "s2003j24" */
		id: z.string().regex(/^[a-z0-9]+$/),
		/** English display name */
		name: z.string().min(1),
		kind: BodyKind,
		/** null only for the Sun */
		parentId: z.string().nullable(),
		/** mean radius; derived from a diameter or a default when radiusEstimated is true */
		radiusKm: z.number().positive(),
		radiusEstimated: z.boolean().optional(),
		massKg: z.number().positive().nullable(),
		/** null only for the Sun */
		orbit: Orbit.nullable(),
		rotation: Rotation,
		textures: BodyTextures,
		appearance: Appearance.optional(),
		/** where the body's surface picture comes from (#37 for moons, data/planet-textures.json) */
		surface: Surface.optional(),
		rings: Rings.nullable(),
		tail: Tail.optional(),
		/** dictionary fields passed through from the source */
		info: z.record(z.string(), z.unknown()),
		/**
		 * A moon with a story (data/featured-moons.json, #17): shown by default. Every other moon is
		 * the long tail, drawn only while the viewer asks for all moons (docs/ARCHITECTURE.md, "Moons").
		 */
		featured: z.literal(true).optional(),
	})
	.superRefine((body, ctx) => {
		if ((body.kind === "star") !== (body.parentId === null)) {
			ctx.addIssue({
				code: "custom",
				message: "parentId must be null exactly for the star",
				path: ["parentId"],
			})
		}
		if ((body.kind === "star") !== (body.orbit === null)) {
			ctx.addIssue({
				code: "custom",
				message: "orbit must be null exactly for the star",
				path: ["orbit"],
			})
		}
		if (body.featured && body.kind !== "moon") {
			ctx.addIssue({
				code: "custom",
				message: "only moons are featured; every other body is always shown",
				path: ["featured"],
			})
		}
		if (body.kind !== "moon" && body.orbit?.phaseSynthetic) {
			ctx.addIssue({
				code: "custom",
				message:
					"bodies orbiting the Sun carry real elements, never synthetic phases",
				path: ["orbit", "phaseSynthetic"],
			})
		}
	})

/** The whole bodies.json: topological order, the star first, unique ids. */
export const BodiesFile = z.array(Body).superRefine((bodies, ctx) => {
	const seen = new Set<string>()
	bodies.forEach((body, index) => {
		if (seen.has(body.id)) {
			ctx.addIssue({
				code: "custom",
				message: `duplicate id "${body.id}"`,
				path: [index, "id"],
			})
		}
		if (body.parentId !== null && !seen.has(body.parentId)) {
			ctx.addIssue({
				code: "custom",
				message: `parent "${body.parentId}" must appear before "${body.id}"`,
				path: [index, "parentId"],
			})
		}
		seen.add(body.id)
	})
	const stars = bodies.filter((body) => body.kind === "star")
	if (stars.length !== 1 || bodies[0]?.kind !== "star") {
		ctx.addIssue({
			code: "custom",
			message: "exactly one star is expected and it must come first",
			path: [0, "kind"],
		})
	}
})

/** One zone of a belt: its dots are spread uniformly over these element ranges. */
export const BeltZone = z.object({
	/** share of the belt's dots, 0..1 (a belt's shares sum to 1) */
	share: z.number().positive().max(1),
	semiMajorAxisKm: z.tuple([z.number().positive(), z.number().positive()]),
	eccentricity: z.tuple([z.number().min(0), z.number().lt(1)]),
	/** inclinations are |normal(0, sigma)| */
	inclinationSigmaDeg: z.number().min(0),
	/** no orbit of the zone comes closer to the parent than this */
	perihelionMinKm: z.number().positive().optional(),
})

/**
 * A belt (#23): not bodies but a field of dots that shows where its members are. `dots` is
 * how many are drawn, `members` how many real bodies of at least `minDiameterKm` they stand for.
 */
export const Belt = z.object({
	id: z.string().regex(/^[a-z0-9]+$/),
	name: z.string().min(1),
	parentId: z.string(),
	dots: z.number().int().positive(),
	color: z.string().regex(/^#[0-9a-f]{6}$/),
	members: z.object({
		count: z.number().positive(),
		minDiameterKm: z.number().positive(),
	}),
	/** typical distance between neighbouring members (km) */
	meanSeparationKm: z.number().positive(),
	/** distances from the parent (km) a body counts as "in the belt" for the HUD */
	extentKm: z.tuple([z.number().positive(), z.number().positive()]),
	zones: z.array(BeltZone).min(1),
})

export const BeltsFile = z.array(Belt)

export type BodyKind = z.infer<typeof BodyKind>
export type Orbit = z.infer<typeof Orbit>
export type BodyTextures = z.infer<typeof BodyTextures>
export type Appearance = z.infer<typeof Appearance>
export type Surface = z.infer<typeof Surface>
export type ImageCredit = z.infer<typeof ImageCredit>
export type Rotation = z.infer<typeof Rotation>
export type Rings = z.infer<typeof Rings>
export type Body = z.infer<typeof Body>
export type BodiesFile = z.infer<typeof BodiesFile>
export type Tail = z.infer<typeof Tail>
export type BeltZone = z.infer<typeof BeltZone>
export type Belt = z.infer<typeof Belt>
