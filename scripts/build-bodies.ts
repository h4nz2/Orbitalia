/**
 * pnpm build:data: normalizes data/ourDB.json into src/data/bodies.json.
 *
 * All mapping rules live in scripts/lib/build.ts (pure, unit-tested); this file only
 * does the I/O: read the source, the optional data/rings/<planet>.json files and the
 * curated data/featured-moons.json (#17), the moon surfaces data/moon-surfaces.json (#37) and
 * the Sun's and planets' textures data/planet-textures.json (both give src/data/credits.json, as
 * does data/spacecraft-models.json for the spacecraft's 3D models, #72), check texture and model
 * paths against public/, validate with the zod schema, write, print stats.
 * Warnings go to stderr, the summary to stdout. Exit code 1 on any data error.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { BeltsFile, BodiesFile, CreditsFile } from "../src/data/schema"

import { BuildError, buildBodies } from "./lib/build"
import type { BuildStats } from "./lib/build"
import { toJsonFile } from "./lib/json"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const paths = {
	source: join(root, "data", "ourDB.json"),
	ringsDir: join(root, "data", "rings"),
	featuredMoons: join(root, "data", "featured-moons.json"),
	surfaces: join(root, "data", "moon-surfaces.json"),
	builtSurfaces: join(root, "data", "moon-surfaces.built.json"),
	planetTextures: join(root, "data", "planet-textures.json"),
	spacecraftModels: join(root, "data", "spacecraft-models.json"),
	publicDir: join(root, "public"),
	out: join(root, "src", "data", "bodies.json"),
	beltsOut: join(root, "src", "data", "belts.json"),
	credits: join(root, "src", "data", "credits.json"),
}

const out = (line: string): void => {
	process.stdout.write(`${line}\n`)
}
const err = (line: string): void => {
	process.stderr.write(`${line}\n`)
}

const readJson = (file: string): unknown =>
	JSON.parse(readFileSync(file, "utf8")) as unknown

const printStats = (stats: BuildStats): void => {
	const { perKind } = stats
	out(
		`bodies.json: ${stats.total} bodies (${perKind.star} star, ${perKind.planet} planets, ${perKind.dwarfPlanet} dwarf planets, ${perKind.moon} moons, ${perKind.asteroid} asteroids, ${perKind.comet} comets; ${stats.smallBodiesSkipped} small bodies without real elements left out)`,
	)
	const perPlanet = Object.entries(stats.moonsPerPlanet)
		.map(([id, count]) => `${id} ${count}`)
		.join(", ")
	out(`moons per planet: ${perPlanet}`)
	out(
		`featured moons ${stats.featured}, radiusEstimated ${stats.radiusEstimated}, phaseSynthetic ${stats.phaseSynthetic}, equatorRotated ${stats.equatorRotated}, periodDerived ${stats.periodDerived}, placeholder textures ${stats.placeholderTextures}, rings ${stats.rings}`,
	)
}

const main = (): number => {
	const result = buildBodies(readJson(paths.source), {
		fileExists: (publicPath) =>
			existsSync(join(paths.publicDir, publicPath.replace(/^\/+/, ""))),
		ringsFor: (planetId) => {
			const file = join(paths.ringsDir, `${planetId}.json`)
			return existsSync(file) ? readJson(file) : null
		},
		featuredMoons: readJson(paths.featuredMoons),
		surfaces: readJson(paths.surfaces),
		builtSurfaces: existsSync(paths.builtSurfaces)
			? readJson(paths.builtSurfaces)
			: undefined,
		planetTextures: readJson(paths.planetTextures),
		spacecraftModels: readJson(paths.spacecraftModels),
	})
	for (const warning of result.warnings) err(`warning: ${warning}`)

	const parsed = BodiesFile.safeParse(result.bodies)
	if (!parsed.success) {
		err("bodies.json failed schema validation:")
		for (const issue of parsed.error.issues) {
			err(`  ${issue.path.map(String).join(".")}: ${issue.message}`)
		}
		return 1
	}

	const belts = BeltsFile.safeParse(result.belts)
	if (!belts.success) {
		err("belts.json failed schema validation:")
		for (const issue of belts.error.issues) {
			err(`  ${issue.path.map(String).join(".")}: ${issue.message}`)
		}
		return 1
	}
	const credits = CreditsFile.safeParse(result.credits)
	if (!credits.success) {
		err("credits.json failed schema validation:")
		for (const issue of credits.error.issues) {
			err(`  ${issue.path.map(String).join(".")}: ${issue.message}`)
		}
		return 1
	}

	writeFileSync(paths.out, toJsonFile(result.bodies))
	out(`wrote ${paths.out}`)
	writeFileSync(paths.beltsOut, toJsonFile(result.belts))
	out(`wrote ${paths.beltsOut} (${result.belts.length} belts)`)
	writeFileSync(paths.credits, toJsonFile(result.credits))
	const models = result.credits.filter((credit) => credit.kind === "model")
	out(
		`wrote ${paths.credits} (${result.credits.length - models.length} image sources, ${models.length} model sources)`,
	)
	printStats(result.stats)
	return 0
}

try {
	process.exitCode = main()
} catch (error) {
	if (error instanceof BuildError) {
		err(`error: ${error.message}`)
		process.exitCode = 1
	} else {
		throw error
	}
}
