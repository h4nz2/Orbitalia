/**
 * Generates the 1-D radial ring strip textures (alpha + color) for every ring
 * system described in data/rings/*.json and writes them into public/.
 *
 * Run with `pnpm gen:rings` (tsx). Output is deterministic: the same JSON
 * always yields byte-identical PNGs (no timestamps, fixed zlib level).
 *
 * Texture convention (shared with the renderer's radial ring UVs
 * `u = (r - inner) / (outer - inner)`):
 * - u runs along the image width: texel x covers u in [x / W, (x + 1) / W],
 *   so u = 0 (left edge) is innerRadiusKm and u = 1 (right edge) is
 *   outerRadiusKm. Every row is identical; the height only exists so that
 *   texture filtering behaves.
 * - rings_alpha.png: 8-bit grayscale, value = accumulated band opacity
 *   (1 - product of (1 - opacity)) stored linearly (no sRGB transfer), so it
 *   can be used directly as `alphaMap`.
 * - rings_color.png: 8-bit RGB, the opacity-weighted mix of the band colors
 *   (sRGB, as written in the JSON), black where no band contributes. The
 *   color is dilated by one texel past the band edge so bilinear filtering
 *   does not produce dark fringes where alpha is already fading out.
 * - Each band gets a soft edge of FEATHER_PX texels and is widened to at
 *   least MIN_BAND_PX texels (about its center) so that rings only a few km
 *   wide remain visible at texture resolution.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { deflateSync } from "node:zlib"
import { z } from "zod"

const WIDTH = 2048
const HEIGHT = 4
const MIN_BAND_PX = 3
const FEATHER_PX = 1.5

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const RINGS_DIR = join(ROOT, "data", "rings")
const PUBLIC_DIR = join(ROOT, "public")

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, "expected #rrggbb")

const bandSchema = z
	.strictObject({
		name: z.string().min(1),
		innerKm: z.number().positive(),
		outerKm: z.number().positive(),
		opacity: z.number().min(0).max(1),
		color: hexColor,
	})
	.refine((band) => band.outerKm > band.innerKm, {
		message: "outerKm must be greater than innerKm",
	})

const ringSystemSchema = z
	.strictObject({
		innerRadiusKm: z.number().positive(),
		outerRadiusKm: z.number().positive(),
		textures: z.strictObject({
			alpha: z.string().startsWith("/assets/"),
			color: z.string().startsWith("/assets/"),
		}),
		// read by the build (src/data/schema.ts, Rings), not here
		castsShadow: z.boolean().optional(),
		faint: z.boolean().optional(),
		/** where the radii, opacities and colours come from */
		sources: z.array(z.string().min(1)).optional(),
		bands: z.array(bandSchema).min(1),
	})
	.refine((system) => system.outerRadiusKm > system.innerRadiusKm, {
		message: "outerRadiusKm must be greater than innerRadiusKm",
	})
	.refine(
		(system) =>
			system.bands.every(
				(band) =>
					band.innerKm >= system.innerRadiusKm &&
					band.outerKm <= system.outerRadiusKm,
			),
		{ message: "every band must lie within [innerRadiusKm, outerRadiusKm]" },
	)

type RingSystem = z.infer<typeof ringSystemSchema>

interface Strips {
	/** WIDTH bytes, one per texel */
	alpha: Uint8Array
	/** WIDTH * 3 bytes, RGB per texel */
	rgb: Uint8Array
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const hexToRgb = (hex: string): [number, number, number] => [
	parseInt(hex.slice(1, 3), 16),
	parseInt(hex.slice(3, 5), 16),
	parseInt(hex.slice(5, 7), 16),
]

/**
 * Band coverage of the texel centred at `xc` (in texel coordinates) for a
 * band spanning [x0, x1]: 1 well inside, 0.5 exactly on an edge, 0 beyond
 * FEATHER_PX / 2 outside. The ramp is area preserving, so a band's total
 * coverage equals its width in texels.
 */
const coverage = (xc: number, x0: number, x1: number): number =>
	clamp01(Math.min((xc - x0) / FEATHER_PX + 0.5, (x1 - xc) / FEATHER_PX + 0.5))

function rasterize(system: RingSystem): Strips {
	const kmPerPx = (system.outerRadiusKm - system.innerRadiusKm) / WIDTH
	const transmission = new Float64Array(WIDTH).fill(1)
	const weight = new Float64Array(WIDTH)
	const rgbAccum = new Float64Array(WIDTH * 3)

	for (const band of system.bands) {
		let x0 = (band.innerKm - system.innerRadiusKm) / kmPerPx
		let x1 = (band.outerKm - system.innerRadiusKm) / kmPerPx
		if (x1 - x0 < MIN_BAND_PX) {
			const centre = (x0 + x1) / 2
			x0 = centre - MIN_BAND_PX / 2
			x1 = centre + MIN_BAND_PX / 2
		}
		const [r, g, b] = hexToRgb(band.color)
		const from = Math.max(0, Math.floor(x0 - FEATHER_PX))
		const to = Math.min(WIDTH - 1, Math.ceil(x1 + FEATHER_PX))
		for (let x = from; x <= to; x++) {
			const a = band.opacity * coverage(x + 0.5, x0, x1)
			if (a <= 0) continue
			transmission[x] *= 1 - a
			weight[x] += a
			rgbAccum[x * 3] += a * r
			rgbAccum[x * 3 + 1] += a * g
			rgbAccum[x * 3 + 2] += a * b
		}
	}

	const alpha = new Uint8Array(WIDTH)
	const mixed = new Float64Array(WIDTH * 3)
	for (let x = 0; x < WIDTH; x++) {
		alpha[x] = Math.round((1 - transmission[x]) * 255)
		if (weight[x] > 0) {
			mixed[x * 3] = rgbAccum[x * 3] / weight[x]
			mixed[x * 3 + 1] = rgbAccum[x * 3 + 1] / weight[x]
			mixed[x * 3 + 2] = rgbAccum[x * 3 + 2] / weight[x]
		}
	}

	// Dilate the color by one texel into the empty (black) neighbourhood.
	const rgb = new Uint8Array(WIDTH * 3)
	for (let x = 0; x < WIDTH; x++) {
		let source = x
		if (weight[x] === 0) {
			const left = x > 0 && weight[x - 1] > 0
			const right = x < WIDTH - 1 && weight[x + 1] > 0
			if (left && right) {
				for (let c = 0; c < 3; c++) {
					rgb[x * 3 + c] = Math.round(
						(mixed[(x - 1) * 3 + c] + mixed[(x + 1) * 3 + c]) / 2,
					)
				}
				continue
			}
			if (left) source = x - 1
			else if (right) source = x + 1
			else continue
		}
		for (let c = 0; c < 3; c++) {
			rgb[x * 3 + c] = Math.round(mixed[source * 3 + c])
		}
	}

	return { alpha, rgb }
}

// --- minimal PNG writer (8-bit grayscale or RGB, no filtering) -------------

const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		}
		table[n] = c >>> 0
	}
	return table
})()

const crc32 = (bytes: Uint8Array): number => {
	let crc = 0xffffffff
	for (const byte of bytes) {
		crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
	}
	return (crc ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Buffer): Buffer => {
	const typeBytes = Buffer.from(type, "ascii")
	const length = Buffer.alloc(4)
	length.writeUInt32BE(data.length, 0)
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0)
	return Buffer.concat([length, typeBytes, data, crc])
}

/** `row` holds one scanline (width * channels bytes); it is repeated `height` times. */
function encodePng(
	width: number,
	height: number,
	channels: 1 | 3,
	row: Uint8Array,
): Buffer {
	const stride = width * channels
	if (row.length !== stride) {
		throw new Error(`row has ${row.length} bytes, expected ${stride}`)
	}
	const raw = Buffer.alloc((stride + 1) * height)
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0 // filter type: None
		raw.set(row, y * (stride + 1) + 1)
	}
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8 // bit depth
	ihdr[9] = channels === 1 ? 0 : 2 // color type: grayscale | truecolor
	ihdr[10] = 0 // compression
	ihdr[11] = 0 // filter method
	ihdr[12] = 0 // no interlace
	return Buffer.concat([
		PNG_SIGNATURE,
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	])
}

// --- main ------------------------------------------------------------------

const writePng = (publicPath: string, png: Buffer): string => {
	const target = join(PUBLIC_DIR, publicPath)
	mkdirSync(dirname(target), { recursive: true })
	writeFileSync(target, png)
	return relative(ROOT, target)
}

function main(): void {
	const files = readdirSync(RINGS_DIR)
		.filter((name) => name.endsWith(".json"))
		.sort()
	if (files.length === 0) {
		throw new Error(`no ring definitions found in ${RINGS_DIR}`)
	}
	for (const file of files) {
		const system = ringSystemSchema.parse(
			JSON.parse(readFileSync(join(RINGS_DIR, file), "utf8")),
		)
		const strips = rasterize(system)
		const alphaPath = writePng(
			system.textures.alpha,
			encodePng(WIDTH, HEIGHT, 1, strips.alpha),
		)
		const colorPath = writePng(
			system.textures.color,
			encodePng(WIDTH, HEIGHT, 3, strips.rgb),
		)
		const kmPerPx = (system.outerRadiusKm - system.innerRadiusKm) / WIDTH
		const bands = system.bands
			.map(
				(band) =>
					`${band.name} (${((band.outerKm - band.innerKm) / kmPerPx).toFixed(1)} px)`,
			)
			.join(", ")
		process.stdout.write(
			`${basename(file, ".json")}: ${WIDTH}x${HEIGHT}, ${kmPerPx.toFixed(2)} km/px, ` +
				`${system.bands.length} bands [${bands}]\n  -> ${alphaPath}\n  -> ${colorPath}\n`,
		)
	}
}

main()
