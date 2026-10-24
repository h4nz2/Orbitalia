import { describe, expect, it } from "vitest"

import {
	axisVector,
	cacheFileName,
	creaseNormals,
	longestSide,
	modelCredits,
	normaliseMatrix,
	paintBox,
	sharedPositionLocks,
	sizeProblem,
	transformPoint,
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
	it("keeps the download's extension", () => {
		expect(
			cacheFileName(
				"nasa3d-voyager",
				"https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/Voyager%20Probe%20%28B%29/Voyager%20Probe%20%28B%29.glb",
			),
		).toBe("nasa3d-voyager.glb")
		expect(cacheFileName("x", "https://example.org/a.b/file")).toBe("x")
	})
})

describe("modelCredits", () => {
	const source = (title: string) => ({
		title,
		credit: "NASA",
		short: "NASA",
		url: "https://example.org/",
		file: "https://example.org/model.glb",
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
})
