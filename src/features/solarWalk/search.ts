/**
 * Search params of `/solar_walk?sun=orange&landmark=track&view=table` (#25)
 * and `&focus=jupiter` (#48).
 *
 * Kept free of app imports (only zod) because the route module that validates
 * the URL is loaded eagerly with the route tree; the walk and the body data
 * stay in the page's code-split chunk. Defaults are left out of the URL and
 * unknown values fall back to them.
 */
import { z } from "zod"

/** The objects the Sun can be, smallest first (sizes in walk.ts). */
export const SUN_OBJECT_IDS = [
	"orange",
	"football",
	"basketball",
	"exerciseBall",
] as const
export type SunObjectId = (typeof SUN_OBJECT_IDS)[number]
export const DEFAULT_SUN_OBJECT: SunObjectId = "basketball"

/** Real ground to measure the walk against (lengths in walk.ts). */
export const LANDMARK_IDS = ["pitch", "track"] as const
export type LandmarkId = (typeof LANDMARK_IDS)[number]
/** What the landmark picker offers: a landmark, or metres alone. */
export const LANDMARK_OPTIONS = ["none", ...LANDMARK_IDS] as const
export type LandmarkOption = (typeof LANDMARK_OPTIONS)[number]
export const DEFAULT_LANDMARK: LandmarkOption = "pitch"

/** The walk (the experience) or the table (to project or print). */
export const WALK_VIEWS = ["walk", "table"] as const
export type WalkView = (typeof WALK_VIEWS)[number]
export const DEFAULT_WALK_VIEW: WalkView = "walk"

/**
 * Every body the walk has a line for (#48): the Sun, the planets and their
 * big moons. `?focus=<id>` opens the walk on that line, so a world's card can
 * link straight to its place on the school field. Listed here, not derived
 * from the data, to keep this module light; walk.test.ts holds it to the walk.
 */
export const WALK_FOCUS_IDS = [
	"sun",
	"mercury",
	"venus",
	"earth",
	"moon",
	"mars",
	"jupiter",
	"io",
	"europa",
	"ganymede",
	"callisto",
	"saturn",
	"titan",
	"uranus",
	"neptune",
	"triton",
] as const
export type WalkFocusId = (typeof WALK_FOCUS_IDS)[number]

const WALK_FOCUS_SET: ReadonlySet<string> = new Set(WALK_FOCUS_IDS)

/** Whether the walk has a line for this body. */
export const isWalkFocusId = (id: string): id is WalkFocusId =>
	WALK_FOCUS_SET.has(id)

export const solarWalkSearchSchema = z.object({
	sun: z.enum(SUN_OBJECT_IDS).optional().catch(undefined),
	landmark: z.enum(LANDMARK_OPTIONS).optional().catch(undefined),
	view: z.enum(WALK_VIEWS).optional().catch(undefined),
	focus: z.enum(WALK_FOCUS_IDS).optional().catch(undefined),
})

export type SolarWalkSearch = z.output<typeof solarWalkSearchSchema>
