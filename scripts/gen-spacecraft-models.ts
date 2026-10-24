/**
 * pnpm gen:models [--only voyager,juno]: data/spacecraft-models.json -> one GLB per model under
 * public/assets/models/spacecraft/ (#72). Each NASA source is downloaded once into
 * node_modules/.cache/orbitalia-models/ (a rerun is offline), then:
 *
 * 1. the meshes of the nodes in `remove` are left out (Huygens, after the probe's release; the
 *    1 m cube some Blender exports put on the root node);
 * 2. every part is moved, scaled and turned into the shared frame (origin at the bus centre,
 *    metres, +Z the axis that points, +Y the second axis; scripts/lib/spacecraftModels.ts) and
 *    the node tree flattened, so the file needs no transform to be read;
 * 3. normal maps are dropped except on the materials in `normalMaps`, duplicates merged, vertices
 *    welded and every part simplified within `simplify` x `sizeM` metres (meshoptimizer; a model
 *    with one normal per face gets new normals with a `creaseAngle` afterwards), then the parts
 *    that share a material joined (fewer draw calls);
 * 4. insignia in the textures are painted over (`paintOver`), textures shrunk to `textureSize` and
 *    re-encoded as WebP (EXT_texture_webp);
 * 5. the geometry is quantized and meshopt-compressed (EXT_meshopt_compression), which three's
 *    GLTFLoader reads with its MeshoptDecoder.
 *
 * The output is deterministic. It prints each file's size before and after and fails on a file
 * over its budget or a model whose size disagrees with the craft's. See docs/ARCHITECTURE.md,
 * "Spacecraft", Models.
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

import {
	Document,
	Logger,
	NodeIO,
	Primitive,
	PropertyType,
	type Material,
	type Node,
} from "@gltf-transform/core"
import { ALL_EXTENSIONS, KHRTextureTransform } from "@gltf-transform/extensions"
import {
	compactPrimitive,
	dedup,
	flatten,
	getBounds,
	join as joinPrimitives,
	listTextureInfoByMaterial,
	meshopt,
	prune,
	textureCompress,
	transformMesh,
	weld,
} from "@gltf-transform/functions"
import {
	MeshoptDecoder,
	MeshoptEncoder,
	MeshoptSimplifier,
	type SimplifierFlags,
} from "meshoptimizer"
import sharp from "sharp"

import {
	MODEL_BUDGET_BYTES,
	MODELS_TOTAL_BUDGET_BYTES,
	SPACECRAFT_MODEL_DIR,
	SpacecraftModelsFile,
	type SpacecraftModel,
} from "../src/data/spacecraftModelsSchema"

import {
	cacheFileName,
	creaseNormals,
	kilobytes,
	normaliseMatrix,
	paintBox,
	sharedPositionLocks,
	sizeProblem,
	type Bounds,
} from "./lib/spacecraftModels"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const cacheDir = join(root, "node_modules", ".cache", "orbitalia-models")
const outDir = join(root, "public", SPACECRAFT_MODEL_DIR)
const WEBP_QUALITY = 82

const log = (line: string): void => {
	process.stdout.write(`${line}\n`)
}

const download = async (url: string, file: string): Promise<void> => {
	if (existsSync(file)) return
	log(`  downloading ${url}`)
	const response = await fetch(url, {
		headers: {
			"user-agent": "Orbitalia gen:models (https://github.com/h4nz2/Orbitalia)",
		},
	})
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, Buffer.from(await response.arrayBuffer()))
}

/**
 * NASA 3D Resources' GLBs are Draco-compressed. three ships Google's Draco decoder (the
 * Emscripten build its DRACOLoader runs in a worker); it is a CommonJS script inside an ES module
 * package, so it is evaluated here in its own context rather than imported: no extra dependency.
 */
const dracoDecoder = async (): Promise<unknown> => {
	const require = createRequire(import.meta.url)
	const file = require.resolve("three/examples/jsm/libs/draco/draco_decoder.js")
	const sandbox = {
		module: { exports: {} as unknown },
		exports: {},
		console,
		__filename: file,
	}
	vm.runInNewContext(readFileSync(file, "utf8"), sandbox, { filename: file })
	return (sandbox.module.exports as () => Promise<unknown>)()
}

/** Leaves out the meshes of the nodes named in `remove` (their children stay). */
const removeMeshes = (doc: Document, names: readonly string[]): void => {
	const left = new Set(names)
	for (const node of doc.getRoot().listNodes()) {
		if (!left.has(node.getName())) continue
		if (node.getMesh() === null) {
			throw new Error(`remove: node "${node.getName()}" has no mesh`)
		}
		node.setMesh(null)
		left.delete(node.getName())
	}
	if (left.size > 0) {
		throw new Error(`remove: no node named ${[...left].join(", ")}`)
	}
}

/**
 * Bakes the normalisation and every node's own transform into the vertices, so the scene is a
 * flat list of meshes with identity transforms in the shared frame.
 */
const normalise = async (
	doc: Document,
	frame: SpacecraftModel["normalise"],
): Promise<void> => {
	await doc.transform(flatten())
	const matrix = normaliseMatrix(frame)
	const users = new Map<unknown, number>()
	const meshNodes: Node[] = []
	for (const node of doc.getRoot().listNodes()) {
		const mesh = node.getMesh()
		if (mesh === null) continue
		meshNodes.push(node)
		users.set(mesh, (users.get(mesh) ?? 0) + 1)
	}
	for (const node of meshNodes) {
		let mesh = node.getMesh()
		if (mesh === null) continue
		// a mesh drawn by several nodes is copied, so each copy can take its node's transform
		// (transformMesh copies the primitives and vertices it would otherwise share)
		if ((users.get(mesh) ?? 0) > 1) {
			mesh = mesh.clone()
			node.setMesh(mesh)
		}
		const world = node.getWorldMatrix()
		transformMesh(mesh, multiply(matrix, world))
		node.setMatrix(IDENTITY)
	}
	for (const node of doc.getRoot().listNodes()) {
		if (node.getMesh() === null) node.setMatrix(IDENTITY)
	}
}

type Mat = Parameters<Node["setMatrix"]>[0]
const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** a * b, column-major. */
const multiply = (a: readonly number[], b: readonly number[]): Mat => {
	const out = new Array<number>(16).fill(0)
	for (let col = 0; col < 4; col++) {
		for (let row = 0; row < 4; row++) {
			let sum = 0
			for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k]
			out[col * 4 + row] = sum
		}
	}
	return out as Mat
}

/**
 * meshoptimizer's simplifier on every triangle list, within `error` metres anywhere on the craft
 * (not relative to each part, so a strut keeps the detail a panel keeps); loose bits smaller than
 * that (bolts, cable ties) go altogether (Prune). Shading and texture coordinates count towards
 * the error, so their seams survive (unless `permissive`), and where two parts meet nothing
 * moves (`sharedPositionLocks`). The nodes and materials named in `exact` are left alone. Runs
 * before the parts are joined, so `exact` can name a part by its node.
 */
const simplifyMeshes = (
	doc: Document,
	error: number,
	model: Pick<SpacecraftModel, "permissive" | "exact">,
): void => {
	// a normal may turn by about 15 degrees, texture coordinates move by 2 texels of 512
	const normalWeight = error / 0.25
	const uvWeight = error / 0.004
	const exact = new Set(model.exact ?? [])
	const flags: SimplifierFlags[] = model.permissive
		? ["ErrorAbsolute", "Prune", "Permissive"]
		: ["ErrorAbsolute", "Prune"]
	// the nodes are flat by now, each with its own mesh (`normalise`)
	const parts = doc
		.getRoot()
		.listNodes()
		.flatMap((node) =>
			(node.getMesh()?.listPrimitives() ?? []).map((prim) => ({
				prim,
				exact:
					exact.has(node.getName()) ||
					exact.has(prim.getMaterial()?.getName() ?? ""),
			})),
		)
		.filter(
			({ prim }) =>
				prim.getMode() === Primitive.Mode.TRIANGLES &&
				prim.getIndices() !== null &&
				prim.getAttribute("POSITION") !== null,
		)
	const element: number[] = []
	const positionsOf = (prim: Primitive): Float32Array => {
		const position = prim.getAttribute("POSITION")
		const count = position?.getCount() ?? 0
		const out = new Float32Array(count * 3)
		for (let i = 0; i < count; i++)
			out.set(position?.getElement(i, element) ?? [], i * 3)
		return out
	}
	const positions = parts.map(({ prim }) => positionsOf(prim))
	const locks = sharedPositionLocks(positions)
	parts.forEach(({ prim, exact }, p) => {
		const indices = prim.getIndices()
		if (indices === null || exact) return
		const count = positions[p].length / 3
		const normal = prim.getAttribute("NORMAL")
		const uv = prim.getAttribute("TEXCOORD_0")
		const stride = (normal ? 3 : 0) + (uv ? 2 : 0)
		const attributes = new Float32Array(count * stride)
		const weights: number[] = []
		if (normal) weights.push(normalWeight, normalWeight, normalWeight)
		if (uv) weights.push(uvWeight, uvWeight)
		for (let i = 0; i < count; i++) {
			let k = i * stride
			if (normal)
				for (const v of normal.getElement(i, element)) attributes[k++] = v
			if (uv) for (const v of uv.getElement(i, element)) attributes[k++] = v
		}
		const [simplified] = MeshoptSimplifier.simplifyWithAttributes(
			Uint32Array.from(indices.getArray() ?? []),
			positions[p],
			3,
			attributes,
			stride,
			weights,
			locks[p],
			0,
			error,
			flags,
		)
		if (simplified.length === 0) {
			// all of it was smaller than the error
			prim.dispose()
			return
		}
		prim.setIndices(indices.clone().setArray(simplified))
		compactPrimitive(prim)
	})
}

/** Drops every normal (rebuilt by `creaseMeshes` after welding and simplifying). */
const dropNormals = (doc: Document): void => {
	for (const mesh of doc.getRoot().listMeshes()) {
		for (const prim of mesh.listPrimitives()) prim.setAttribute("NORMAL", null)
	}
}

/** Normals with hard edges beyond `creaseDeg` (scripts/lib/spacecraftModels.ts). */
const creaseMeshes = (doc: Document, creaseDeg: number): void => {
	for (const mesh of doc.getRoot().listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			const indices = prim.getIndices()
			const position = prim.getAttribute("POSITION")
			if (indices === null || position === null) continue
			const creased = creaseNormals(
				Float32Array.from(position.getArray() ?? []),
				Uint32Array.from(indices.getArray() ?? []),
				creaseDeg,
			)
			for (const semantic of prim.listSemantics()) {
				const accessor = prim.getAttribute(semantic)
				const array = accessor?.getArray()
				if (accessor === null || array === null || array === undefined) continue
				const size = accessor.getElementSize()
				const out = new (array.constructor as Float32ArrayConstructor)(
					creased.source.length * size,
				)
				creased.source.forEach((from, to) => {
					for (let k = 0; k < size; k++)
						out[to * size + k] = array[from * size + k]
				})
				prim.setAttribute(semantic, accessor.clone().setArray(out))
			}
			prim.setAttribute(
				"NORMAL",
				doc
					.createAccessor()
					.setType("VEC3")
					.setArray(creased.normals)
					.setBuffer(position.getBuffer()),
			)
			prim.setIndices(indices.clone().setArray(creased.indices))
		}
	}
}

/**
 * Quantization keeps texture coordinates as floats (twice the bytes) when any lies outside 0..1,
 * as some do by a little in NASA's models. Those are rescaled into 0..1 and the material's
 * textures given the inverse as a KHR_texture_transform, which three's GLTFLoader applies.
 */
const fitTexcoords = (doc: Document): void => {
	const byMaterial = new Map<Material, Primitive[]>()
	for (const mesh of doc.getRoot().listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			const material = prim.getMaterial()
			// integer coordinates are normalised, so always within 0..1
			if (material === null || texcoords(prim) === undefined) continue
			byMaterial.set(material, [...(byMaterial.get(material) ?? []), prim])
		}
	}
	for (const [material, prims] of byMaterial) {
		const infos = listTextureInfoByMaterial(material).filter(
			(info) => info.getTexCoord() === 0,
		)
		if (infos.length === 0) continue
		const min = [Infinity, Infinity]
		const max = [-Infinity, -Infinity]
		for (const prim of prims) {
			const uv = texcoords(prim) ?? []
			for (let i = 0; i < uv.length; i++) {
				min[i % 2] = Math.min(min[i % 2], uv[i])
				max[i % 2] = Math.max(max[i % 2], uv[i])
			}
		}
		if (min[0] >= 0 && min[1] >= 0 && max[0] <= 1 && max[1] <= 1) continue
		if (infos.some((info) => info.getExtension("KHR_texture_transform"))) {
			throw new Error(`${material.getName()}: already has a texture transform`)
		}
		const size = [max[0] - min[0] || 1, max[1] - min[1] || 1]
		for (const prim of prims) {
			const uv = prim.getAttribute("TEXCOORD_0")
			const array = texcoords(prim)
			if (uv === null || array === undefined) continue
			const fitted = array.map((v, i) => (v - min[i % 2]) / size[i % 2])
			prim.setAttribute("TEXCOORD_0", uv.clone().setArray(fitted))
		}
		const transform = doc
			.createExtension(KHRTextureTransform)
			.setRequired(true)
			.createTransform()
			.setOffset([min[0], min[1]])
			.setScale([size[0], size[1]])
		for (const info of infos)
			info.setExtension("KHR_texture_transform", transform)
	}
}

/** A primitive's first texture coordinates when they are floats. */
const texcoords = (prim: Primitive): Float32Array | undefined => {
	const array = prim.getAttribute("TEXCOORD_0")?.getArray()
	return array instanceof Float32Array ? array : undefined
}

/** Covers the boxes of `paintOver` (scripts/lib/spacecraftModels.ts `paintBox`). */
const paintOver = async (
	doc: Document,
	patches: NonNullable<SpacecraftModel["paintOver"]>,
): Promise<void> => {
	for (const patch of patches) {
		const texture = doc
			.getRoot()
			.listTextures()
			.find((t) => t.getName() === patch.texture && t.listParents().length > 1)
		const image = texture?.getImage()
		if (texture === undefined || image === null || image === undefined) {
			throw new Error(`paintOver: no texture "${patch.texture}" in use`)
		}
		const { data, info } = await sharp(image)
			.raw()
			.toBuffer({ resolveWithObject: true })
		paintBox(data, info.width, info.height, info.channels, patch.box)
		const png = await sharp(data, {
			raw: { width: info.width, height: info.height, channels: info.channels },
		})
			.png()
			.toBuffer()
		texture.setImage(new Uint8Array(png)).setMimeType("image/png")
	}
}

/** Drops the normal maps of every material not in `keep` (unused textures go with them). */
const dropNormalMaps = (doc: Document, keep: readonly string[]): void => {
	for (const material of doc.getRoot().listMaterials()) {
		if (!keep.includes(material.getName())) material.setNormalTexture(null)
	}
}

interface Stats {
	triangles: number
	textures: string[]
}

const statsOf = (doc: Document): Stats => {
	let triangles = 0
	for (const mesh of doc.getRoot().listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			const indices = prim.getIndices()
			const count = indices
				? indices.getCount()
				: (prim.getAttribute("POSITION")?.getCount() ?? 0)
			triangles += count / 3
		}
	}
	const textures = doc
		.getRoot()
		.listTextures()
		.map((texture) => {
			const size = texture.getSize()
			return `${texture.getMimeType().replace("image/", "")} ${size?.[0]}x${size?.[1]}`
		})
	return { triangles: Math.round(triangles), textures }
}

const boundsOf = (doc: Document): Bounds => {
	const scene = doc.getRoot().listScenes()[0]
	const { min, max } = getBounds(scene)
	return {
		min: [min[0], min[1], min[2]],
		max: [max[0], max[1], max[2]],
	}
}

const main = async (): Promise<number> => {
	const onlyArg = process.argv.indexOf("--only")
	const only =
		onlyArg === -1 ? null : new Set(process.argv[onlyArg + 1]?.split(","))
	const catalogue = SpacecraftModelsFile.parse(
		JSON.parse(
			readFileSync(join(root, "data", "spacecraft-models.json"), "utf8"),
		),
	)
	await MeshoptDecoder.ready
	await MeshoptEncoder.ready
	await MeshoptSimplifier.ready
	const io = new NodeIO()
		.registerExtensions(ALL_EXTENSIONS)
		.registerDependencies({
			"draco3d.decoder": await dracoDecoder(),
			"meshopt.decoder": MeshoptDecoder,
			"meshopt.encoder": MeshoptEncoder,
		})
	mkdirSync(outDir, { recursive: true })
	let failed = false
	for (const [id, model] of Object.entries(catalogue.models)) {
		if (only !== null && !only.has(id)) continue
		const started = Date.now()
		const source = catalogue.sources[model.source]
		const cached = join(cacheDir, cacheFileName(model.source, source.file))
		await download(source.file, cached)
		const doc = await io.read(cached)
		doc.setLogger(new Logger(Logger.Verbosity.WARN))
		const before = statsOf(doc)
		// decoded on reading; the output is meshopt-compressed instead
		for (const extension of doc.getRoot().listExtensionsUsed()) {
			if (extension.extensionName === "KHR_draco_mesh_compression") {
				extension.dispose()
			}
		}
		removeMeshes(doc, model.remove ?? [])
		await normalise(doc, model.normalise)
		dropNormalMaps(doc, model.normalMaps ?? [])
		if (model.creaseAngle !== undefined) dropNormals(doc)
		await doc.transform(
			prune(),
			// materials keep their source names (`exact` names them), even when two are alike
			dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.TEXTURE] }),
			weld(),
		)
		simplifyMeshes(doc, model.simplify * model.sizeM, model)
		if (model.creaseAngle !== undefined) creaseMeshes(doc, model.creaseAngle)
		await doc.transform(prune(), joinPrimitives(), weld(), prune())
		fitTexcoords(doc)
		await paintOver(doc, model.paintOver ?? [])
		await doc.transform(
			textureCompress({
				encoder: sharp,
				targetFormat: "webp",
				resize: [model.textureSize, model.textureSize],
				quality: WEBP_QUALITY,
			}),
			prune(),
			meshopt({ encoder: MeshoptEncoder, level: "high" }),
		)
		const bounds = boundsOf(doc)
		const after = statsOf(doc)
		const file = join(outDir, `${id}.glb`)
		writeFileSync(file, await io.writeBinary(doc))
		const bytes = statSync(file).size
		log(
			`${id}: ${kilobytes(statSync(cached).size)} -> ${kilobytes(bytes)}, ${before.triangles} -> ${after.triangles} triangles, textures ${after.textures.join(", ") || "none"}, ${Date.now() - started} ms`,
		)
		log(
			`  bounds ${bounds.min.map((v) => v.toFixed(2)).join(" ")} .. ${bounds.max.map((v) => v.toFixed(2)).join(" ")}`,
		)
		const problem = sizeProblem(bounds, model.sizeM)
		if (problem !== null) {
			log(`  error: ${problem}`)
			failed = true
		}
		if (bytes > MODEL_BUDGET_BYTES) {
			log(`  error: over the budget of ${kilobytes(MODEL_BUDGET_BYTES)}`)
			failed = true
		}
	}
	let total = 0
	for (const id of Object.keys(catalogue.models)) {
		const file = join(outDir, `${id}.glb`)
		if (existsSync(file)) total += statSync(file).size
	}
	log(`spacecraft models: ${kilobytes(total)} in all`)
	if (total > MODELS_TOTAL_BUDGET_BYTES) {
		log(`error: over the budget of ${kilobytes(MODELS_TOTAL_BUDGET_BYTES)}`)
		failed = true
	}
	return failed ? 1 : 0
}

process.exitCode = await main()
