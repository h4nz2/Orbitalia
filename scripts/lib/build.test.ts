import { describe, expect, it } from "vitest"

import { BodiesFile } from "../../src/data/schema"
import type { Orbit } from "../../src/data/schema"
import type { Vec3 } from "../../src/sim/kepler"
import { eclipticDirection } from "../../src/sim/rotation"

import {
	BuildError,
	DEFAULT_MOON_RADIUS_KM,
	J2000,
	PLACEHOLDER_TEXTURE,
	buildBodies,
	ownsPlaceholderTexture,
	synchronousRotation,
	usesPlaceholderTexture,
} from "./build"
import type { BuildOptions } from "./build"
import { rotateElementsToEcliptic } from "./frames"
import { spreadPhases } from "./hash"
import { periodDaysFromKepler } from "./orbit"

const saturnMass = { massValue: 5.68336, massExponent: 26 }

const planet = (
	name: string,
	semimajorAxis: number,
	extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
	name,
	meanRadius: 58232,
	mass: saturnMass,
	semimajorAxis,
	eccentricity: 0.05,
	inclination: 1.5,
	longAscNode: 100,
	argPeriapsis: 200,
	mainAnomaly: 300,
	sideralOrbit: 4000,
	sideralRotation: 10,
	axialTilt: 20,
	rings: false,
	textures: { base: `/tex/${name.toLowerCase()}.jpg` },
	gravity: 9,
	avgTemp: 0,
	escape: 0,
	discoveredBy: "",
	bodyType: "Planet",
	...extra,
})

const fixture = {
	suns: [
		{
			name: "Sun",
			meanRadius: 695508,
			mass: { massValue: 1.989, massExponent: 30 },
			sideralRotation: 609.12,
			axialTilt: 7.25,
			textures: { base: "/tex/sun.png" },
			gravity: 274,
			composition: { majorElements: [{ abbr: "H", element: "Hydrogen" }] },
			bodyType: "Star",
		},
	],
	planets: [
		planet("Saturn", 1426666422, {
			rings: {
				innerRadius: 74510,
				outerRadius: 140220,
				textures: {
					base: "/tex/rings_alpha.png",
					colorMap: "/tex/rings_color.png",
				},
			},
			moons: [
				{
					name: "Rhéa",
					englishName: "Rhea",
					semimajorAxis: 527108,
					eccentricity: 0.001,
					inclination: 0.345,
					meanRadius: 0,
					sideralOrbit: 4.518,
					mainAnomaly: 0,
					argPeriapsis: 0,
					longAscNode: 0,
					mass: null,
					avgTemp: 0,
				},
				{
					name: "Titan",
					englishName: "Titan",
					semimajorAxis: 1221870,
					eccentricity: 0.0288,
					inclination: 0.34854,
					meanRadius: 2574.7,
					sideralOrbit: 15.945,
					sideralRotation: 382.8,
					mainAnomaly: 0,
					argPeriapsis: 0,
					longAscNode: 0,
					mass: { massValue: 1.3452, massExponent: 23 },
					discoveredBy: "Christiaan Huygens",
					avgTemp: 0,
					escape: 0,
				},
				{
					name: "S/2004 S 22",
					englishName: "S/2004 S 22",
					semimajorAxis: 20636000,
					eccentricity: 0.257,
					inclination: 177.4,
					meanRadius: 0,
					sideralOrbit: 0,
					mainAnomaly: 0,
					argPeriapsis: 0,
					longAscNode: 0,
				},
				{
					name: "Mercury",
					englishName: "Mercury",
					semimajorAxis: 100000,
					sideralOrbit: 1,
					mainAnomaly: 10,
					argPeriapsis: 0,
					longAscNode: 0,
					mass: { massValue: 1, massExponent: 10 },
					textures: { base: PLACEHOLDER_TEXTURE, topo: "/tex/rhea.jpg" },
				},
				{
					name: "Ghost",
					englishName: "Ghost",
					semimajorAxis: 0,
					sideralOrbit: 0,
				},
				{ ISS: { id: "6z", distanceFromParent: 400 } },
			],
			satellites: [
				{
					id: "6l",
					name: "Rhea",
					diameter: 1527.6,
					mass: "2.306518 * 10^21",
					distanceFromParent: 527040,
					orbitalPeriod: 4.5,
					orbitalInclination: 0.35,
					gravity: 0.264,
					surfaceTemps: { min: -220.15, max: null },
					textures: { base: "/tex/rhea.jpg", topo: null },
				},
				{
					id: "6v",
					name: "Hélène",
					diameter: 35.2,
					mass: "24.46 * 10^15",
					distanceFromParent: 377396,
					orbitalPeriod: "−2.74",
					orbitalInclination: 0.213,
					textures: { base: "/tex/missing.jpg" },
				},
				{
					id: "6x",
					name: "Hélène",
					diameter: 30,
					distanceFromParent: 1,
					orbitalPeriod: 1,
				},
			],
		}),
		// the export's double encoding of "retrograde": obliquity above 90 AND a negative period
		planet("Uranus", 2870658186, { sideralRotation: -17.24, axialTilt: 97.77 }),
		// obliquity above 90 alone: the spin is retrograde by the right-hand rule
		planet("Mercury", 57909050, { axialTilt: 120 }),
	],
}

const existing = new Set([
	"/tex/sun.png",
	"/tex/saturn.jpg",
	"/tex/uranus.jpg",
	"/tex/mercury.jpg",
	"/tex/rings_alpha.png",
	"/tex/rings_color.png",
	"/tex/rhea.jpg",
	"/tex/uranus_alpha.png",
	"/tex/uranus_color.png",
	PLACEHOLDER_TEXTURE,
])

const uranusRings = {
	innerRadiusKm: 41500,
	outerRadiusKm: 51500,
	textures: { alpha: "/tex/uranus_alpha.png", color: "/tex/uranus_color.png" },
}

const options: BuildOptions = {
	fileExists: (path) => existing.has(path),
	ringsFor: (planetId) => (planetId === "uranus" ? uranusRings : null),
}

const result = buildBodies(fixture, options)
const byId = new Map(result.bodies.map((body) => [body.id, body]))
const get = (id: string) => {
	const body = byId.get(id)
	if (!body) throw new Error(`missing ${id}`)
	return body
}
const orbitOf = (id: string): Orbit => {
	const orbit = get(id).orbit
	if (!orbit) throw new Error(`${id} has no orbit`)
	return orbit
}

const DEG = Math.PI / 180
/** Orbit normal in the ecliptic frame. */
const normalOf = (orbit: Orbit): Vec3 => {
	const i = orbit.inclinationDeg * DEG
	const node = orbit.longAscNodeDeg * DEG
	return {
		x: Math.sin(i) * Math.sin(node),
		y: -Math.sin(i) * Math.cos(node),
		z: Math.cos(i),
	}
}
const angleDeg = (a: Vec3, b: Vec3): number =>
	Math.acos(
		Math.min(
			1,
			(a.x * b.x + a.y * b.y + a.z * b.z) /
				(Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z)),
		),
	) / DEG
// the fixture's Saturn has the real Saturn's id, so it gets the real IAU pole
const SATURN_POLE = eclipticDirection(40.589, 83.537)

describe("buildBodies", () => {
	it("produces a schema-valid, topologically ordered list", () => {
		expect(BodiesFile.safeParse(result.bodies).success).toBe(true)
		expect(result.bodies.map((body) => body.id)).toEqual([
			"sun",
			"mercury",
			"saturn",
			"uranus",
			"mercurysaturn",
			"helene",
			"rhea",
			"titan",
			"s2004s22",
		])
	})

	it("maps the sun", () => {
		expect(get("sun")).toMatchObject({
			kind: "star",
			parentId: null,
			orbit: null,
			rings: null,
			radiusKm: 695508,
			massKg: 1.989e30,
			// the period from the IAU rate (14.1844 deg/day), not the source's rounded 609.12 h
			rotation: { periodHours: 609.119878176, axialTiltDeg: 7.25 },
			textures: { base: "/tex/sun.png" },
		})
		expect(get("sun").info).toEqual({
			gravity: 274,
			composition: { majorElements: [{ abbr: "H", element: "Hydrogen" }] },
			mass: { massValue: 1.989, massExponent: 30 },
			bodyType: "Star",
			axialTilt: 7.25,
		})
	})

	it("keeps real J2000 elements for planets and drops empty info fields", () => {
		const saturn = get("saturn")
		expect(saturn.orbit).toEqual({
			semiMajorAxisKm: 1426666422,
			eccentricity: 0.05,
			inclinationDeg: 1.5,
			longAscNodeDeg: 100,
			argPeriapsisDeg: 200,
			meanAnomalyDeg: 300,
			periodDays: 4000,
			epochJD: J2000,
		})
		expect(saturn.orbit?.phaseSynthetic).toBeUndefined()
		expect(saturn.radiusEstimated).toBeUndefined()
		expect(saturn.info).toEqual({
			gravity: 9,
			mass: saturnMass,
			bodyType: "Planet",
			axialTilt: 20,
		})
	})

	it("normalizes retrograde spin to a tilt below 90 and a negative period", () => {
		expect(get("uranus").rotation).toMatchObject({
			periodHours: -17.24,
			axialTiltDeg: 82.23,
		})
		// the tilt is normalized; an IAU body's period (and its sign) comes from the IAU rate
		expect(get("mercury").rotation).toMatchObject({
			periodHours: 1407.507501657,
			axialTiltDeg: 60,
		})
		expect(get("saturn").rotation).toMatchObject({
			periodHours: 10.656222222,
			axialTiltDeg: 20,
		})
		// the dictionary still sees the source value
		expect(get("uranus").info.axialTilt).toBe(97.77)
	})

	it("attaches the IAU pole and prime meridian by id, and nothing to other moons", () => {
		expect(get("sun").rotation).toEqual({
			periodHours: 609.119878176,
			axialTiltDeg: 7.25,
			poleRaDeg: 286.13,
			poleDecDeg: 63.87,
			primeMeridianDeg: 84.176,
		})
		expect(get("uranus").rotation).toEqual({
			periodHours: -17.24,
			axialTiltDeg: 82.23,
			poleRaDeg: 257.311,
			poleDecDeg: -15.175,
			primeMeridianDeg: 203.81,
		})
		expect(get("titan").rotation).toEqual({
			periodHours: 382.8,
			axialTiltDeg: 0,
			synchronous: true,
		})
	})

	it("maps source rings and external ring files", () => {
		expect(get("saturn").rings).toEqual({
			innerRadiusKm: 74510,
			outerRadiusKm: 140220,
			textures: {
				alpha: "/tex/rings_alpha.png",
				color: "/tex/rings_color.png",
			},
		})
		expect(get("uranus").rings).toEqual(uranusRings)
		expect(get("mercury").rings).toBeNull()
		expect(result.stats.rings).toBe(2)
	})

	it("merges the API and the curated entry of the same moon", () => {
		const rhea = get("rhea")
		expect(rhea.name).toBe("Rhea")
		expect(rhea.parentId).toBe("saturn")
		// orbit from the API entry, radius from the curated diameter, mass from the string
		expect(rhea.orbit).toMatchObject({
			semiMajorAxisKm: 527108,
			periodDays: 4.518,
			eccentricity: 0.001,
			phaseSynthetic: true,
		})
		// the API inclination 0.345 is to Saturn's equator: the orbit normal sits that far from the pole
		expect(angleDeg(normalOf(orbitOf("rhea")), SATURN_POLE)).toBeCloseTo(
			0.345,
			2,
		)
		expect(rhea.radiusKm).toBe(763.8)
		expect(rhea.radiusEstimated).toBe(true)
		expect(rhea.massKg).toBe(2.306518e21)
		expect(rhea.textures).toEqual({ base: "/tex/rhea.jpg" })
		expect(rhea.info).toEqual({
			gravity: 0.264,
			mass: "2.306518 * 10^21",
			surfaceTemps: { min: -220.15 },
			diameter: 1527.6,
			orbitalPeriod: 4.5,
			orbitalInclination: 0.35,
			// a regular moon without a spin period is assumed tidally locked
			rotationAssumed: true,
		})
		expect(rhea.rotation).toEqual({
			periodHours: 108.432,
			axialTiltDeg: 0,
			synchronous: true,
		})
		expect(result.bodies.filter((body) => body.name === "Rhea")).toHaveLength(1)
	})

	it("spreads synthetic phases from the id and keeps the rest of the API data", () => {
		const titan = get("titan")
		expect(titan.orbit).toMatchObject({
			// the mean anomaly does not depend on the reference plane
			meanAnomalyDeg: spreadPhases("titan").meanAnomalyDeg,
			phaseSynthetic: true,
			periodDays: 15.945,
		})
		expect(titan.radiusKm).toBe(2574.7)
		expect(titan.radiusEstimated).toBeUndefined()
		expect(titan.rotation).toEqual({
			periodHours: 382.8,
			axialTiltDeg: 0,
			synchronous: true,
		})
		expect(titan.textures).toEqual({ base: PLACEHOLDER_TEXTURE })
		expect(titan.info).toEqual({
			discoveredBy: "Christiaan Huygens",
			mass: { massValue: 1.3452, massExponent: 23 },
		})
	})

	it("rotates regular moons' equator-relative elements into the ecliptic", () => {
		// inside Saturn's Laplace radius (2.2e6 km): node and periapsis spread in the
		// equatorial frame, then all three angles rotated by Saturn's pole
		const expected = rotateElementsToEcliptic(
			{ inclinationDeg: 0.34854, ...spreadPhases("titan") },
			SATURN_POLE,
		)
		const titan = orbitOf("titan")
		expect(titan.inclinationDeg).toBeCloseTo(expected.inclinationDeg, 2)
		expect(titan.longAscNodeDeg).toBeCloseTo(expected.longAscNodeDeg, 2)
		expect(titan.argPeriapsisDeg).toBeCloseTo(expected.argPeriapsisDeg, 2)
		expect(titan.inclinationDeg).toBeGreaterThan(27.5)
		expect(titan.inclinationDeg).toBeLessThan(28.5)
		expect(angleDeg(normalOf(titan), SATURN_POLE)).toBeCloseTo(0.34854, 2)
		// curated-only moons too
		expect(angleDeg(normalOf(orbitOf("helene")), SATURN_POLE)).toBeCloseTo(
			0.213,
			2,
		)
		// outside the Laplace radius the source inclination is already ecliptic-relative
		expect(orbitOf("s2004s22")).toMatchObject({
			inclinationDeg: 177.4,
			...spreadPhases("s2004s22"),
		})
		// real (non-synthetic) phases are ecliptic by contract and untouched
		expect(orbitOf("mercurysaturn")).toMatchObject({
			inclinationDeg: 0,
			longAscNodeDeg: 0,
			argPeriapsisDeg: 0,
			meanAnomalyDeg: 10,
		})
		expect(result.stats.equatorRotated).toBe(3)
		for (const body of result.bodies) {
			const orbit = body.orbit
			if (!orbit) continue
			for (const key of [
				"inclinationDeg",
				"longAscNodeDeg",
				"argPeriapsisDeg",
			] as const) {
				expect(orbit[key], `${body.id}.${key}`).toBeGreaterThanOrEqual(0)
				expect(orbit[key], `${body.id}.${key}`).toBeLessThan(360)
				expect(Math.round(orbit[key] * 1000) / 1000).toBe(orbit[key])
			}
		}
	})

	it("does not synthesize phases when the source has any", () => {
		const moon = get("mercurysaturn")
		expect(moon.orbit).toMatchObject({
			meanAnomalyDeg: 10,
			argPeriapsisDeg: 0,
			longAscNodeDeg: 0,
		})
		expect(moon.orbit?.phaseSynthetic).toBeUndefined()
		expect(result.warnings).toContainEqual(
			expect.stringContaining("id collision"),
		)
	})

	it("derives a missing period from Kepler's third law and flags it", () => {
		const moon = get("s2004s22")
		const expected = periodDaysFromKepler(20636000, 5.68336e26)
		expect(moon.orbit?.periodDays).toBeCloseTo(expected, 3)
		expect(moon.info.periodDerived).toBe(true)
		expect(moon.radiusKm).toBe(DEFAULT_MOON_RADIUS_KM)
		expect(moon.radiusEstimated).toBe(true)
		expect(moon.massKg).toBeNull()
		expect(result.warnings).toContainEqual(
			expect.stringContaining("S/2004 S 22: no period in the source"),
		)
	})

	it("warns when a regular moon's period or a body's density contradicts physics", () => {
		// a = 100000 km around Saturn's mass gives 0.373 d, the source says 1 d
		expect(result.warnings).toContainEqual(
			expect.stringContaining(
				"Saturn/Mercury: period 1 d is 168 % longer than Kepler's third law gives (0.3734 d)",
			),
		)
		expect(
			result.warnings.filter((w) =>
				w.includes("than Kepler's third law gives"),
			),
		).toHaveLength(1)
		// 1e10 kg in a 5 km sphere
		expect(result.warnings).toContainEqual(
			expect.stringMatching(
				/^Saturn\/Mercury: mean density 0 kg\/m3 is implausible/,
			),
		)
		expect(
			result.warnings.filter((w) => w.includes("is implausible")),
		).toHaveLength(1)
	})

	it("drops the Moon's bump map from moons that only have the placeholder", () => {
		expect(get("mercurysaturn").textures).toEqual({ base: PLACEHOLDER_TEXTURE })
		expect(usesPlaceholderTexture(get("mercurysaturn"))).toBe(true)
		expect(usesPlaceholderTexture(get("rhea"))).toBe(false)
		// the placeholder is the Moon's own texture, so under Earth it is not a placeholder
		expect(ownsPlaceholderTexture("earth")).toBe(true)
		expect(ownsPlaceholderTexture("saturn")).toBe(false)
		expect(
			usesPlaceholderTexture({
				parentId: "earth",
				textures: { base: PLACEHOLDER_TEXTURE },
			}),
		).toBe(false)
	})

	it("builds curated-only moons from their hand-curated fields", () => {
		const helene = get("helene")
		expect(helene.name).toBe("Hélène")
		expect(helene.orbit).toMatchObject({
			semiMajorAxisKm: 377396,
			periodDays: 2.74,
			eccentricity: 0,
			phaseSynthetic: true,
		})
		expect(helene.radiusKm).toBe(17.6)
		expect(helene.massKg).toBe(2.446e16)
		expect(helene.textures).toEqual({ base: PLACEHOLDER_TEXTURE })
		expect(result.warnings).toContainEqual(
			expect.stringContaining('"Hélène" has no API partner'),
		)
		expect(result.warnings).toContainEqual(
			expect.stringContaining('duplicate satellites entry "Hélène"'),
		)
		expect(result.warnings).toContainEqual(
			expect.stringContaining('"/tex/missing.jpg" is missing'),
		)
	})

	it("skips bodies without a usable orbit and the ISS pseudo entry", () => {
		expect(byId.has("ghost")).toBe(false)
		expect(byId.has("iss")).toBe(false)
		expect(result.warnings).toContainEqual(
			expect.stringContaining("Ghost: skipped, no usable semi-major axis"),
		)
	})

	it("reports stats", () => {
		expect(result.stats).toEqual({
			total: 9,
			perKind: {
				star: 1,
				planet: 3,
				dwarfPlanet: 0,
				moon: 5,
				asteroid: 0,
				comet: 0,
			},
			moonsPerPlanet: { mercury: 0, saturn: 5, uranus: 0 },
			// rhea, helene, s2004s22 and the collision moon have no mean radius / no texture
			radiusEstimated: 4,
			phaseSynthetic: 4,
			equatorRotated: 3,
			periodDerived: 1,
			placeholderTextures: 4,
			rings: 2,
			smallBodiesSkipped: 0,
			featured: 0,
		})
	})

	it("passes a moon's curated tint and veil through as its appearance (#17)", () => {
		const tinted = structuredClone(fixture) as typeof fixture
		const raw = JSON.stringify(tinted).replace(
			'"name":"Rhea"',
			'"name":"Rhea","tint":"#D9A04E","veiled":true',
		)
		const built = buildBodies(JSON.parse(raw), options)
		expect(built.bodies.find((body) => body.id === "rhea")?.appearance).toEqual(
			{ tint: "#d9a04e", veiled: true },
		)
		expect(BodiesFile.safeParse(built.bodies).success).toBe(true)
		// nothing curated: no appearance key at all
		expect(result.bodies.some((body) => "appearance" in body)).toBe(false)
		const bad = buildBodies(
			JSON.parse(raw.replace('"#D9A04E"', '"orange"')),
			options,
		)
		expect(bad.bodies.find((body) => body.id === "rhea")?.appearance).toEqual({
			veiled: true,
		})
		expect(bad.warnings.some((w) => /tint "orange"/.test(w))).toBe(true)
	})

	describe("moon surfaces (#37)", () => {
		const moonIds = result.bodies
			.filter((body) => body.kind === "moon")
			.map((body) => body.id)
		const [mapped, ...painted] = moonIds
		const paintedSource = {
			title: "Painted",
			credit: "Orbitalia",
			short: "Painted by Orbitalia",
			url: "https://example.org/",
			licence: "MIT",
			licenceUrl: "https://example.org/licence",
		}
		const catalogue = (members: string[] = painted) => ({
			sources: {
				"orbitalia-painted": paintedSource,
				cassini: {
					...paintedSource,
					title: "Cassini map",
					licence: "Public domain",
					file: "https://example.org/map.tif",
				},
				unused: { ...paintedSource, title: "Unused" },
			},
			maps: {
				[mapped]: {
					planet: "saturn",
					source: "cassini",
					width: 1024,
					centreLonEast: 180,
					albedo: 0.9,
					hue: "#eeeeee",
					fill: true,
					unseen: true,
				},
			},
			painted: {},
			families: {
				rocks: {
					planet: "saturn",
					members,
					recipe: { pattern: "cratered", albedo: 0.05, hue: "#888888" },
					basis: "dark rocks",
				},
			},
		})
		const surfaceFiles = new Set(
			moonIds.map((id) => `/assets/textures/saturn/satellites/${id}.jpg`),
		)
		const withSurfaces = {
			...options,
			fileExists: (path: string) =>
				existing.has(path) || surfaceFiles.has(path),
			surfaces: catalogue(),
			builtSurfaces: { [mapped]: { color: "#dddddd", width: 1024, bytes: 1 } },
		}

		it("gives every moon its own map, source and mean colour, and credits the sources", () => {
			const built = buildBodies(fixture, withSurfaces)
			const moon = built.bodies.find((body) => body.id === mapped)
			expect(moon?.textures).toEqual({
				base: `/assets/textures/saturn/satellites/${mapped}.jpg`,
			})
			expect(moon?.surface).toEqual({
				kind: "map",
				source: "cassini",
				filled: true,
			})
			expect(moon?.appearance).toEqual({ color: "#dddddd" })
			const rock = built.bodies.find((body) => body.id === painted[0])
			expect(rock?.surface).toEqual({
				kind: "painted",
				source: "orbitalia-painted",
			})
			expect(built.stats.placeholderTextures).toBe(0)
			expect(built.credits.map((credit) => credit.id)).toEqual([
				"orbitalia-painted",
				"cassini",
			])
			expect(built.credits[0].bodies).toEqual(painted)
			expect(BodiesFile.safeParse(built.bodies).success).toBe(true)
		})

		it("stops the build on a moon without a surface, an unknown moon or a missing image", () => {
			expect(() =>
				buildBodies(fixture, {
					...withSurfaces,
					surfaces: catalogue(painted.slice(1)),
				}),
			).toThrow(/has no surface/)
			expect(() =>
				buildBodies(fixture, {
					...withSurfaces,
					surfaces: catalogue([...painted, "ymir"]),
				}),
			).toThrow(/"ymir", which is not a moon/)
			expect(() =>
				buildBodies(fixture, {
					...withSurfaces,
					fileExists: (path: string) => existing.has(path),
				}),
			).toThrow(/run pnpm gen:surfaces/)
		})
	})

	describe("featured moons (#17)", () => {
		it("flags the listed moons and nothing else", () => {
			const built = buildBodies(fixture, {
				...options,
				featuredMoons: {
					$comment: "ignored",
					saturn: { rhea: "an icy world" },
				},
			})
			const featured = built.bodies.filter((body) => body.featured)
			expect(featured.map((body) => body.id)).toEqual(["rhea"])
			expect(built.stats.featured).toBe(1)
			// no list, no featured moons
			expect(result.bodies.some((body) => body.featured)).toBe(false)
		})

		it("stops the build on an unknown moon or the wrong planet", () => {
			expect(() =>
				buildBodies(fixture, {
					...options,
					featuredMoons: { saturn: { ymir: "not in the fixture" } },
				}),
			).toThrow(/featured moon "ymir" is not a moon/)
			expect(() =>
				buildBodies(fixture, {
					...options,
					featuredMoons: { uranus: { rhea: "wrong planet" } },
				}),
			).toThrow(/orbits "saturn", not "uranus"/)
			expect(() =>
				buildBodies(fixture, {
					...options,
					featuredMoons: { saturn: { rhea: "" } },
				}),
			).toThrow(BuildError)
		})
	})

	it("passes a ring file's castsShadow through, and only when it is set", () => {
		const shadowless = buildBodies(fixture, {
			...options,
			ringsFor: (planetId) =>
				planetId === "uranus" ? { ...uranusRings, castsShadow: false } : null,
		})
		expect(
			shadowless.bodies.find((body) => body.id === "uranus")?.rings,
		).toEqual({ ...uranusRings, castsShadow: false })
		expect(get("uranus").rings).not.toHaveProperty("castsShadow")
	})

	it("warns when a ringed planet has no ring file", () => {
		const without = buildBodies(fixture, { ...options, ringsFor: () => null })
		expect(
			without.bodies.find((body) => body.id === "uranus")?.rings,
		).toBeNull()
		expect(without.warnings).toContainEqual(
			expect.stringContaining("uranus: no ring data"),
		)
	})

	it("keeps moon planes ecliptic-relative when the planet has no IAU pole or J2", () => {
		const renamed = {
			...fixture,
			planets: [
				{ ...fixture.planets[0], name: "Kronos" },
				...fixture.planets.slice(1),
			],
		}
		const built = buildBodies(renamed, options)
		const titan = built.bodies.find((body) => body.id === "titan")?.orbit
		expect(titan).toMatchObject({
			inclinationDeg: 0.34854,
			...spreadPhases("titan"),
		})
		expect(built.stats.equatorRotated).toBe(0)
		expect(built.warnings).toContainEqual(
			expect.stringContaining("Kronos: no IAU pole"),
		)
		expect(built.warnings).toContainEqual(
			expect.stringContaining("Kronos: no J2 or mass"),
		)
	})

	it("fails the build for a planet or sun texture that does not exist", () => {
		const broken = {
			...fixture,
			planets: [
				planet("Venus", 108208475, { textures: { base: "/tex/nope.jpg" } }),
			],
		}
		expect(() => buildBodies(broken, options)).toThrow(BuildError)
		expect(() => buildBodies(broken, options)).toThrow(/Venus: texture base/)
		expect(() =>
			buildBodies(fixture, {
				...options,
				ringsFor: () => ({ innerRadiusKm: 1, outerRadiusKm: 2, textures: {} }),
			}),
		).toThrow(/invalid data\/rings\/uranus.json/)
	})
})

describe("synchronousRotation", () => {
	const spin = (periodHours: number | null) => ({
		periodHours,
		axialTiltDeg: 0,
	})

	it("marks a moon whose spin period matches its orbit as locked", () => {
		// Io: 42.4593 h spin, 1.76914 d orbit
		expect(synchronousRotation(spin(42.4593), 1.76914, true, false)).toEqual({
			rotation: { periodHours: 42.4593, axialTiltDeg: 0, synchronous: true },
			assumed: false,
		})
	})

	it("keeps a measured spin that is not synchronous, regular or not", () => {
		// Himalia: 7.78 h spin, 250 d orbit
		expect(synchronousRotation(spin(7.7808), 250.56, false, false)).toEqual({
			rotation: spin(7.7808),
			assumed: false,
		})
		expect(synchronousRotation(spin(10), 1.5, true, false).rotation).toEqual(
			spin(10),
		)
	})

	it("assumes a regular moon without a period is locked, with its orbital period", () => {
		expect(synchronousRotation(spin(null), 1.2624, true, false)).toEqual({
			rotation: { periodHours: 30.2976, axialTiltDeg: 0, synchronous: true },
			assumed: true,
		})
	})

	it("leaves irregular and chaotic moons without a period still", () => {
		expect(synchronousRotation(spin(null), 700, false, false)).toEqual({
			rotation: spin(null),
			assumed: false,
		})
		expect(synchronousRotation(spin(null), 21.276, true, true)).toEqual({
			rotation: spin(null),
			assumed: false,
		})
	})
})
