/**
 * The spacecraft models' files (issue #73 on #72's data): each GLB is fetched
 * the first time a craft needs it, decoded once and kept for the session.
 * The scene asks every frame (`craftModelFile`), and draws the diamond until
 * the answer is a loaded model, and for good if loading failed.
 *
 * Plain promises rather than drei's `useGLTF`: a model is not worth a
 * Suspense boundary or an error boundary in the scene, and the frame loop
 * needs "still loading" and "failed" as values. The loader is three's own
 * GLTFLoader with its MeshoptDecoder (the files are meshopt-compressed, no
 * Draco), in a chunk of its own fetched with the first model, so a visit
 * that never shows a craft downloads neither.
 */
import { Mesh, Vector3, type Group } from "three"

import { DEFAULT_CORE_SHARE, coreShareOf } from "./modelSize"

export type ModelFileState = "loading" | "ready" | "failed"

export interface ModelFile {
	state: ModelFileState
	/** The decoded scene (shared: clone it per craft), once ready. */
	scene: Group | null
	/** Its core over its longest length (`coreShareOf`), measured once loaded. */
	coreShare: number
}

const files = new Map<string, ModelFile>()

type Loader = { loadAsync: (url: string) => Promise<{ scene: Group }> }
let loader: Promise<Loader> | null = null

const loadLoader = (): Promise<Loader> =>
	(loader ??= Promise.all([
		import("three/examples/jsm/loaders/GLTFLoader.js"),
		import("three/examples/jsm/libs/meshopt_decoder.module.js"),
	]).then(([{ GLTFLoader }, { MeshoptDecoder }]) => {
		const gltf = new GLTFLoader()
		gltf.setMeshoptDecoder(MeshoptDecoder)
		return gltf
	}))

const a = new Vector3()
const b = new Vector3()
const c = new Vector3()

/** Every triangle's centroid distance from the bus centre and its area (metres), for `coreShareOf`. */
function measure(scene: Group, sizeM: number): number {
	scene.updateMatrixWorld(true)
	const distances: number[] = []
	const areas: number[] = []
	scene.traverse((object) => {
		if (!(object instanceof Mesh)) return
		const position = object.geometry.getAttribute("position")
		const index = object.geometry.getIndex()
		const count = index === null ? position.count : index.count
		const vertex = (k: number, out: Vector3) =>
			out
				.fromBufferAttribute(position, index === null ? k : index.getX(k))
				.applyMatrix4(object.matrixWorld)
		for (let k = 0; k + 2 < count; k += 3) {
			vertex(k, a)
			vertex(k + 1, b)
			vertex(k + 2, c)
			const centre = Math.hypot(
				(a.x + b.x + c.x) / 3,
				(a.y + b.y + c.y) / 3,
				(a.z + b.z + c.z) / 3,
			)
			b.sub(a)
			c.sub(a)
			distances.push(centre)
			areas.push(b.cross(c).length() / 2)
		}
	})
	return distances.length === 0
		? DEFAULT_CORE_SHARE
		: coreShareOf(new Float64Array(distances), new Float64Array(areas), sizeM)
}

/** The model file at `url` if it has been asked for, without fetching it. */
export const peekModelFile = (url: string): ModelFile | undefined =>
	files.get(url)

/**
 * The model file at `url` for a craft `sizeM` long: fetched on the first
 * call (the craft needs it now), the same entry ever after.
 */
export function craftModelFile(model: {
	url: string
	sizeM: number
}): ModelFile {
	let file = files.get(model.url)
	if (file === undefined) {
		const entry: ModelFile = {
			state: "loading",
			scene: null,
			coreShare: DEFAULT_CORE_SHARE,
		}
		file = entry
		files.set(model.url, entry)
		loadLoader()
			.then((gltf) => gltf.loadAsync(model.url))
			.then(
				(result) => {
					entry.coreShare = measure(result.scene, model.sizeM)
					entry.scene = result.scene
					entry.state = "ready"
				},
				() => {
					// the diamond stays, for good
					entry.state = "failed"
				},
			)
	}
	return file
}
