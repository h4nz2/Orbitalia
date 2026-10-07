/**
 * The dictionary's stories about each world (#53): what it is made of, how hot
 * it gets, its nicknames, where its name comes from and how it was found, for
 * the Sun and the eight planets (`src/data/worlds.json`).
 *
 * The file holds the facts, each with the public source that states it (NASA
 * fact sheets and NASA Science, the WMO archive, etymological dictionaries);
 * the words are content (`src/locales/<locale>/worlds.json`, see
 * `features/solarDictionary/worldText.ts`). Mass and density are not repeated
 * here: they come from the body model (`src/data/bodies.json`), and `heft`
 * records where they are stated. `features/solarDictionary/stories.test.ts`
 * is the contract.
 */
import { z } from "zod"

import worldsJson from "./worlds.json"

const id = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, "letters and digits")
/** The public pages that state a fact; more than one where its words combine several. */
const sources = z.array(z.url({ protocol: /^https$/ })).min(1)
const color = z.string().regex(/^#[0-9a-f]{6}$/, "a #rrggbb colour")

/** One layer of the cut-away picture, from the centre outwards. */
export const WorldLayer = z
	.object({
		/** Also the key of its name in every locale's worlds.json (`layers.<id>`). */
		id,
		/** Its outer edge as a fraction of the world's mean radius; the last layer ends at 1. */
		outer: z.number().gt(0).max(1),
		color,
	})
	.strict()
export type WorldLayer = z.infer<typeof WorldLayer>

/** A temperature as its source states it: in degrees Celsius or in kelvin. */
export const Degrees = z.union([
	z.object({ c: z.number().min(-273.15) }).strict(),
	z.object({ k: z.number().nonnegative() }).strict(),
])
export type Degrees = z.infer<typeof Degrees>

/**
 * What the two ends of a world's range are: day and night (Mercury), the
 * warmest and coldest (Mars), the records measured (Earth), the clouds and
 * near the core (Jupiter, Uranus), the clouds and higher up where no core
 * temperature is published (Saturn, Neptune), the surface and the core (the
 * Sun), or the same day and night (Venus, which has no `low`).
 */
export const TEMPERATURE_RANGES = [
	"dayNight",
	"extremes",
	"records",
	"cloudsCore",
	"cloudLevels",
	"surfaceCore",
	"steady",
] as const
export type TemperatureRange = (typeof TEMPERATURE_RANGES)[number]

/** The pictures a nickname can lead with (features/solarDictionary/icons.ts). */
export const NICKNAME_ICONS = [
	"sun",
	"run",
	"star",
	"twins",
	"world",
	"dot",
	"planet",
	"crown",
	"diamond",
	"rotate",
	"wind",
] as const
export type NicknameIcon = (typeof NICKNAME_ICONS)[number]

export const DISCOVERY_KINDS = [
	/** Seen with the naked eye since ancient times. */
	"ancient",
	/** Our home, known as a planet circling the Sun since `year` (Copernicus). */
	"home",
	/** Found with a telescope in `year`. */
	"telescope",
	/** Predicted by calculation and then found, in `year`. */
	"predicted",
] as const
export type DiscoveryKind = (typeof DISCOVERY_KINDS)[number]

export const World = z
	.object({
		/** The body id (src/data/bodies.json): "sun", "mercury" … "neptune". */
		id,
		madeOf: z
			.object({
				/** The colour of its outside in the cut-away picture. */
				surface: color,
				/** The layers are model estimates, not measured (Venus's core, the giants). */
				estimated: z.literal(true).optional(),
				layers: z
					.array(WorldLayer)
					.min(2)
					.refine(
						(layers) =>
							layers.every(
								(layer, i) => i === 0 || layer.outer > layers[i - 1]!.outer,
							) && layers.at(-1)!.outer === 1,
						"layers grow outwards and the last one ends at the surface (1)",
					),
				sources,
			})
			.strict(),
		/**
		 * The main gases of its air (for the Sun: of the gas it is made of),
		 * largest first, with their shares where the source gives them (not for
		 * Mercury's exosphere).
		 */
		air: z
			.object({
				gases: z
					.array(
						z
							.object({ id, percent: z.number().gt(0).max(100).optional() })
							.strict(),
					)
					.min(1)
					.refine(
						(gases) =>
							gases.every(
								(gas, i) =>
									i === 0 || (gas.percent ?? 0) <= (gases[i - 1]!.percent ?? 0),
							),
						"largest share first",
					),
				/** What the shares count: the volume of the air, or the atoms (the Sun). */
				basis: z.enum(["volume", "atoms"]).optional(),
				sources,
			})
			.strict()
			.refine(
				(air) =>
					(air.basis === undefined) ===
					air.gases.every((gas) => gas.percent === undefined),
				"shares need their basis, and a basis needs shares",
			),
		temperature: z
			.object({
				range: z.enum(TEMPERATURE_RANGES),
				high: Degrees,
				low: Degrees.optional(),
				sources,
			})
			.strict()
			.refine(
				(temperature) =>
					(temperature.range === "steady") === (temperature.low === undefined),
				"a range has a low end, a steady temperature has none",
			),
		nicknames: z
			.array(
				z
					.object({
						/** Also the key of its words (`worlds.<world>.nicknames.<id>`). */
						id,
						icon: z.enum(NICKNAME_ICONS),
						sources,
					})
					.strict(),
			)
			.min(1),
		/** Where the name comes from (the god, or the word). */
		name: z.object({ sources }).strict(),
		/**
		 * Locales whose own name for the world has a story of its own (Erde, Země,
		 * Tierra, Terre), each with its source; the story is that locale's
		 * `worlds.<world>.localName`.
		 */
		localNames: z.record(z.string(), sources).optional(),
		discovery: z
			.object({
				kind: z.enum(DISCOVERY_KINDS),
				year: z.number().int().optional(),
				sources,
			})
			.strict()
			.refine(
				(discovery) =>
					(discovery.kind === "ancient") === (discovery.year === undefined),
				"a year for every discovery but the ancient ones",
			),
		/** Where its mass and density (from the body model) are stated. */
		heft: z.object({ sources }).strict(),
	})
	.strict()
export type World = z.infer<typeof World>

export const WorldsFile = z
	.object({
		$comment: z.string().optional(),
		worlds: z.array(World),
	})
	.strict()
export type WorldsFile = z.infer<typeof WorldsFile>

/** The file as committed (worlds.test.ts validates it rather than every page load). */
export const worldsFile: WorldsFile = worldsJson as WorldsFile

/** The Sun and the eight planets, in the dictionary's order. */
export const WORLDS: readonly World[] = worldsFile.worlds

export const worldById: ReadonlyMap<string, World> = new Map(
	WORLDS.map((world) => [world.id, world]),
)

/** Degrees Celsius of a temperature, whichever unit its source gave. */
export const celsiusOf = (degrees: Degrees): number =>
	"c" in degrees ? degrees.c : degrees.k - 273.15

/** Kelvin of a temperature, whichever unit its source gave. */
export const kelvinOf = (degrees: Degrees): number =>
	"k" in degrees ? degrees.k : degrees.c + 273.15
