/**
 * The Sun's and the planets' textures, part of `pnpm gen:surfaces` (scripts/gen-moon-surfaces.ts
 * calls `generatePlanetTextures`): data/planet-textures.json -> one JPEG per entry under
 * public/assets/textures/. Real maps are downloaded once into .cache/surfaces/ (a page of a huge
 * TIFF is read over byte ranges and cached as PNG), shrunk, turned so the prime meridian is at
 * the centre, and coloured or kept; painted textures come from their recipe and a seed derived
 * from the file name. See docs/ARCHITECTURE.md, "Planet textures".
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, join } from "node:path"
import sharp from "sharp"

import { readFits, readIsisCube } from "./lib/formats"
import { fnv1a32 } from "./lib/hash"
import {
	albedoToLevel,
	closeSeam,
	colourize,
	fillGaps,
	luma,
	mirrorPoles,
	paintBands,
	paintLuminance,
	relative,
	resample,
	rollHalf,
	softClip,
	stretch,
	type Gray,
	type Rgb,
} from "./lib/paint"
import { resolveTextures, type TextureEntry } from "./lib/planetTextures"
import { resolveSurfaces, type Source } from "./lib/surfaces"
import { pickPage, readTiffPage, readTiffPages } from "./lib/tiff"

const JPEG_QUALITY = 82

interface Context {
	root: string
	cache: string
	download: (url: string, file: string) => Promise<void>
	log: (line: string) => void
}

/** The texture's name for `--only` and the cache: "earth_night" for .../earth/earth_night.jpg. */
export const textureName = (path: string): string =>
	path.slice(path.lastIndexOf("/") + 1, -extname(path).length)

type Raster = { gray: Gray } | { rgb: Rgb }

const fromBytes = (
	data: Uint8Array | Buffer,
	width: number,
	height: number,
	channels: number,
): Raster => {
	if (channels === 1) {
		const out = new Float32Array(width * height)
		for (let i = 0; i < out.length; i++) out[i] = data[i] / 255
		return { gray: { width, height, data: out } }
	}
	const out = new Float32Array(width * height * 3)
	for (let i = 0; i < width * height; i++) {
		for (let c = 0; c < 3; c++) out[3 * i + c] = data[channels * i + c] / 255
	}
	return { rgb: { width, height, data: out } }
}

/** An 8-bit image file, resized to width x width/2. */
const readImage = async (file: string, width: number): Promise<Raster> => {
	const { data, info } = await sharp(file, {
		limitInputPixels: false,
		sequentialRead: true,
	})
		.resize(width, width / 2, { fit: "fill", kernel: "lanczos3" })
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true })
	return fromBytes(data, info.width, info.height, info.channels)
}

/** A byte-range reader over HTTP. */
const httpRanges =
	(url: string) =>
	async (offset: number, length: number): Promise<Uint8Array> => {
		for (let attempt = 0; ; attempt++) {
			const response = await fetch(url, {
				headers: {
					range: `bytes=${offset}-${offset + length - 1}`,
					"user-agent":
						"Orbitalia gen:surfaces (https://github.com/h4nz2/Orbitalia)",
				},
			})
			if (response.status === 206) {
				return new Uint8Array(await response.arrayBuffer())
			}
			if (attempt >= 3) throw new Error(`${url}: HTTP ${response.status}`)
		}
	}

const decodeJpeg = async (jpeg: Uint8Array) => {
	const { data, info } = await sharp(jpeg)
		.raw()
		.toBuffer({ resolveWithObject: true })
	return { data: new Uint8Array(data), channels: info.channels }
}

/** The source as a raster of the output size, in the source's own longitude frame. */
const readSource = async (
	entry: TextureEntry,
	source: Source,
	sourceId: string,
	ctx: Context,
): Promise<{ raster: Raster; blank?: Uint8Array }> => {
	const map = entry.map
	if (map === undefined || source.file === undefined) {
		throw new Error(`${sourceId}: no file to read`)
	}
	mkdirSync(ctx.cache, { recursive: true })
	const width = entry.width
	if (map.format === "tiff") {
		const cached = join(ctx.cache, `${sourceId}-${width}.png`)
		if (!existsSync(cached)) {
			ctx.log(`  reading ${source.file} over byte ranges`)
			const read = httpRanges(source.file)
			const page = pickPage(await readTiffPages(read), width)
			ctx.log(`  page ${page.width}x${page.height}`)
			const raster = await readTiffPage(read, page, decodeJpeg)
			await sharp(raster.data, {
				raw: {
					width: raster.width,
					height: raster.height,
					channels: raster.channels as 1 | 3,
				},
			})
				.png()
				.toFile(cached)
		}
		return { raster: await readImage(cached, width) }
	}
	const file = join(
		ctx.cache,
		`${sourceId}${extname(new URL(source.file).pathname) || ".img"}`,
	)
	await ctx.download(source.file, file)
	if (map.format === "fits") {
		const fits = readFits(readFileSync(file))
		const gray = resample(fits, width, width / 2)
		const blank = resample(
			{
				width: fits.width,
				height: fits.height,
				data: Float32Array.from(fits.blank),
			},
			width,
			width / 2,
		)
		// 1 where the source has no data (a blank, or nothing measured)
		const mask = new Uint8Array(gray.data.length)
		for (let i = 0; i < mask.length; i++) {
			mask[i] = blank.data[i] < 0.01 && gray.data[i] > 0 ? 0 : 1
		}
		return { raster: { gray }, blank: mask }
	}
	if (map.format === "isis") {
		const cube = readIsisCube(readFileSync(file))
		const { data, info } = await sharp(cube.data, {
			raw: {
				width: cube.width,
				height: cube.height,
				channels: cube.channels as 1 | 3,
			},
		})
			.resize(width, width / 2, { fit: "fill", kernel: "lanczos3" })
			.raw()
			.toBuffer({ resolveWithObject: true })
		return { raster: fromBytes(data, info.width, info.height, info.channels) }
	}
	return { raster: await readImage(file, width) }
}

/** The raster turned by 180 degrees: the last pixel first, each pixel's channels in order. */
const turn = <T extends Gray | Rgb>(raster: T, channels: 1 | 3): T => {
	const { data } = raster
	const out = new Float32Array(data.length)
	const pixels = data.length / channels
	for (let i = 0; i < pixels; i++) {
		for (let c = 0; c < channels; c++) {
			out[i * channels + c] = data[(pixels - 1 - i) * channels + c]
		}
	}
	return { ...raster, data: out }
}

const toGray = (rgb: Rgb): Gray => {
	const data = new Float32Array(rgb.width * rgb.height)
	for (let i = 0; i < data.length; i++) {
		data[i] = luma(rgb.data[3 * i], rgb.data[3 * i + 1], rgb.data[3 * i + 2])
	}
	return { width: rgb.width, height: rgb.height, data }
}

/** A real map: read, turned to the prime meridian, then kept, coloured or made a mask. */
const processMap = async (
	entry: TextureEntry,
	source: Source,
	sourceId: string,
	ctx: Context,
): Promise<Raster> => {
	const map = entry.map
	if (map === undefined) throw new Error("not a map")
	const read = await readSource(entry, source, sourceId, ctx)
	let raster = read.raster
	let noData = read.blank
	if (map.turn) {
		raster =
			"gray" in raster
				? { gray: turn(raster.gray, 1) }
				: { rgb: turn(raster.rgb, 3) }
		if (noData !== undefined) noData = noData.slice().reverse()
	}
	if (map.seam) {
		const columns = Math.round(entry.width / 48)
		raster =
			"gray" in raster
				? { gray: closeSeam(raster.gray, 1, columns) }
				: { rgb: closeSeam(raster.rgb, 3, columns) }
	}
	if (map.centreLonEast === 180) {
		raster =
			"gray" in raster
				? { gray: rollHalf(raster.gray, 1) }
				: { rgb: rollHalf(raster.rgb, 3) }
		if (noData !== undefined) {
			const rolled = rollHalf(
				{
					width: entry.width,
					height: entry.width / 2,
					data: Float32Array.from(noData),
				},
				1,
			)
			noData = Uint8Array.from(rolled.data)
		}
	}
	if (map.keep) {
		const gamma = map.gamma ?? 1
		const gains = map.balance ?? [1, 1, 1]
		if ("gray" in raster) return raster
		const data = raster.rgb.data.map((v, i) =>
			softClip(Math.max(0, v) ** gamma * gains[i % 3]),
		)
		return { rgb: { ...raster.rgb, data } }
	}
	const gray = "gray" in raster ? raster.gray : toGray(raster.rgb)
	if (map.below !== undefined) {
		const below = map.below
		return {
			gray: { ...gray, data: gray.data.map((v) => (v <= below ? 1 : 0)) },
		}
	}
	let valid: Uint8Array | undefined
	if (map.fill) {
		valid = new Uint8Array(gray.data.length)
		for (let i = 0; i < valid.length; i++) {
			const blank = noData !== undefined && noData[i] === 1
			valid[i] = !blank && gray.data[i] > 0 ? 1 : 0
		}
	}
	let lum = stretch(gray, map.power ?? 1, valid)
	if (valid !== undefined) lum = fillGaps(lum, valid)
	if (map.maxLat !== undefined) lum = relative(mirrorPoles(lum, map.maxLat))
	const level = map.level ?? albedoToLevel(map.albedo ?? 0.3)
	if (map.hue === undefined) throw new Error(`${sourceId}: no hue`)
	return { rgb: colourize(lum, map.hue, map.darkHue, level) }
}

const paint = (entry: TextureEntry, name: string): Raster => {
	const seed = fnv1a32(`${name}:texture`)
	const painted = entry.painted
	if (painted === undefined) throw new Error("not painted")
	if ("bands" in painted)
		return { rgb: paintBands(painted.bands, seed, entry.width) }
	const { recipe } = painted
	return {
		rgb: colourize(
			paintLuminance(recipe, seed, entry.width),
			recipe.hue,
			recipe.darkHue,
			albedoToLevel(recipe.albedo),
		),
	}
}

const encode = async (raster: Raster, file: string): Promise<number> => {
	const img = "gray" in raster ? raster.gray : raster.rgb
	const channels = "gray" in raster ? 1 : 3
	const bytes = Buffer.alloc(img.width * img.height * channels)
	for (let i = 0; i < bytes.length; i++)
		bytes[i] = Math.max(0, Math.min(255, Math.round(img.data[i] * 255)))
	mkdirSync(dirname(file), { recursive: true })
	await sharp(bytes, {
		raw: { width: img.width, height: img.height, channels },
	})
		.jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: "4:2:0" })
		.toFile(file)
	return statSync(file).size
}

/** Makes every texture of data/planet-textures.json (or those named in `only`). */
export const generatePlanetTextures = async (
	only: ReadonlySet<string> | null,
	ctx: Context,
): Promise<void> => {
	const moonSources = resolveSurfaces(
		JSON.parse(
			readFileSync(join(ctx.root, "data", "moon-surfaces.json"), "utf8"),
		),
	).catalogue.sources
	const catalogue = resolveTextures(
		JSON.parse(
			readFileSync(join(ctx.root, "data", "planet-textures.json"), "utf8"),
		),
		moonSources,
	)
	let total = 0
	for (const [path, entry] of Object.entries(catalogue.textures)) {
		const name = textureName(path)
		if (only !== null && !only.has(name)) continue
		const started = Date.now()
		const source = catalogue.sources[entry.source] ?? moonSources[entry.source]
		const raster =
			entry.map === undefined
				? paint(entry, name)
				: await processMap(entry, source, entry.source, ctx)
		const bytes = await encode(raster, join(ctx.root, "public", path))
		total += bytes
		ctx.log(
			`${name}: ${entry.width}x${entry.width / 2}, ${Math.round(bytes / 1024)} KB, ${Date.now() - started} ms`,
		)
	}
	ctx.log(`planet textures: ${Math.round(total / 1024)} KB written`)
}
