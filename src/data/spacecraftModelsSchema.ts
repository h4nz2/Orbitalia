/**
 * Zod schema of data/spacecraft-models.json (#72, docs/ARCHITECTURE.md, "Spacecraft",
 * Models): NASA's 3D models of the ten craft, where each comes from, how
 * `pnpm gen:models` (scripts/gen-spacecraft-models.ts) turns it into
 * public/assets/models/spacecraft/<model>.glb, and which model a craft wears when.
 *
 * Every model is normalised by the generator, so whoever draws it needs no
 * per-craft fiddling: the origin is the centre of the craft's bus, one unit is
 * one metre, +Z is the axis that must point (at Earth or the Sun, `points`) and
 * +Y a stable second axis (`axes` says what each is on that craft).
 */
import { z } from "zod"

/** An instant, UTC: `2004-12-25T02:00Z`. */
const instant = z
	.string()
	.regex(
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/,
		"expected YYYY-MM-DDTHH:MMZ",
	)

/** A source axis: "+x", "-y", ... */
export const SourceAxis = z.enum(["+x", "-x", "+y", "-y", "+z", "-z"])
export type SourceAxis = z.infer<typeof SourceAxis>

/** A model's file name without `.glb`: "voyager", "cassini-no-huygens". */
export const MODEL_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

/**
 * Where a model comes from, as for the planets' textures (credit, licence; src/data/credits.json
 * is built from these for the help page), plus the file the generator downloads.
 */
export const ModelSource = z
	.object({
		title: z.string().min(1),
		/** the full credit line, as the source asks for it */
		credit: z.string().min(1),
		/** a few words for a card ("NASA 3D Resources") */
		short: z.string().min(1),
		/** where a person can read about the model */
		url: z.url(),
		/** the file `pnpm gen:models` downloads (a GLB) */
		file: z.url(),
		/** its path in nasa/NASA-3D-Resources, when it comes from there */
		path: z.string().min(1).optional(),
		licence: z.literal("Public domain"),
		licenceUrl: z.url(),
		note: z.string().min(1).optional(),
	})
	.strict()
export type ModelSource = z.infer<typeof ModelSource>

/** A published fact with where it is published. */
const Fact = z
	.object({
		/** the fact in words, with the figures as published */
		note: z.string().min(1),
		url: z.url(),
	})
	.strict()

export const SpacecraftModel = z
	.object({
		/** the id of its entry in `sources` */
		source: z.string().min(1),
		/**
		 * How the source becomes the normalised model: the source axes that become +Z and +Y
		 * (+X completes a right-handed frame), the bus centre in source units (the new origin),
		 * and metres per source unit.
		 */
		normalise: z
			.object({
				z: SourceAxis,
				y: SourceAxis,
				centre: z.tuple([z.number(), z.number(), z.number()]),
				scale: z.number().positive(),
			})
			.strict()
			.refine((frame) => frame.z[1] !== frame.y[1], {
				message: "+Z and +Y must come from different source axes",
			}),
		/** names of source nodes left out (with everything under them) */
		remove: z.array(z.string().min(1)).optional(),
		/**
		 * patches over a NASA insignia or logotype in a texture (NASA's media guidelines keep them
		 * out of the public domain): the texture's name, the box [left, top, right, bottom) in its
		 * source pixels, painted in the colour round it, and what was there
		 */
		paintOver: z
			.array(
				z
					.object({
						texture: z.string().min(1),
						box: z.tuple([
							z.number().int().min(0),
							z.number().int().min(0),
							z.number().int().positive(),
							z.number().int().positive(),
						]),
						what: z.string().min(1),
					})
					.strict(),
			)
			.optional(),
		/** the largest texture side in px (WebP); textures are never enlarged */
		textureSize: z.union([z.literal(256), z.literal(512), z.literal(1024)]),
		/**
		 * the materials whose normal maps are kept (they cost the most bytes, and most parts read the
		 * same without; crinkled foil does not)
		 */
		normalMaps: z.array(z.string().min(1)).optional(),
		/**
		 * the source's normals are replaced by ones with hard edges beyond this angle (degrees):
		 * for CAD-derived models with a normal per face, which neither weld nor simplify
		 */
		creaseAngle: z.number().min(1).max(90).optional(),
		/**
		 * simplification limit as a fraction of `sizeM`, anywhere on the craft: 0.0025 moves no
		 * edge by more than a pixel when the craft is 400 px long
		 */
		simplify: z.number().min(0).max(0.01),
		/**
		 * the simplifier may also collapse across texture seams (within the same error): for a model
		 * whose parts are a patchwork of small texture islands (Europa Clipper's instruments)
		 */
		permissive: z.literal(true).optional(),
		/**
		 * nodes or materials of the source left as they are, not simplified: wires thinner than the
		 * error (Parker's electric antennas) would vanish, surfaces that lie on top of each other
		 * (JWST's black baffle over a gold copy of it) would show through each other
		 */
		exact: z.array(z.string().min(1)).optional(),
		/** what +Z and +Y are on this craft, in words */
		axes: z.object({ z: z.string().min(1), y: z.string().min(1) }).strict(),
		/** what +Z points at in flight */
		points: z.enum(["earth", "sun"]),
		/** the craft's longest real dimension in metres (for "drawn N times bigger") */
		sizeM: z.number().positive(),
		/** where sizeM and the scale come from */
		size: Fact,
		/** turns per minute about +Z, for a craft that spins */
		spinRpm: z.number().positive().optional(),
		spin: Fact.optional(),
		/** what the generator does to this model beyond the common steps */
		note: z.string().min(1),
	})
	.strict()
	.refine(
		(model) => (model.spinRpm === undefined) === (model.spin === undefined),
		{
			message: "a spin rate needs its source (spin) and the other way round",
			path: ["spin"],
		},
	)
export type SpacecraftModel = z.infer<typeof SpacecraftModel>

/** One model a craft wears, from `from` (inclusive) until `until` (exclusive); open ends are open. */
export const CraftModelUse = z
	.object({
		model: z.string().regex(MODEL_ID),
		from: instant.optional(),
		until: instant.optional(),
		/** why the craft changes model then */
		note: z.string().min(1).optional(),
	})
	.strict()
export type CraftModelUse = z.infer<typeof CraftModelUse>

export const SpacecraftModelsFile = z
	.object({
		$comment: z.string().optional(),
		sources: z.record(z.string().min(1), ModelSource),
		/** model id (its file name without .glb) -> how it is made */
		models: z.record(z.string().regex(MODEL_ID), SpacecraftModel),
		/** craft id (data/spacecraft.json) -> its models in time order */
		craft: z.record(z.string().min(1), z.array(CraftModelUse).min(1)),
	})
	.strict()
	.superRefine((file, ctx) => {
		for (const [id, model] of Object.entries(file.models)) {
			if (file.sources[model.source] === undefined) {
				ctx.addIssue({
					code: "custom",
					message: `model "${id}" names an unknown source "${model.source}"`,
					path: ["models", id, "source"],
				})
			}
		}
		for (const [craftId, uses] of Object.entries(file.craft)) {
			uses.forEach((use, i) => {
				if (file.models[use.model] === undefined) {
					ctx.addIssue({
						code: "custom",
						message: `craft "${craftId}" wears an unknown model "${use.model}"`,
						path: ["craft", craftId, i, "model"],
					})
				}
				// the uses tile time: each one ends where the next begins
				const next = uses[i + 1]
				const tiled =
					(i === 0 ? use.from === undefined : true) &&
					(next === undefined
						? use.until === undefined
						: use.until !== undefined && use.until === next.from)
				if (!tiled) {
					ctx.addIssue({
						code: "custom",
						message: `craft "${craftId}": model ${i} must end where the next begins (first open at the start, last open at the end)`,
						path: ["craft", craftId, i],
					})
				}
			})
		}
	})
export type SpacecraftModelsFile = z.infer<typeof SpacecraftModelsFile>

/** Where the generated models live under public/. */
export const SPACECRAFT_MODEL_DIR = "assets/models/spacecraft"

/** At most this many bytes per model file, and for all of them together (#72: phones). */
export const MODEL_BUDGET_BYTES = 300 * 1024
export const MODELS_TOTAL_BUDGET_BYTES = 2 * 1024 * 1024
