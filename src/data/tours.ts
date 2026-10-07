/**
 * Guided tours (#28): the tour files in `src/data/tours/*.json`.
 *
 * A tour is content, not code: an ordered list of stops, each saying what the
 * scene shows (a view, a camera, a date, a speed, a scale, the layers, the
 * body held still) while its narration is read. The narration lives in the
 * locales (`src/locales/<locale>/tours.json`, keyed by tour id and stop id), so
 * a new tour is one file here plus its text; `src/data/tours/README.md` is the
 * guide for authors, and `tours.test.ts` checks every file.
 *
 * Plain data and the zod schema only: what a stop does to the scene is
 * `features/solarSystem/tours/plan.ts`.
 */
import { z } from "zod"

/** Named speeds of the time controls (#14), never a number: "month" is one month per second. */
export const TOUR_SPEEDS = [
	"paused",
	"realTime",
	"minute",
	"hour",
	"day",
	"week",
	"month",
	"year",
	"decade",
] as const
export type TourSpeed = (typeof TOUR_SPEEDS)[number]

/** Where the camera stands relative to the sunlight on the body in view. */
export const TOUR_LIGHTS = ["full", "half", "crescent"] as const
export type TourLight = (typeof TOUR_LIGHTS)[number]

/** How the camera gets to a stop: the flight of #18, a smooth glide, or a cut. */
export const TOUR_MOVES = ["fly", "glide", "jump"] as const
export type TourMove = (typeof TOUR_MOVES)[number]

/** Pages a stop may link to: the basketball walk of #25. */
export const TOUR_LINKS = ["solarWalk"] as const
export type TourLink = (typeof TOUR_LINKS)[number]

const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/, "letters and digits")

const TourCamera = z
	.object({
		/** Degrees round the pole of the planets' plane (0 = the home direction). */
		azimuth: z.number().finite().optional(),
		/** Degrees above the planets' plane: 90 looks straight down. */
		elevation: z.number().min(-90).max(90).optional(),
		/** How far out, in multiples of the normal framing (1). */
		distance: z.number().positive().finite().optional(),
		/** Stand so the body is fully lit, half lit or a crescent (sets the azimuth from the date). */
		light: z.enum(TOUR_LIGHTS).optional(),
		/**
		 * Stand on the Earth and look at the body in view (#41): from the point
		 * of the surface facing it, or, at a sky event's time, from where the
		 * event is seen best (the path of totality). Direction and distance
		 * then come from there.
		 */
		from: z.literal("earth").optional(),
		/** The lens: the height of the view in degrees (a telescope's is below 1); default: the normal view. */
		fov: z.number().min(0.001).max(160).optional(),
	})
	.strict()

const TourFit = z
	.object({
		/** Frame this many astronomical units round the centre of the view… */
		au: z.number().positive().finite().optional(),
		/** …or this many kilometres. */
		km: z.number().positive().finite().optional(),
		/** Drawn like distances round this body ("sun": between the planets; default: the Sun for au, else the body in view). */
		around: z.string().optional(),
	})
	.strict()
	.refine((fit) => (fit.au === undefined) !== (fit.km === undefined), {
		message: "a fit needs exactly one of au or km",
	})

const TourTime = z.union([
	z.literal("now"),
	z.object({ moment: z.string() }).strict(),
	/** A sky event (#41, src/data/skyEvents.json): the instant the simulation shows it best. */
	z.object({ event: z.string() }).strict(),
	z
		.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD") })
		.strict(),
])

const TourLayers = z
	.object({
		orbits: z.boolean().optional(),
		labels: z.boolean().optional(),
		moons: z.boolean().optional(),
		markers: z.boolean().optional(),
		orbitNames: z.boolean().optional(),
		/** The long tail of small moons (#17); off shows only the featured ones. */
		allMoons: z.boolean().optional(),
	})
	.strict()

export const TourStop = z
	.object({
		/** Key of the stop's narration in the locales; unique within the tour. */
		id,
		/** "overview" (the whole system) or a body id. */
		view: z.string(),
		camera: TourCamera.optional(),
		fit: TourFit.optional(),
		/** Default: fly from one body to another, else glide. */
		move: z.enum(TOUR_MOVES).optional(),
		/** Travel to a date; kept until a later stop sets another. */
		time: TourTime.optional(),
		/** Kept until a later stop sets another. */
		speed: z.enum(TOUR_SPEEDS).optional(),
		/** Scale preset id (src/sim/scale.ts); kept until a later stop sets another. */
		scale: z.string().optional(),
		/** Hold this body still (#31); it must be the body in view. Only for this stop. */
		frame: z.string().optional(),
		/**
		 * With `frame`: let the trails grow from this stop's date ("restart") or
		 * from a day (`{ "since": "YYYY-MM-DD" }`) instead of showing two years.
		 */
		trails: z
			.union([
				z.literal("restart"),
				z
					.object({
						since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
					})
					.strict(),
			])
			.optional(),
		/** Layer switches; each is kept until a later stop changes it. */
		layers: TourLayers.optional(),
		/** The body to select (its card, label and trail); default: the body in view. null: nothing. */
		select: z.string().nullable().optional(),
		/**
		 * Ride along with this spacecraft (#57, an id of src/data/spacecraft.json):
		 * the camera follows it, its card is shown; `view` names the body whose
		 * neighbourhood it is in. Only for this stop.
		 */
		follow: z.string().optional(),
		/** A button to another page of the app. */
		link: z.enum(TOUR_LINKS).optional(),
		/** With autoplay: seconds to stay after arriving (default: from the narration's length). */
		autoSeconds: z.number().positive().max(120).optional(),
	})
	.strict()

export const TourFile = z
	.object({
		/**
		 * Leaving the tour (its close button, Finish) takes the viewer back to
		 * the view, time, scale and layers they had before it began (a sky event, #41).
		 */
		returnOnExit: z.boolean().optional(),
		/** The file name without `.json`; also the key of the tour's narration. */
		id,
		/** Position in the tour menu, lowest first. */
		order: z.number().finite(),
		stops: z.array(TourStop).min(2),
	})
	.strict()

export type TourStop = z.infer<typeof TourStop>
export type Tour = z.infer<typeof TourFile>
export type TourTime = z.infer<typeof TourTime>
export type TourLayers = z.infer<typeof TourLayers>
export type TourCamera = z.infer<typeof TourCamera>

const files = import.meta.glob<unknown>("./tours/*.json", {
	eager: true,
	import: "default",
})

/** Every tour file by path, unvalidated (for the tests). */
export const tourFiles: Readonly<Record<string, unknown>> = files

/**
 * The tours the app offers, in menu order. A file that does not match the
 * schema is left out (the tests fail on it) instead of breaking the page.
 */
export const TOURS: readonly Tour[] = Object.values(files)
	.map((file) => TourFile.safeParse(file))
	.flatMap((parsed) => (parsed.success ? [parsed.data] : []))
	.sort((a, b) => a.order - b.order)

export const tourById: ReadonlyMap<string, Tour> = new Map(
	TOURS.map((tour) => [tour.id, tour]),
)
