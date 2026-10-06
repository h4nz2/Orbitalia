/**
 * pnpm gen:surfaces [--only io,europa,saturn]: data/moon-surfaces.json -> one equirectangular
 * JPEG per moon under public/assets/textures/<planet>/satellites/<id>.jpg, plus
 * data/moon-surfaces.built.json (each map's mean colour and size, read by `pnpm build:data`);
 * then the Sun's and the planets' textures from data/planet-textures.json
 * (scripts/gen-planet-textures.ts; `--only` takes their file names, e.g. earth_night).
 *
 * Real maps are downloaded once into .cache/surfaces/ (gitignored; some sources are 200 MB),
 * shrunk, turned so the prime meridian is at the centre, completed where the spacecraft never
 * looked, coloured and set to the moon's brightness. Painted surfaces come from their recipe
 * and a seed derived from the moon's id, so a rerun gives the same files. The arithmetic is in
 * scripts/lib/paint.ts; see docs/ARCHITECTURE.md, "Moon surfaces".
 */
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { dirname, extname, join, resolve } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

import { generatePlanetTextures } from "./gen-planet-textures"
import { fnv1a32 } from "./lib/hash"
import { toJsonFile } from "./lib/json"
import {
	adjustColour,
	albedoToLevel,
	colourize,
	fillGaps,
	luma,
	meanColor,
	paintLuminance,
	relative,
	rgbToHex,
	rollHalf,
	type Gray,
	type Rgb,
} from "./lib/paint"
import {
	resolveSurfaces,
	surfacePath,
	type MapEntry,
	type ResolvedSurface,
	type Source,
} from "./lib/surfaces"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const paths = {
	catalogue: join(root, "data", "moon-surfaces.json"),
	built: join(root, "data", "moon-surfaces.built.json"),
	cache: join(root, ".cache", "surfaces"),
	public: join(root, "public"),
}

/** JPEG quality: surfaces are soft, so 80 hides the blocks at a fraction of the size. */
const JPEG_QUALITY = 80

/** A pixel of a partial map darker than this (0..1) is "never imaged". */
const NO_DATA_BELOW = 6 / 255

sharp.cache(false)
sharp.concurrency(2)

interface Built {
	color: string
	width: number
	bytes: number
}

const log = (line: string) => process.stdout.write(`${line}\n`)

const download = async (url: string, file: string): Promise<void> => {
	if (existsSync(file)) return
	log(`  downloading ${url}`)
	const response = await fetch(url, {
		headers: {
			"user-agent":
				"Orbitalia gen:surfaces (https://github.com/h4nz2/Orbitalia)",
		},
	})
	if (!response.ok || response.body === null) {
		throw new Error(`${url}: HTTP ${response.status}`)
	}
	await pipeline(
		Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
		createWriteStream(`${file}.part`),
	)
	renameSync(`${file}.part`, file)
}

/** The source image shrunk to width x width/2, as floats 0..1, grey or RGB. */
const readSource = async (
	file: string,
	width: number,
): Promise<{ gray: Gray } | { rgb: Rgb }> => {
	const height = width / 2
	const meta = await sharp(file, { limitInputPixels: false }).metadata()
	const { data, info } = await sharp(file, {
		limitInputPixels: false,
		sequentialRead: true,
	})
		.resize(width, height, { fit: "fill", kernel: "lanczos3" })
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true })
	const channels = info.channels
	const max = meta.depth === "ushort" ? 65535 : 255
	const samples =
		meta.depth === "ushort"
			? new Uint16Array(data.buffer, data.byteOffset, data.length / 2)
			: data
	if (channels === 1) {
		const out = new Float32Array(width * height)
		for (let i = 0; i < out.length; i++) out[i] = samples[i] / max
		return { gray: { width, height, data: out } }
	}
	const out = new Float32Array(width * height * 3)
	for (let i = 0; i < width * height; i++) {
		for (let c = 0; c < 3; c++) out[3 * i + c] = samples[channels * i + c] / max
	}
	// a colour file that is grey in all channels (JPEG "RGB" greys) counts as grey
	let grey = true
	for (let i = 0; i < width * height && grey; i += 97) {
		if (
			Math.abs(out[3 * i] - out[3 * i + 1]) > 0.02 ||
			Math.abs(out[3 * i] - out[3 * i + 2]) > 0.02
		)
			grey = false
	}
	if (grey) {
		const g = new Float32Array(width * height)
		for (let i = 0; i < g.length; i++)
			g[i] = luma(out[3 * i], out[3 * i + 1], out[3 * i + 2])
		return { gray: { width, height, data: g } }
	}
	return { rgb: { width, height, data: out } }
}

const toGray = (rgb: Rgb): Gray => {
	const data = new Float32Array(rgb.width * rgb.height)
	for (let i = 0; i < data.length; i++) {
		data[i] = luma(rgb.data[3 * i], rgb.data[3 * i + 1], rgb.data[3 * i + 2])
	}
	return { width: rgb.width, height: rgb.height, data }
}

/** Pixels that were imaged: brighter than the black a source uses for "no data". */
const imagedMask = (gray: Gray): Uint8Array => {
	const mask = new Uint8Array(gray.data.length)
	for (let i = 0; i < mask.length; i++) {
		mask[i] = gray.data[i] > NO_DATA_BELOW ? 1 : 0
	}
	return mask
}

/** A colour map with its unimaged parts completed, channel by channel from the same places. */
const fillColour = (rgb: Rgb): Rgb => {
	const { width, height } = rgb
	const mask = imagedMask(toGray(rgb))
	const out = new Float32Array(rgb.data.length)
	for (let c = 0; c < 3; c++) {
		const channel = new Float32Array(width * height)
		for (let i = 0; i < channel.length; i++) channel[i] = rgb.data[3 * i + c]
		const filled = fillGaps({ width, height, data: channel }, mask)
		for (let i = 0; i < channel.length; i++) out[3 * i + c] = filled.data[i]
	}
	return { width, height, data: out }
}

const processMap = async (
	entry: MapEntry,
	source: Source,
	sourceId: string,
): Promise<Rgb> => {
	if (source.file === undefined)
		throw new Error(`${sourceId}: no file to download`)
	mkdirSync(paths.cache, { recursive: true })
	const ext = extname(new URL(source.file).pathname) || ".img"
	const file = join(paths.cache, `${sourceId}${ext}`)
	await download(source.file, file)
	const read = await readSource(file, entry.width)
	let raster: { gray: Gray } | { rgb: Rgb } = read
	if (entry.centreLonEast === 180) {
		raster =
			"gray" in raster
				? { gray: rollHalf(raster.gray, 1) }
				: { rgb: rollHalf(raster.rgb, 3) }
	}
	if (entry.keep) {
		return "rgb" in raster
			? raster.rgb
			: colourize(relative(raster.gray), "#808080", undefined, 0.5)
	}
	const level = albedoToLevel(entry.albedo ?? 0.3)
	if ("rgb" in raster) {
		if (entry.colour === undefined) {
			// a colour file used as a grey map: colour it along the hues
			raster = { gray: toGray(raster.rgb) }
		} else {
			return adjustColour(
				entry.fill ? fillColour(raster.rgb) : raster.rgb,
				entry.colour,
				level,
			)
		}
	}
	let gray = raster.gray
	let mask: Uint8Array | undefined
	if (entry.fill) {
		mask = imagedMask(gray)
		gray = fillGaps(gray, mask)
	}
	if (entry.hue === undefined)
		throw new Error(`${sourceId}: a grey map needs a hue`)
	return colourize(relative(gray, mask), entry.hue, entry.darkHue, level)
}

const paint = (surface: Extract<ResolvedSurface, { kind: "painted" }>): Rgb => {
	const seed = fnv1a32(`${surface.id}:surface`)
	const { recipe } = surface
	// family members differ a little in brightness and colour, never in kind
	const jitter =
		surface.family === null ? 0 : ((seed % 1000) / 1000 - 0.5) * 0.3
	const lum = paintLuminance(recipe, seed, surface.width)
	return colourize(
		lum,
		recipe.hue,
		recipe.darkHue,
		albedoToLevel(recipe.albedo * (1 + jitter)),
	)
}

const encode = async (rgb: Rgb, file: string): Promise<number> => {
	const bytes = Buffer.alloc(rgb.width * rgb.height * 3)
	for (let i = 0; i < bytes.length; i++)
		bytes[i] = Math.max(0, Math.min(255, Math.round(rgb.data[i] * 255)))
	mkdirSync(dirname(file), { recursive: true })
	await sharp(bytes, {
		raw: { width: rgb.width, height: rgb.height, channels: 3 },
	})
		.jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: "4:2:0" })
		.toFile(file)
	return statSync(file).size
}

const main = async (): Promise<void> => {
	const args = process.argv.slice(2)
	const onlyArg = args.find((arg) => arg.startsWith("--only"))
	const only =
		onlyArg === undefined
			? null
			: new Set(
					(onlyArg.includes("=")
						? onlyArg.split("=")[1]
						: args[args.indexOf(onlyArg) + 1]
					).split(","),
				)
	const { catalogue, byId } = resolveSurfaces(
		JSON.parse(readFileSync(paths.catalogue, "utf8")),
	)
	const built: Record<string, Built> = existsSync(paths.built)
		? (JSON.parse(readFileSync(paths.built, "utf8")) as Record<string, Built>)
		: {}
	for (const surface of byId.values()) {
		if (only !== null && !only.has(surface.id)) continue
		const started = Date.now()
		const rgb =
			surface.kind === "map"
				? await processMap(
						surface.entry,
						catalogue.sources[surface.sourceId],
						surface.sourceId,
					)
				: paint(surface)
		const file = join(paths.public, surfacePath(surface.planet, surface.id))
		const bytes = await encode(rgb, file)
		built[surface.id] = {
			color: rgbToHex(...meanColor(rgb)),
			width: rgb.width,
			bytes,
		}
		log(
			`${surface.id}: ${rgb.width}x${rgb.height}, ${Math.round(bytes / 1024)} KB, ${Date.now() - started} ms`,
		)
	}
	for (const id of Object.keys(built)) if (!byId.has(id)) delete built[id]
	const sorted = Object.fromEntries(
		Object.entries(built).sort(([a], [b]) => (a < b ? -1 : 1)),
	)
	writeFileSync(paths.built, toJsonFile(sorted))
	const total = Object.values(sorted).reduce(
		(sum, entry) => sum + entry.bytes,
		0,
	)
	log(
		`${Object.keys(sorted).length} surfaces, ${Math.round(total / 1024)} KB in total`,
	)
	await generatePlanetTextures(only, {
		root,
		cache: paths.cache,
		download,
		log,
	})
}

main().catch((error: unknown) => {
	process.stderr.write(
		`error: ${error instanceof Error ? error.message : String(error)}\n`,
	)
	process.exitCode = 1
})
