import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

import type { Body, ImageCredit } from "../../src/data/schema"

import {
	applyPlanetTextures,
	resolveTextures,
	surfaceKind,
	type TextureCatalogue,
	type TextureEntry,
} from "./planetTextures"
import { resolveSurfaces, surfacePath } from "./surfaces"

const root = join(__dirname, "..", "..")
const readJson = (...path: string[]): unknown =>
	JSON.parse(readFileSync(join(root, ...path), "utf8"))
const real = readJson("data", "planet-textures.json") as TextureCatalogue
const moons = resolveSurfaces(readJson("data", "moon-surfaces.json"))

const source = (extra: Record<string, unknown> = {}) => ({
	title: "t",
	credit: "c",
	short: "s",
	url: "https://example.org/",
	licence: "Public domain",
	licenceUrl: "https://example.org/licence",
	...extra,
})

const body = (id: string, kind: Body["kind"], base: string): Body =>
	({
		id,
		name: id,
		kind,
		parentId: kind === "star" ? null : "sun",
		radiusKm: 1,
		radiusEstimated: false,
		massKg: null,
		orbit: null,
		rotation: { periodHours: 1, axialTiltDeg: 0 },
		textures: { base },
		rings: null,
		info: {},
	}) as Body

const moonCatalogue = {
	sources: { "orbitalia-painted": source({ licence: "MIT" }) },
	maps: {},
	painted: {},
	families: {},
}

const catalogue = {
	sources: {
		sdo: source({ file: "https://example.org/sun.fits" }),
		bands: source({ licence: "MIT" }),
	},
	textures: {
		"/assets/textures/sun/sun.jpg": {
			source: "sdo",
			width: 2048,
			map: { format: "fits", centreLonEast: 0, hue: "#ffcc66", level: 0.7 },
		},
		"/assets/textures/saturn/saturn.jpg": {
			source: "bands",
			width: 2048,
			painted: {
				bands: {
					bands: [
						[90, "#ffffff"],
						[-90, "#000000"],
					],
					turbulence: 0,
				},
			},
			basis: "photos",
		},
		"/assets/textures/venus/venus.jpg": {
			source: "bands",
			width: 1024,
			veiled: true,
			painted: {
				bands: {
					bands: [
						[90, "#ffffff"],
						[-90, "#eeeeee"],
					],
					turbulence: 0,
				},
			},
			basis: "clouds",
		},
		"/assets/textures/asteroid.jpg": {
			source: "orbitalia-painted",
			width: 512,
			for: "small bodies",
			painted: {
				recipe: { pattern: "cratered", albedo: 0.1, hue: "#888888" },
			},
			basis: "rock",
		},
	},
}

const moonCredit: ImageCredit = {
	id: "orbitalia-painted",
	kind: "painted",
	title: "Painted",
	credit: "c",
	short: "s",
	url: "https://example.org/",
	licence: "MIT",
	licenceUrl: "https://example.org/",
	bodies: ["leda"],
}

describe("applyPlanetTextures", () => {
	const bodies = () => [
		body("sun", "star", "/assets/textures/sun/sun.jpg"),
		body("venus", "planet", "/assets/textures/venus/venus.jpg"),
		body("saturn", "planet", "/assets/textures/saturn/saturn.jpg"),
		body(
			"ceres",
			"dwarfPlanet" as Body["kind"],
			"/assets/textures/asteroid.jpg",
		),
	]

	it("gives the Sun and the planets their surface and credits them first", () => {
		const list = bodies()
		const credits = applyPlanetTextures(list, catalogue, moonCatalogue, [
			moonCredit,
		])
		expect(list[0].surface).toEqual({ kind: "map", source: "sdo" })
		expect(list[1].surface).toEqual({ kind: "haze", source: "bands" })
		expect(list[2].surface).toEqual({ kind: "painted", source: "bands" })
		expect(list[3].surface).toBeUndefined()
		expect(credits.map((c) => [c.id, c.bodies])).toEqual([
			["sdo", ["sun"]],
			["bands", ["venus", "saturn"]],
			// a moon source a texture also uses keeps its place and lists both
			["orbitalia-painted", ["ceres", "leda"]],
		])
	})

	it("stops on a Sun or planet texture that is not in the catalogue", () => {
		const list = [body("mars", "planet", "/assets/textures/mars/mars.jpg")]
		expect(() =>
			applyPlanetTextures(list, catalogue, moonCatalogue, []),
		).toThrow(/not in data\/planet-textures.json/)
	})

	it("rejects an unknown source and a map that is neither kept, coloured nor a mask", () => {
		expect(() =>
			resolveTextures({
				...catalogue,
				textures: {
					"/assets/textures/x.jpg": {
						...catalogue.textures["/assets/textures/saturn/saturn.jpg"],
						source: "nobody",
					},
				},
			}),
		).toThrow(/unknown source "nobody"/)
		expect(() =>
			resolveTextures({
				...catalogue,
				textures: {
					"/assets/textures/x.jpg": {
						source: "sdo",
						width: 1024,
						map: { centreLonEast: 0 },
					},
				},
			}),
		).toThrow(/kept \(keep\), coloured \(hue\) or a mask/)
	})
})

describe("data/planet-textures.json", () => {
	const resolved = resolveTextures(real, moons.catalogue.sources)
	const entries = Object.entries(resolved.textures) as [string, TextureEntry][]
	const sources = { ...moons.catalogue.sources, ...resolved.sources }

	it("uses only redistributable licences and says where every map comes from", () => {
		for (const [path, entry] of entries) {
			const s = sources[entry.source]
			expect(["Public domain", "MIT"], path).toContain(s.licence)
			if (entry.map !== undefined) expect(s.file, path).toBeDefined()
			if (entry.painted !== undefined) expect(entry.basis, path).toBeDefined()
		}
	})

	it("has every texture on disk, within the download budget", () => {
		let total = 0
		for (const [path] of entries) {
			const bytes = statSync(join(root, "public", path)).size
			expect(bytes, path).toBeLessThan(900_000)
			total += bytes
		}
		expect(total).toBeLessThan(6_000_000)
	})

	it("paints only what has no open map, and says so on the card", () => {
		const painted = entries
			.filter(
				([, entry]) => entry.painted !== undefined && entry.for === undefined,
			)
			.map(([path, entry]) => [path, surfaceKind(entry)])
		expect(painted).toEqual([
			["/assets/textures/venus/venus.jpg", "haze"],
			["/assets/textures/saturn/saturn.jpg", "painted"],
			["/assets/textures/uranus/uranus.jpg", "painted"],
			["/assets/textures/neptune/neptune.jpg", "painted"],
		])
	})
})

describe("every image the app ships says where it comes from", () => {
	const walk = (dir: string): string[] =>
		readdirSync(dir).flatMap((name) => {
			const path = join(dir, name)
			return statSync(path).isDirectory() ? walk(path) : [path]
		})

	it("is a moon surface, a ring strip, or in data/planet-textures.json", () => {
		const known = new Set<string>(Object.keys(real.textures))
		for (const surface of moons.byId.values()) {
			known.add(surfacePath(surface.planet, surface.id))
		}
		const ringsDir = join(root, "data", "rings")
		for (const file of readdirSync(ringsDir)) {
			const rings = readJson("data", "rings", file) as {
				textures: Record<string, string>
			}
			for (const path of Object.values(rings.textures)) known.add(path)
		}
		const shipped = walk(join(root, "public", "assets", "textures")).map(
			(file) =>
				`/${relative(join(root, "public"), file).split("\\").join("/")}`,
		)
		expect(shipped.filter((path) => !known.has(path))).toEqual([])
	})
})
