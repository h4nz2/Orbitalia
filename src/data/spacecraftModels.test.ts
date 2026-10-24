/**
 * The spacecraft models' contract (#72): data/spacecraft-models.json is complete, every craft of
 * the catalogue has a model, every file exists, decodes the way the app will load it (meshopt,
 * WebP textures), is normalised to the craft's real size and stays within the phone budget.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

import { NodeIO, type Document } from "@gltf-transform/core"
import { ALL_EXTENSIONS } from "@gltf-transform/extensions"
import { getBounds } from "@gltf-transform/functions"
import { beforeAll, describe, expect, it } from "vitest"

import { dateToJD } from "@/sim"

import { craftModelRanges } from "../../scripts/lib/spacecraftModels"

import { spacecraft } from "./spacecraft"
import { craftModelAt, craftModels, modelUrl } from "./spacecraftModels"
import runtimeJson from "./spacecraftModels.json"
import {
	CraftModelsFile,
	MODEL_BUDGET_BYTES,
	MODELS_TOTAL_BUDGET_BYTES,
	SPACECRAFT_MODEL_DIR,
	SpacecraftModelsFile,
} from "./spacecraftModelsSchema"

const root = join(__dirname, "..", "..")
const raw: unknown = JSON.parse(
	readFileSync(join(root, "data", "spacecraft-models.json"), "utf8"),
)
const catalogue = SpacecraftModelsFile.parse(raw)
const modelDir = join(root, "public", SPACECRAFT_MODEL_DIR)
const fileOf = (model: string) => join(modelDir, `${model}.glb`)

interface MeshoptDecoderApi {
	ready: Promise<void>
	supported: boolean
	decodeGltfBuffer: (
		target: Uint8Array,
		count: number,
		size: number,
		source: Uint8Array,
		mode: string,
		filter?: string,
	) => void
}

/**
 * The meshopt decoder the app loads the models with: three-stdlib's, which drei's `useGLTF` hands
 * to three's GLTFLoader. three-stdlib is drei's dependency, not ours, so it is found from drei
 * (the very copy drei imports). gltf-transform calls its `decodeGltfBuffer` on every
 * meshopt-compressed buffer view, so a file read through it is decoded byte for byte as in the
 * app: an encoder newer than the decoder (a codec version or filter it lacks) fails here.
 */
const appMeshoptDecoder = async (): Promise<MeshoptDecoderApi> => {
	const fromDrei = createRequire(
		createRequire(import.meta.url).resolve("@react-three/drei"),
	)
	const stdlib = dirname(fromDrei.resolve("three-stdlib"))
	const { MeshoptDecoder } = (await import(
		pathToFileURL(join(stdlib, "libs", "MeshoptDecoder.js")).href
	)) as { MeshoptDecoder: () => MeshoptDecoderApi }
	const decoder = MeshoptDecoder()
	await decoder.ready
	return decoder
}

describe("data/spacecraft-models.json", () => {
	it("matches its schema", () => {
		const parsed = SpacecraftModelsFile.safeParse(raw)
		expect(parsed.success ? [] : parsed.error.issues).toEqual([])
	})

	it("gives every craft of the catalogue a model, and no other craft", () => {
		expect(Object.keys(catalogue.craft).sort()).toEqual(
			spacecraft.map((craft) => craft.id).sort(),
		)
	})

	it("uses every model and every source", () => {
		const worn = new Set(
			Object.values(catalogue.craft).flatMap((uses) =>
				uses.map((use) => use.model),
			),
		)
		expect([...worn].sort()).toEqual(Object.keys(catalogue.models).sort())
		const sources = new Set(
			Object.values(catalogue.models).map((model) => model.source),
		)
		expect([...sources].sort()).toEqual(Object.keys(catalogue.sources).sort())
	})

	it("says what +Z points at and sources every size and spin", () => {
		for (const [id, model] of Object.entries(catalogue.models)) {
			expect(model.size.url, id).toMatch(/^https:\/\//)
			if (model.spinRpm !== undefined) {
				expect(model.spin?.url, id).toMatch(/^https:\/\//)
			}
		}
		// the high-gain antenna points at Earth; Parker's heat shield, JWST's sunshield and
		// Clipper's solar arrays at the Sun
		const points = Object.fromEntries(
			Object.entries(catalogue.craft).map(([craftId, uses]) => [
				craftId,
				catalogue.models[uses[0].model].points,
			]),
		)
		expect(points).toEqual({
			voyager1: "earth",
			voyager2: "earth",
			pioneer10: "earth",
			pioneer11: "earth",
			newHorizons: "earth",
			cassini: "earth",
			parker: "sun",
			jwst: "sun",
			juno: "earth",
			europaClipper: "sun",
		})
		expect(catalogue.models.juno.spinRpm).toBe(2)
	})
})

describe("the catalogue's schema", () => {
	const messages = (file: unknown): string[] => {
		const parsed = SpacecraftModelsFile.safeParse(file)
		return parsed.success
			? []
			: parsed.error.issues.map((issue) => issue.message)
	}
	/** the real catalogue with Cassini's models replaced */
	const withCassini = (uses: unknown[]) =>
		messages({ ...catalogue, craft: { ...catalogue.craft, cassini: uses } })
	const switchAt = (until: string, from: string) =>
		withCassini([
			{ model: "cassini", until },
			{ model: "cassini-no-huygens", from },
		])

	it("compares times, not text: 02:00Z and 02:00:00Z are the same instant", () => {
		expect(switchAt("2004-12-25T02:00Z", "2004-12-25T02:00:00Z")).toEqual([])
	})

	it("rejects a date or time that does not exist", () => {
		for (const date of [
			"2004-02-30T02:00Z",
			"2003-02-29T02:00Z",
			"2004-13-01T02:00Z",
			"2004-12-25T24:00Z",
			"2004-12-25T02:60Z",
			"2004-12-25T02:00:60Z",
		]) {
			expect(switchAt(date, date), date).toContain("not a real date and time")
		}
	})

	it("rejects a reversed or empty range, a gap and an overlap", () => {
		const threeModels = (from: string, until: string) =>
			withCassini([
				{ model: "cassini", until: from },
				{ model: "cassini", from, until },
				{ model: "cassini-no-huygens", from: until },
			])
		expect(threeModels("2005-01-01T00:00Z", "2004-12-25T02:00Z")).toContain(
			'craft "cassini": model 1 must begin before it ends',
		)
		expect(threeModels("2004-12-25T02:00Z", "2004-12-25T02:00:00Z")).toContain(
			'craft "cassini": model 1 must begin before it ends',
		)
		const notTiled = expect.stringMatching(/end where the next begins/)
		expect(switchAt("2004-12-25T02:00Z", "2004-12-25T02:01Z")).toContainEqual(
			notTiled,
		)
		expect(switchAt("2004-12-25T02:01Z", "2004-12-25T02:00Z")).toContainEqual(
			notTiled,
		)
	})

	it("needs every source pinned: a GitHub file to a commit, every file to its SHA-256", () => {
		const voyager = catalogue.sources["nasa3d-voyager"]
		const withVoyager = (source: object) =>
			messages({
				...catalogue,
				sources: { ...catalogue.sources, "nasa3d-voyager": source },
			})
		expect(
			withVoyager({
				...voyager,
				file: voyager.file.replace(/\/[0-9a-f]{40}\//, "/master/"),
			}),
		).toEqual([
			"a file on raw.githubusercontent.com must be pinned to a commit",
		])
		expect(withVoyager({ ...voyager, sha256: undefined })).toHaveLength(1)
		expect(withVoyager({ ...voyager, sha256: "abc" })).toEqual([
			"expected 64 hex digits",
		])
	})
})

describe("src/data/spacecraftModels.json", () => {
	it("is the catalogue's slim copy for the app (else run pnpm build:data)", () => {
		expect(CraftModelsFile.safeParse(runtimeJson).success).toBe(true)
		expect(runtimeJson).toEqual(craftModelRanges(raw))
	})
})

describe("the model files", () => {
	it("are all in the catalogue and within the phone budget", () => {
		const files = readdirSync(modelDir).sort()
		expect(files).toEqual(
			Object.keys(catalogue.models)
				.map((id) => `${id}.glb`)
				.sort(),
		)
		let total = 0
		for (const file of files) {
			const bytes = statSync(join(modelDir, file)).size
			expect(bytes, file).toBeLessThanOrEqual(MODEL_BUDGET_BYTES)
			total += bytes
		}
		expect(total).toBeLessThanOrEqual(MODELS_TOTAL_BUDGET_BYTES)
	})

	describe("decode as the app loads them", () => {
		const docs = new Map<string, Document>()
		beforeAll(async () => {
			const decoder = await appMeshoptDecoder()
			expect(decoder.supported).toBe(true)
			const io = new NodeIO()
				.registerExtensions(ALL_EXTENSIONS)
				.registerDependencies({ "meshopt.decoder": decoder })
			for (const id of Object.keys(catalogue.models)) {
				docs.set(id, await io.read(fileOf(id)))
			}
		})

		it("meshopt-compressed, WebP textures of at most 1024 px, nothing the loader lacks", () => {
			// three's GLTFLoader reads all of these (EXT_meshopt_compression with three-stdlib's
			// MeshoptDecoder, which drei's useGLTF gives it)
			const supported = new Set([
				"EXT_meshopt_compression",
				"EXT_texture_webp",
				"KHR_mesh_quantization",
				"KHR_texture_transform",
				"KHR_materials_ior",
				"KHR_materials_specular",
			])
			for (const [id, doc] of docs) {
				const used = doc
					.getRoot()
					.listExtensionsUsed()
					.map((extension) => extension.extensionName)
				expect(used, id).toContain("EXT_meshopt_compression")
				expect(
					used.filter((name) => !supported.has(name)),
					id,
				).toEqual([])
				for (const texture of doc.getRoot().listTextures()) {
					expect(texture.getMimeType(), id).toBe("image/webp")
					const [width, height] = texture.getSize() ?? [Infinity, Infinity]
					expect(Math.max(width, height), id).toBeLessThanOrEqual(1024)
				}
			}
		})

		it("in metres, as long as the craft, round the bus centre", () => {
			for (const [id, doc] of docs) {
				const { min, max } = getBounds(doc.getRoot().listScenes()[0])
				const longest = Math.max(...max.map((v, i) => v - min[i]))
				const { sizeM } = catalogue.models[id]
				expect(Math.abs(longest / sizeM - 1), id).toBeLessThanOrEqual(0.05)
				// the origin (the bus centre) lies inside the craft's box
				for (let i = 0; i < 3; i++) {
					expect(min[i], id).toBeLessThan(0)
					expect(max[i], id).toBeGreaterThan(0)
				}
			}
		})
	})
})

describe("craftModelAt", () => {
	const jd = (iso: string) => dateToJD(new Date(iso))

	it("gives Cassini Huygens until the probe's release on 25 December 2004", () => {
		expect(craftModelAt("cassini", jd("2004-07-01T00:00Z"))?.id).toBe("cassini")
		expect(craftModelAt("cassini", jd("2004-12-25T01:59Z"))?.id).toBe("cassini")
		expect(craftModelAt("cassini", jd("2004-12-25T02:00Z"))?.id).toBe(
			"cassini-no-huygens",
		)
		expect(craftModelAt("cassini", jd("2017-09-15T00:00Z"))?.id).toBe(
			"cassini-no-huygens",
		)
		expect(craftModels("cassini").map((model) => model.id)).toEqual([
			"cassini",
			"cassini-no-huygens",
		])
	})

	it("lets twins share a file and every craft have a model at any time", () => {
		const t = jd("1990-01-01T00:00Z")
		expect(modelUrl("voyager1", t)).toBe(modelUrl("voyager2", t))
		expect(modelUrl("pioneer10", t)).toBe(modelUrl("pioneer11", t))
		expect(modelUrl("voyager1", t)).toBe(
			"/assets/models/spacecraft/voyager.glb",
		)
		for (const craft of spacecraft) {
			expect(craftModelAt(craft.id, t), craft.id).toBeDefined()
		}
		expect(craftModelAt("juno", t)).toMatchObject({
			spinRpm: 2,
			points: "earth",
		})
		expect(craftModelAt("sputnik", t)).toBeUndefined()
	})
})
