/**
 * The pure parts of `pnpm gen:models` (scripts/gen-spacecraft-models.ts, #72) and of the models'
 * credits in `pnpm build:data`: the matrix that normalises a source model, rebuilt normals, the
 * simplifier's locks, the patch over an insignia, the size check. See docs/ARCHITECTURE.md,
 * "Spacecraft", Models.
 */
import type { ImageCredit } from "../../src/data/schema"
import {
	SPACECRAFT_MODEL_DIR,
	SpacecraftModelsFile,
	type SourceAxis,
	type SpacecraftModel,
} from "../../src/data/spacecraftModelsSchema"

export type Vec3 = [number, number, number]
/** A 4x4 matrix, column-major (glTF's order). */
export type Mat4 = [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
]

/** "+y" -> [0, 1, 0], "-z" -> [0, 0, -1]. */
export const axisVector = (axis: SourceAxis): Vec3 => {
	const sign = axis[0] === "-" ? -1 : 1
	const index = "xyz".indexOf(axis[1])
	const out: Vec3 = [0, 0, 0]
	out[index] = sign
	return out
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
]

/**
 * The matrix that takes a source point to the normalised model: moved so the bus centre is the
 * origin, scaled to metres, and turned so the source axis `z` is +Z and `y` is +Y (+X = Y x Z,
 * so the frame stays right-handed and no triangle turns inside out).
 */
export const normaliseMatrix = (
	normalise: SpacecraftModel["normalise"],
): Mat4 => {
	const z = axisVector(normalise.z)
	const y = axisVector(normalise.y)
	if (z.every((v, i) => Math.abs(v) === Math.abs(y[i]))) {
		throw new Error("+Z and +Y must come from different source axes")
	}
	const x = cross(y, z)
	const s = normalise.scale
	const c = normalise.centre
	// rows of the turn are the new axes in source coordinates
	const rows = [x, y, z]
	const t = rows.map(
		(row) => -s * (row[0] * c[0] + row[1] * c[1] + row[2] * c[2]),
	)
	return [
		s * x[0],
		s * y[0],
		s * z[0],
		0,
		s * x[1],
		s * y[1],
		s * z[1],
		0,
		s * x[2],
		s * y[2],
		s * z[2],
		0,
		t[0],
		t[1],
		t[2],
		1,
	]
}

/** `m` applied to the point `p`. */
export const transformPoint = (m: Mat4, p: Vec3): Vec3 => [
	m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
	m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
	m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
]

export interface Bounds {
	min: Vec3
	max: Vec3
}

/** The longest side of a bounding box. */
export const longestSide = ({ min, max }: Bounds): number =>
	Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])

/**
 * How far a model's longest side may be from the craft's published longest dimension: NASA's
 * models are not survey-exact (Voyager's magnetometer boom is drawn shorter than its 13 m), but
 * a wrong unit or a lost scale is off by far more.
 */
export const SIZE_TOLERANCE = 0.05

/** null when the model's longest side agrees with `sizeM`, else what is wrong. */
export const sizeProblem = (bounds: Bounds, sizeM: number): string | null => {
	const side = longestSide(bounds)
	return Math.abs(side / sizeM - 1) <= SIZE_TOLERANCE
		? null
		: `longest side ${side.toFixed(2)} m, but the craft is ${sizeM} m`
}

export interface CreasedMesh {
	/** the triangles, over the new vertices */
	indices: Uint32Array
	/** for each new vertex, the input vertex it copies (its position, texture coordinates) */
	source: Uint32Array
	/** a unit normal per new vertex */
	normals: Float32Array
}

/**
 * Vertex normals with hard edges where faces meet at more than `creaseDeg` (Blender's "auto
 * smooth"): each corner of a triangle averages the faces round its position that lie within the
 * crease angle of its own face, weighted by area. Faces are gathered by position, not by vertex,
 * so a texture seam does not show in the shading. A vertex is split once per distinct normal.
 *
 * NASA's CAD-derived models carry one normal per face (every triangle its own three vertices),
 * which leaves nothing to weld and stops the simplifier at every edge: the generator drops those
 * normals, welds and simplifies, then rebuilds them here.
 */
export const creaseNormals = (
	positions: Float32Array,
	indices: Uint32Array,
	creaseDeg: number,
): CreasedMesh => {
	const vertexCount = positions.length / 3
	const faceCount = indices.length / 3
	// the same position, one id: the first vertex seen there
	const byKey = new Map<string, number>()
	const place = new Uint32Array(vertexCount)
	for (let v = 0; v < vertexCount; v++) {
		const key = `${positions[3 * v]},${positions[3 * v + 1]},${positions[3 * v + 2]}`
		const seen = byKey.get(key)
		place[v] = seen ?? v
		if (seen === undefined) byKey.set(key, v)
	}
	// area-weighted face normals (the cross product's length is twice the area)
	const face = new Float64Array(faceCount * 3)
	const unit = new Float64Array(faceCount * 3)
	for (let f = 0; f < faceCount; f++) {
		const [a, b, c] = [indices[3 * f], indices[3 * f + 1], indices[3 * f + 2]]
		const ab = [0, 1, 2].map((k) => positions[3 * b + k] - positions[3 * a + k])
		const ac = [0, 1, 2].map((k) => positions[3 * c + k] - positions[3 * a + k])
		const n = [
			ab[1] * ac[2] - ab[2] * ac[1],
			ab[2] * ac[0] - ab[0] * ac[2],
			ab[0] * ac[1] - ab[1] * ac[0],
		]
		const length = Math.hypot(n[0], n[1], n[2]) || 1
		for (let k = 0; k < 3; k++) {
			face[3 * f + k] = n[k]
			unit[3 * f + k] = n[k] / length
		}
	}
	// the faces round each position
	const start = new Uint32Array(vertexCount + 1)
	for (const v of indices) start[place[v] + 1]++
	for (let v = 0; v < vertexCount; v++) start[v + 1] += start[v]
	const fill = start.slice(0, vertexCount)
	const around = new Uint32Array(indices.length)
	for (let i = 0; i < indices.length; i++) {
		around[fill[place[indices[i]]]++] = Math.floor(i / 3)
	}
	const limit = Math.cos((creaseDeg * Math.PI) / 180)
	const outIndices = new Uint32Array(indices.length)
	const source: number[] = []
	const normals: number[] = []
	const split = new Map<string, number>()
	for (let i = 0; i < indices.length; i++) {
		const v = indices[i]
		const f = Math.floor(i / 3)
		let x = 0
		let y = 0
		let z = 0
		for (let j = start[place[v]]; j < start[place[v] + 1]; j++) {
			const g = around[j]
			const cos =
				unit[3 * f] * unit[3 * g] +
				unit[3 * f + 1] * unit[3 * g + 1] +
				unit[3 * f + 2] * unit[3 * g + 2]
			if (cos < limit) continue
			x += face[3 * g]
			y += face[3 * g + 1]
			z += face[3 * g + 2]
		}
		const length = Math.hypot(x, y, z)
		const n =
			length > 0
				? [x / length, y / length, z / length]
				: [unit[3 * f], unit[3 * f + 1], unit[3 * f + 2]]
		// one vertex per input vertex and normal (normals equal to 1e-5 are the same)
		const key = `${v}:${n.map((c) => Math.round(c * 1e5)).join(",")}`
		let out = split.get(key)
		if (out === undefined) {
			out = source.length
			split.set(key, out)
			source.push(v)
			normals.push(n[0], n[1], n[2])
		}
		outIndices[i] = out
	}
	return {
		indices: outIndices,
		source: Uint32Array.from(source),
		normals: Float32Array.from(normals),
	}
}

/**
 * For each part (a list of xyz positions), 1 for every vertex whose exact position another part
 * also has, else 0: the simplifier's locks. Parts are simplified one at a time, so where two
 * meet (gold foil against white paint) or lie on top of each other (JWST's black baffle over a
 * gold copy of it) they would come apart or show through each other; locked, they stay together.
 */
export const sharedPositionLocks = (
	parts: readonly Float32Array[],
): Uint8Array[] => {
	const owners = new Map<string, number>()
	const keyOf = (positions: Float32Array, v: number): string =>
		`${positions[3 * v]},${positions[3 * v + 1]},${positions[3 * v + 2]}`
	parts.forEach((positions, part) => {
		for (let v = 0; v < positions.length / 3; v++) {
			const key = keyOf(positions, v)
			const owner = owners.get(key)
			// -1: in more than one part
			if (owner === undefined) owners.set(key, part)
			else if (owner !== part) owners.set(key, -1)
		}
	})
	return parts.map((positions) => {
		const locks = new Uint8Array(positions.length / 3)
		for (let v = 0; v < locks.length; v++) {
			locks[v] = owners.get(keyOf(positions, v)) === -1 ? 1 : 0
		}
		return locks
	})
}

/**
 * Paints the box [left, top, right, bottom) (pixels) of a raw image with the mean colour of the
 * two-pixel ring round it, in place: how a NASA insignia or logotype in a texture is covered
 * (data/spacecraft-models.json `paintOver`), so the patch matches the surface it sits on.
 */
export const paintBox = (
	data: Uint8Array,
	width: number,
	height: number,
	channels: number,
	box: readonly [number, number, number, number],
): void => {
	const [left, top, right, bottom] = box
	if (
		left < 0 ||
		top < 0 ||
		right > width ||
		bottom > height ||
		left >= right ||
		top >= bottom
	) {
		throw new Error(`box ${box.join(",")} is not inside ${width}x${height}`)
	}
	const sum = new Array<number>(channels).fill(0)
	let count = 0
	const ring = 2
	for (
		let y = Math.max(0, top - ring);
		y < Math.min(height, bottom + ring);
		y++
	) {
		for (
			let x = Math.max(0, left - ring);
			x < Math.min(width, right + ring);
			x++
		) {
			if (x >= left && x < right && y >= top && y < bottom) continue
			for (let c = 0; c < channels; c++)
				sum[c] += data[(y * width + x) * channels + c]
			count++
		}
	}
	const mean = sum.map((v) => Math.round(v / count))
	for (let y = top; y < bottom; y++) {
		for (let x = left; x < right; x++) {
			for (let c = 0; c < channels; c++)
				data[(y * width + x) * channels + c] = mean[c]
		}
	}
}

/** The cache file of a source: its id plus the download's extension. */
export const cacheFileName = (sourceId: string, file: string): string => {
	const path = new URL(file).pathname
	const dot = path.lastIndexOf(".")
	return `${sourceId}${dot > path.lastIndexOf("/") ? path.slice(dot) : ""}`
}

/** "123.4 KB" */
export const kilobytes = (bytes: number): string =>
	`${(bytes / 1024).toFixed(1)} KB`

/**
 * The models' sources for src/data/credits.json (`kind: "model"`), in the catalogue's order, each
 * with the craft that wear it (`bodies`). Every model file must exist under public/ (else run
 * `pnpm gen:models`); a source no craft wears is left out.
 */
export const modelCredits = (
	raw: unknown,
	fileExists: (publicPath: string) => boolean,
): ImageCredit[] => {
	const parsed = SpacecraftModelsFile.safeParse(raw)
	if (!parsed.success) {
		const issue = parsed.error.issues[0]
		throw new Error(
			`invalid data/spacecraft-models.json (${issue.path.join(".")}: ${issue.message})`,
		)
	}
	const catalogue = parsed.data
	const craftBySource = new Map<string, string[]>()
	for (const [craftId, uses] of Object.entries(catalogue.craft)) {
		for (const use of uses) {
			const path = `${SPACECRAFT_MODEL_DIR}/${use.model}.glb`
			if (!fileExists(path)) {
				throw new Error(
					`${craftId}: ${path} is missing under public/ (run pnpm gen:models)`,
				)
			}
			const source = catalogue.models[use.model].source
			const craft = craftBySource.get(source) ?? []
			if (!craft.includes(craftId)) craft.push(craftId)
			craftBySource.set(source, craft)
		}
	}
	return Object.entries(catalogue.sources).flatMap(([id, source]) => {
		const craft = craftBySource.get(id)
		if (craft === undefined) return []
		return [
			{
				id,
				kind: "model" as const,
				title: source.title,
				credit: source.credit,
				short: source.short,
				url: source.url,
				licence: source.licence,
				licenceUrl: source.licenceUrl,
				...(source.note === undefined ? {} : { note: source.note }),
				bodies: craft,
			},
		]
	})
}
