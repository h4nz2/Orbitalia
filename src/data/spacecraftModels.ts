/**
 * NASA's 3D models of the spacecraft (#72; docs/ARCHITECTURE.md, "Spacecraft", Models): which
 * model a craft wears at a given time, where its file is and how big the craft is. Read from
 * data/spacecraft-models.json, validated by src/data/spacecraftModels.test.ts, so cast here.
 *
 * Every model is normalised by `pnpm gen:models`, so nothing here or in the scene needs to know
 * one craft from another: the origin is the centre of the craft's bus, one unit is one metre, +Z
 * is the axis that must point at `points` (Earth: the high-gain antenna; the Sun: Parker's heat
 * shield, JWST's sunshield, Europa Clipper's solar arrays) and +Y a stable second axis. The files
 * are meshopt-compressed: load them with three's GLTFLoader and its MeshoptDecoder (drei's
 * `useGLTF` does both).
 */
import { dateToJD } from "@/sim"
import { assetUrl } from "@/utils/assetUrl"

import {
	SPACECRAFT_MODEL_DIR,
	type SpacecraftModelsFile,
} from "./spacecraftModelsSchema"

import modelsJson from "../../data/spacecraft-models.json"

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

const file = modelsJson as unknown as SpacecraftModelsFile

const jdOf = (instant: string | undefined, open: number): number =>
	instant === undefined ? open : dateToJD(new Date(instant))

const byCraft: ReadonlyMap<string, readonly CraftModel[]> = new Map(
	Object.entries(file.craft).map(([craftId, uses]) => [
		craftId,
		uses.map((use) => {
			const model = file.models[use.model]
			return {
				id: use.model,
				url: assetUrl(`${SPACECRAFT_MODEL_DIR}/${use.model}.glb`),
				sizeM: model.sizeM,
				points: model.points,
				...(model.spinRpm === undefined ? {} : { spinRpm: model.spinRpm }),
				fromJD: jdOf(use.from, -Infinity),
				untilJD: jdOf(use.until, Infinity),
			}
		}),
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
