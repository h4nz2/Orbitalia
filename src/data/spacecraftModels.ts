/**
 * NASA's 3D models of the spacecraft (#72; docs/ARCHITECTURE.md, "Spacecraft", Models): which
 * model a craft wears at a given time, where its file is and how big the craft is. Read from
 * src/data/spacecraftModels.json, the slim part of data/spacecraft-models.json that `pnpm
 * build:data` writes for the app (validated there and by src/data/spacecraftModels.test.ts, so
 * cast here); the generator's catalogue stays out of the bundle.
 *
 * Every model is normalised by `pnpm gen:models`, so nothing here or in the scene needs to know
 * one craft from another: the origin is the centre of the craft's bus, one unit is one metre, +Z
 * is the axis that must point at `points` (Earth: the high-gain antenna; the Sun: Parker's heat
 * shield, JWST's sunshield, Europa Clipper's solar arrays) and +Y a stable second axis. The files
 * are meshopt-compressed: load them with three's GLTFLoader and three-stdlib's MeshoptDecoder
 * (drei's `useGLTF` does both).
 */
import { dateToJD } from "@/sim"
import { assetUrl } from "@/utils/assetUrl"

import {
	SPACECRAFT_MODEL_DIR,
	type CraftModelsFile,
} from "./spacecraftModelsSchema"

import modelsJson from "./spacecraftModels.json"

export { SPACECRAFT_MODEL_DIR }

export interface CraftModel {
	/** the model's id, its file name without `.glb` ("voyager", "cassini-no-huygens") */
	id: string
	/** the GLB's URL (through `assetUrl`, so a sub path works) */
	url: string
	/** the craft's longest dimension, metres (the model's too: one unit is one metre) */
	sizeM: number
	/** what +Z points at in flight */
	points: "earth" | "sun"
	/** turns per minute about +Z, for a craft that spins (Juno) */
	spinRpm?: number
	/** the Julian Dates it is worn from (inclusive) and until (exclusive); open ends are infinite */
	fromJD: number
	untilJD: number
}

const file = modelsJson as CraftModelsFile

const jdOf = (instant: string | undefined, open: number): number =>
	instant === undefined ? open : dateToJD(new Date(instant))

const byCraft: ReadonlyMap<string, readonly CraftModel[]> = new Map(
	Object.entries(file).map(([craftId, uses]) => [
		craftId,
		uses.map((use) => ({
			id: use.id,
			url: assetUrl(use.file),
			sizeM: use.sizeM,
			points: use.points,
			...(use.spinRpm === undefined ? {} : { spinRpm: use.spinRpm }),
			fromJD: jdOf(use.from, -Infinity),
			untilJD: jdOf(use.until, Infinity),
		})),
	]),
)

/** Every model a craft wears, in time order (one for most; Cassini drops Huygens). */
export const craftModels = (craftId: string): readonly CraftModel[] =>
	byCraft.get(craftId) ?? []

/** The model a craft wears at `jd`, or undefined for a craft without one. */
export const craftModelAt = (
	craftId: string,
	jd: number,
): CraftModel | undefined =>
	craftModels(craftId).find((model) => jd >= model.fromJD && jd < model.untilJD)

/** The URL of the model a craft wears at `jd`. */
export const modelUrl = (craftId: string, jd: number): string | undefined =>
	craftModelAt(craftId, jd)?.url
