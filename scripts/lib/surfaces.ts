/**
 * The moon surface catalogue (#37): data/moon-surfaces.json read, validated and resolved
 * per moon. Pure; `pnpm gen:surfaces` (scripts/gen-moon-surfaces.ts) turns it into image
 * files and `pnpm build:data` into `Body.textures` / `Body.surface` and
 * src/data/credits.json. See docs/ARCHITECTURE.md, "Moon surfaces".
 */
import { z } from "zod"

import type { ImageCredit } from "../../src/data/schema"

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i)

export const Source = z.object({
	title: z.string().min(1),
	/** the full credit line, as the source asks for it */
	credit: z.string().min(1),
	/** a few words for the moon's card ("Voyager 2 · NASA/JPL/USGS") */
	short: z.string().min(1),
	/** where a person can read about the source */
	url: z.url(),
	/** the file `pnpm gen:surfaces` downloads; painted surfaces have none */
	file: z.url().optional(),
	licence: z.string().min(1),
	licenceUrl: z.url(),
	note: z.string().min(1).optional(),
})
export type Source = z.infer<typeof Source>

export const Recipe = z.object({
	pattern: z.enum(["cratered", "smooth", "haze"]),
	/** geometric albedo; sets the painted brightness (`albedoToLevel`) */
	albedo: z.number().positive().max(1.5),
	/** the colour of the bright surface */
	hue: Hex,
	/** the colour the darkest parts shade into (default: `hue`) */
	darkHue: Hex.optional(),
	/** crater density relative to the pattern's default */
	craters: z.number().positive().optional(),
})
export type Recipe = z.infer<typeof Recipe>

export const MapEntry = z
	.object({
		planet: z.string().min(1),
		source: z.string().min(1),
		/** output width in px; the height is half */
		width: z.union([z.literal(512), z.literal(1024), z.literal(2048)]),
		/** east longitude at the horizontal centre of the source image (0 or 180) */
		centreLonEast: z.union([z.literal(0), z.literal(180)]),
		/** only resize and re-encode (the Moon: the source is already what we want) */
		keep: z.literal(true).optional(),
		albedo: z.number().positive().max(1.5).optional(),
		/** a grey source is coloured from `darkHue` (dark) to `hue` (bright) */
		hue: Hex.optional(),
		darkHue: Hex.optional(),
		/** a colour source keeps this fraction of its colour (0 grey .. 1 as published) */
		colour: z.number().min(0).max(1).optional(),
		/** the source has no-data areas (black) that must be filled in to match */
		fill: z.literal(true).optional(),
		/**
		 * part of this moon has never been photographed (the map is completed there, by us with
		 * `fill` or by the source's authors); the app says so on the moon's card
		 */
		unseen: z.literal(true).optional(),
	})
	.refine((entry) => entry.keep === true || entry.albedo !== undefined, {
		message: "a processed map needs an albedo",
	})
	.refine(
		(entry) =>
			entry.keep === true ||
			(entry.hue === undefined) !== (entry.colour === undefined),
		{ message: "a map is either grey (hue) or colour (colour), not both" },
	)
export type MapEntry = z.infer<typeof MapEntry>

export const PaintedEntry = z.object({
	planet: z.string().min(1),
	recipe: Recipe,
	basis: z.string().min(1),
})

export const Family = z.object({
	planet: z.string().min(1),
	members: z.array(z.string().min(1)).min(1),
	recipe: Recipe,
	basis: z.string().min(1),
})

export const SurfaceCatalogue = z.object({
	$comment: z.string().optional(),
	sources: z.record(z.string(), Source),
	maps: z.record(z.string(), MapEntry),
	painted: z.record(z.string(), PaintedEntry),
	families: z.record(z.string(), Family),
})
export type SurfaceCatalogue = z.infer<typeof SurfaceCatalogue>

/** The source id every painted surface is credited to. */
export const PAINTED_SOURCE = "orbitalia-painted"

/** Output widths of painted surfaces: a featured moon is looked at up close, the long tail rarely. */
export const PAINTED_WIDTH = { featured: 1024, family: 512 } as const

/** One moon's surface, resolved from the catalogue. */
export type ResolvedSurface =
	| {
			kind: "map"
			id: string
			planet: string
			sourceId: string
			entry: MapEntry
			/** part of the moon was never photographed; the map is completed there */
			filled: boolean
	  }
	| {
			kind: "painted"
			id: string
			planet: string
			sourceId: typeof PAINTED_SOURCE
			recipe: Recipe
			/** the family it belongs to, or null for a moon painted on its own */
			family: string | null
			basis: string
			width: number
	  }

/** Public path of a moon's surface image. */
export const surfacePath = (planet: string, id: string): string =>
	`/assets/textures/${planet}/satellites/${id}.jpg`

/**
 * Validates the catalogue and resolves every moon in it. Throws on a malformed file, an
 * unknown source, or a moon listed twice.
 */
export const resolveSurfaces = (
	raw: unknown,
): { catalogue: SurfaceCatalogue; byId: Map<string, ResolvedSurface> } => {
	const parsed = SurfaceCatalogue.safeParse(raw)
	if (!parsed.success) {
		const issue = parsed.error.issues[0]
		throw new Error(
			`data/moon-surfaces.json: ${issue.path.map(String).join(".")}: ${issue.message}`,
		)
	}
	const catalogue = parsed.data
	if (catalogue.sources[PAINTED_SOURCE] === undefined) {
		throw new Error(
			`data/moon-surfaces.json: the source "${PAINTED_SOURCE}" is missing`,
		)
	}
	const byId = new Map<string, ResolvedSurface>()
	const add = (surface: ResolvedSurface) => {
		if (byId.has(surface.id)) {
			throw new Error(
				`data/moon-surfaces.json: "${surface.id}" has more than one surface`,
			)
		}
		byId.set(surface.id, surface)
	}
	for (const [id, entry] of Object.entries(catalogue.maps)) {
		if (catalogue.sources[entry.source] === undefined) {
			throw new Error(
				`data/moon-surfaces.json: "${id}" uses the unknown source "${entry.source}"`,
			)
		}
		add({
			kind: "map",
			id,
			planet: entry.planet,
			sourceId: entry.source,
			entry,
			filled: entry.unseen === true,
		})
	}
	for (const [id, entry] of Object.entries(catalogue.painted)) {
		add({
			kind: "painted",
			id,
			planet: entry.planet,
			sourceId: PAINTED_SOURCE,
			recipe: entry.recipe,
			family: null,
			basis: entry.basis,
			width: PAINTED_WIDTH.featured,
		})
	}
	for (const [family, entry] of Object.entries(catalogue.families)) {
		for (const id of entry.members) {
			add({
				kind: "painted",
				id,
				planet: entry.planet,
				sourceId: PAINTED_SOURCE,
				recipe: entry.recipe,
				family,
				basis: entry.basis,
				width: PAINTED_WIDTH.family,
			})
		}
	}
	return { catalogue, byId }
}

/**
 * The credits list for src/data/credits.json: every source that at least one body uses, with
 * the bodies (in data order) that show it. Sources nobody uses are left out.
 */
export const creditsOf = (
	catalogue: Pick<SurfaceCatalogue, "sources">,
	usage: ReadonlyArray<{ bodyId: string; sourceId: string }>,
): ImageCredit[] => {
	const bodiesBySource = new Map<string, string[]>()
	for (const { bodyId, sourceId } of usage) {
		const list = bodiesBySource.get(sourceId)
		if (list === undefined) bodiesBySource.set(sourceId, [bodyId])
		else list.push(bodyId)
	}
	const credits: ImageCredit[] = []
	for (const [id, source] of Object.entries(catalogue.sources)) {
		const bodies = bodiesBySource.get(id)
		if (bodies === undefined) continue
		credits.push({
			id,
			// the moons' painted source, and the planets' ("orbitalia-painted-bands")
			kind: id.startsWith(PAINTED_SOURCE) ? "painted" : "map",
			title: source.title,
			credit: source.credit,
			short: source.short,
			url: source.url,
			licence: source.licence,
			licenceUrl: source.licenceUrl,
			...(source.note === undefined ? {} : { note: source.note }),
			bodies,
		})
	}
	return credits
}
