import { describe, expect, it } from "vitest"

import { createHash } from "node:crypto"

import {
	axisVector,
	cacheFileName,
	craftModelRanges,
	creaseNormals,
	longestSide,
	modelCredits,
	normaliseMatrix,
	paintBox,
	parseOnly,
	sharedPositionLocks,
	sizeProblem,
	transformPoint,
	verifySource,
	type Mat4,
	type Vec3,
} from "./spacecraftModels"

const close = (a: readonly number[], b: readonly number[]) =>
	a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9))

/** The determinant of the upper 3x3 of a column-major 4x4. */
const det3 = (m: Mat4): number =>
	m[0] * (m[5] * m[10] - m[9] * m[6]) -
	m[4] * (m[1] * m[10] - m[9] * m[2]) +
	m[8] * (m[1] * m[6] - m[5] * m[2])

describe("normaliseMatrix", () => {
	it("reads source axes", () => {
		expect(axisVector("+y")).toEqual([0, 1, 0])
		expect(axisVector("-z")).toEqual([0, 0, -1])
	})

	it("moves the bus centre to the origin and turns the chosen axes into +Z and +Y", () => {
		// Voyager-like: the dish opens towards source +y, the magnetometer boom reaches to +z
		const m = normaliseMatrix({ z: "+y", y: "+z", centre: [1, 2, 3], scale: 2 })
		close(transformPoint(m, [1, 2, 3]), [0, 0, 0])
		// one source unit along +y (the boresight) is 2 m along +Z
		close(transformPoint(m, [1, 3, 3]), [0, 0, 2])
		close(transformPoint(m, [1, 2, 4]), [0, 2, 0])
		// +X completes a right-handed frame (Y x Z): here source -x
		close(transformPoint(m, [2, 2, 3]), [-2, 0, 0])
	})

	it("never mirrors, so no triangle turns inside out", () => {
		const axes = ["+x", "-x", "+y", "-y", "+z", "-z"] as const
		for (const z of axes) {
			for (const y of axes) {
				if (z[1] === y[1]) continue
				expect(
					det3(normaliseMatrix({ z, y, centre: [0, 0, 0], scale: 1 })),
				).toBeCloseTo(1, 12)
			}
		}
	})

	it("refuses two axes along the same line", () => {
		expect(() =>
			normaliseMatrix({ z: "+y", y: "-y", centre: [0, 0, 0], scale: 1 }),
		).toThrow()
	})
})

describe("sizeProblem", () => {
	const bounds = { min: [-1, -2, -8] as Vec3, max: [1, 2, 8] as Vec3 }

	it("measures the longest side", () => {
		expect(longestSide(bounds)).toBe(16)
	})

	it("accepts a model within 5 % of the craft's size and names a wrong one", () => {
		expect(sizeProblem(bounds, 16.5)).toBeNull()
		expect(sizeProblem(bounds, 13)).toMatch(/16.00 m.*13 m/)
		// a model left in centimetres
		expect(
			sizeProblem({ min: [0, 0, 0], max: [1600, 0, 0] }, 16),
		).not.toBeNull()
	})
})

describe("creaseNormals", () => {
	// a unit cube's 8 corners, each shared by the 12 triangles round it (outward winding)
	const cube = {
		positions: Float32Array.from([
			0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
		]),
		indices: Uint32Array.from([
			0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1,
			2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3,
		]),
	}

	it("splits a corner once per face that meets it at a hard edge", () => {
		const creased = creaseNormals(cube.positions, cube.indices, 35)
		// 6 faces x 4 corners
		expect(creased.source.length).toBe(24)
		expect(creased.indices.length).toBe(36)
		// every normal is a face's: one axis, unit length, pointing out of the cube
		for (let v = 0; v < creased.source.length; v++) {
			const n = Array.from(creased.normals.slice(3 * v, 3 * v + 3))
			expect(n.filter((c) => Math.abs(c) > 1e-9)).toHaveLength(1)
			const axis = n.findIndex((c) => Math.abs(c) > 1e-9)
			const corner = cube.positions[3 * creased.source[v] + axis]
			expect(Math.sign(n[axis])).toBe(corner === 1 ? 1 : -1)
		}
	})

	it("keeps a corner smooth where the faces meet within the crease angle", () => {
		// two triangles folded by 10 degrees along the edge 0-1
		const fold = Math.tan((10 * Math.PI) / 180)
		const positions = Float32Array.from([
			0,
			0,
			0,
			1,
			0,
			0,
			0.5,
			1,
			0,
			0.5,
			-1,
			fold,
		])
		const indices = Uint32Array.from([0, 1, 2, 1, 0, 3])
		const creased = creaseNormals(positions, indices, 35)
		expect(creased.source.length).toBe(4)
		// one hard edge at 120 degrees: split again
		const sharp = creaseNormals(positions, indices, 5)
		expect(sharp.source.length).toBe(6)
	})

	it("gathers faces by position, so a texture seam does not show in the shading", () => {
		// the same fold, with vertex 1 split in two (as along a texture seam): 4 and 1 coincide
		const fold = Math.tan((10 * Math.PI) / 180)
		const positions = Float32Array.from([
			0,
			0,
			0,
			1,
			0,
			0,
			0.5,
			1,
			0,
			0.5,
			-1,
			fold,
			1,
			0,
			0,
		])
		const indices = Uint32Array.from([0, 1, 2, 4, 0, 3])
		const creased = creaseNormals(positions, indices, 35)
		const normalOf = (vertex: number) => {
			const out =
				creased.indices[
					creased.indices.findIndex((_, i) => indices[i] === vertex)
				]
			return Array.from(creased.normals.slice(3 * out, 3 * out + 3))
		}
		close(normalOf(1), normalOf(4))
	})
})

describe("sharedPositionLocks", () => {
	it("locks the vertices two parts share and nothing else", () => {
		const a = Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0])
		const b = Float32Array.from([1, 0, 0, 2, 0, 0, 1, 1, 0])
		const c = Float32Array.from([5, 5, 5, 5, 5, 5])
		const [la, lb, lc] = sharedPositionLocks([a, b, c])
		expect(Array.from(la)).toEqual([0, 1, 1])
		expect(Array.from(lb)).toEqual([1, 0, 1])
		// a position twice in one part is not shared
		expect(Array.from(lc)).toEqual([0, 0])
	})
})

describe("paintBox", () => {
	it("paints the box in the mean colour of the ring round it", () => {
		const width = 8
		const height = 8
		// a grey picture with a red "logo" in the middle
		const data = new Uint8Array(width * height * 3).fill(100)
		for (let y = 3; y < 5; y++) {
			for (let x = 3; x < 5; x++) data.set([255, 0, 0], (y * width + x) * 3)
		}
		paintBox(data, width, height, 3, [3, 3, 5, 5])
		expect(new Set(data)).toEqual(new Set([100]))
	})

	it("refuses a box outside the picture", () => {
		const data = new Uint8Array(4 * 4 * 4)
		expect(() => paintBox(data, 4, 4, 4, [2, 2, 6, 3])).toThrow(/not inside/)
		expect(() => paintBox(data, 4, 4, 4, [2, 2, 2, 3])).toThrow(/not inside/)
	})
})

describe("cacheFileName", () => {
	const sha = "ab".repeat(32)

	it("names the source and its hash, and keeps the download's extension", () => {
		expect(
			cacheFileName(
				"nasa3d-voyager",
				"https://raw.githubusercontent.com/nasa/NASA-3D-Resources/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/Voyager%20Probe%20%28B%29/Voyager%20Probe%20%28B%29.glb",
				sha,
			),
		).toBe(`nasa3d-voyager-${sha}.glb`)
		expect(cacheFileName("x", "https://example.org/a.b/file", sha)).toBe(
			`x-${sha}`,
		)
	})

	it("gives a new hash a new file, so a changed source is downloaded again", () => {
		const url = "https://example.org/model.glb"
		expect(cacheFileName("x", url, sha)).not.toBe(
			cacheFileName("x", url, "cd".repeat(32)),
		)
	})
})

describe("verifySource", () => {
	const bytes = new TextEncoder().encode("a model")
	const sha = createHash("sha256").update(bytes).digest("hex")

	it("passes the pinned bytes", () => {
		expect(() => verifySource("x", bytes, sha, "the cache")).not.toThrow()
	})

	it("stops on any other bytes, naming the source and where they came from", () => {
		const changed = new TextEncoder().encode("a model!")
		expect(() =>
			verifySource("nasa3d-juno", changed, sha, "the cache"),
		).toThrow(
			new RegExp(
				`source "nasa3d-juno": the cache has SHA-256 [0-9a-f]{64}, .* expects ${sha}`,
			),
		)
	})
})

describe("parseOnly", () => {
	const ids = ["voyager", "juno", "cassini-no-huygens"]

	it("makes every model without --only, and the named ones with it", () => {
		expect(parseOnly([], ids)).toEqual({ ids: null })
		expect(parseOnly(["--", "--only", "juno,voyager"], ids)).toEqual({
			ids: new Set(["juno", "voyager"]),
		})
	})

	it("stops on --only without ids, an unknown id or an unknown argument", () => {
		for (const args of [
			["--only"],
			["--only", ""],
			["--only", "--only", "juno"],
		]) {
			expect(parseOnly(args, ids), args.join(" ")).toEqual({
				problem: expect.stringMatching(/--only needs model ids.*voyager, juno/),
			})
		}
		expect(parseOnly(["--only", "juno,vojager"], ids)).toEqual({
			problem: expect.stringMatching(/no model "vojager"/),
		})
		expect(parseOnly(["--onyl", "juno"], ids)).toEqual({
			problem: expect.stringMatching(/unknown argument "--onyl"/),
		})
	})
})

describe("modelCredits", () => {
	const source = (title: string) => ({
		title,
		credit: "NASA",
		short: "NASA",
		url: "https://example.org/",
		file: "https://example.org/model.glb",
		sha256: "0".repeat(64),
		licence: "Public domain",
		licenceUrl: "https://example.org/licence",
	})
	const model = (sourceId: string) => ({
		source: sourceId,
		normalise: { z: "+y", y: "+z", centre: [0, 0, 0], scale: 1 },
		textureSize: 512,
		simplify: 0.002,
		axes: { z: "the dish", y: "the boom" },
		points: "earth",
		sizeM: 10,
		size: { note: "10 m", url: "https://example.org/size" },
		note: "nothing special",
	})
	const catalogue = {
		sources: { a: source("A"), unused: source("U"), b: source("B") },
		models: {
			"model-a": model("a"),
			"model-b": model("b"),
			"model-b2": model("b"),
		},
		craft: {
			one: [{ model: "model-b" }],
			two: [
				{ model: "model-a", until: "2004-12-25T02:00Z" },
				{ model: "model-b2", from: "2004-12-25T02:00Z" },
			],
		},
	}

	it("credits every source in use with the craft that wear it, in the catalogue's order", () => {
		const credits = modelCredits(catalogue, () => true)
		expect(
			credits.map((credit) => [credit.id, credit.kind, credit.bodies]),
		).toEqual([
			["a", "model", ["two"]],
			["b", "model", ["one", "two"]],
		])
		expect(credits[0]).toMatchObject({ title: "A", licence: "Public domain" })
	})

	it("stops on a missing file or a malformed catalogue", () => {
		expect(() =>
			modelCredits(catalogue, (path) => !path.endsWith("model-b2.glb")),
		).toThrow(/model-b2.glb is missing.*gen:models/)
		expect(() =>
			modelCredits(
				{ ...catalogue, craft: { one: [{ model: "nope" }] } },
				() => true,
			),
		).toThrow(/unknown model "nope"/)
		expect(() =>
			modelCredits(
				{
					...catalogue,
					craft: {
						two: [
							{ model: "model-a", until: "2004-12-25T02:00Z" },
							{ model: "model-b" },
						],
					},
				},
				() => true,
			),
		).toThrow(/end where the next begins/)
	})

	it("gives the app which model each craft wears when, and nothing else", () => {
		const spun = {
			...catalogue,
			models: {
				...catalogue.models,
				"model-a": {
					...model("a"),
					spinRpm: 2,
					spin: { note: "2 rpm", url: "https://example.org/spin" },
				},
			},
		}
		expect(craftModelRanges(spun)).toEqual({
			one: [
				{
					id: "model-b",
					file: "assets/models/spacecraft/model-b.glb",
					sizeM: 10,
					points: "earth",
				},
			],
			two: [
				{
					id: "model-a",
					file: "assets/models/spacecraft/model-a.glb",
					sizeM: 10,
					points: "earth",
					spinRpm: 2,
					until: "2004-12-25T02:00Z",
				},
				{
					id: "model-b2",
					file: "assets/models/spacecraft/model-b2.glb",
					sizeM: 10,
					points: "earth",
					from: "2004-12-25T02:00Z",
				},
			],
		})
		expect(() =>
			craftModelRanges({ ...catalogue, craft: { one: [{ model: "nope" }] } }),
		).toThrow(/unknown model "nope"/)
	})
})
