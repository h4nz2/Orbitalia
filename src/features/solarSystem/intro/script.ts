/**
 * The opening sequence (#30, docs/ARCHITECTURE.md, "The first ten seconds"):
 * what the camera does, beat by beat, as a plain `playSequence` script.
 *
 * Close on Earth, in true scale, then pull back: the Moon, the inner planets,
 * the whole system, until Earth is far below a pixel and the screen is mostly
 * empty. The last beat switches the scale to Everything visible (the app's
 * default), so the sequence hands over in exactly the view a reset leads to.
 *
 * Slow enough to read (#49): every caption stays up, fully faded in and with
 * the camera and the scale still, for as long as it takes to read it aloud at
 * a calm pace (`readingMs`), timed from its longest translation at the
 * reading level the opening plays in (`captionReadingMs` in ./captions.ts).
 *
 * Pure: no store, no DOM, so the timing and the shots are unit-tested.
 */
import { bodyById } from "@/data"
import { propagate, radToDeg, type ScalePresetId } from "@/sim"
import {
	HOME_SHOT,
	OVERVIEW,
	type SequenceStep,
	type View,
} from "@/store/navigation"
import { simSearchSchema, type SimSearch } from "@/store/simSearch"

/** The beats, in order; each is one step of the sequence and one caption. */
export const INTRO_BEATS = [
	"earth",
	"moon",
	"inner",
	"system",
	"scale",
] as const
export type IntroBeat = (typeof INTRO_BEATS)[number]

/** The scale the pull-back is drawn in: nothing enlarged, nothing squeezed. */
export const INTRO_SCALE: ScalePresetId = "trueScale"
/** The scale the last beat switches to and the sequence hands over in (the app's default). */
export const HANDOVER_SCALE: ScalePresetId = "everythingVisible"
/** The beat at whose start the scale switches to `HANDOVER_SCALE`. */
export const SCALE_BEAT = INTRO_BEATS.indexOf("scale")

/** Length of the animated switch to Everything visible in the last beat, ms. */
export const SCALE_REVEAL_MS = 2500

/**
 * How far the close-up turns away from the Sun (degrees of azimuth): Earth is
 * mostly lit with its terminator in view, never the night side.
 */
export const EARTH_PHASE_DEG = 35

/** How long a caption takes to fade in, ms (the caption's animation, IntroOverlay.tsx); none with reduced motion. */
export const CAPTION_FADE_MS = 600

/**
 * Reading time (#49): `READ_BASE_MS` plus `READ_MS_PER_WORD` for every word
 * (reading aloud at a calm pace, about 130 words a minute), at least
 * `READ_MIN_MS`.
 */
export const READ_MIN_MS = 3500
export const READ_BASE_MS = 1500
export const READ_MS_PER_WORD = 450

/** How long a caption of `words` words stays up, fully in and with nothing moving, ms. */
export const readingMs = (words: number): number =>
	Math.max(READ_MIN_MS, READ_BASE_MS + READ_MS_PER_WORD * words)

/** The words of `text`: what stands between spaces and holds a letter or a digit ("–" and "«" are not words). */
export const countWords = (text: string): number =>
	text.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length

/** The camera move into each beat, ms (0: a cut). */
const MOVE_MS: Record<IntroBeat, number> = {
	earth: 0,
	moon: 2600,
	inner: 3200,
	system: 2800,
	scale: 0,
}

/** Reading time per beat, ms. */
export type ReadingTimes = Readonly<Record<IntroBeat, number>>

export interface IntroOptions {
	/** Azimuth (degrees) from which Earth is seen lit, see `sunlitAzimuthDeg`. */
	earthAzimuthDeg: number
	/**
	 * With reduced motion asked for: the same shots as cuts, the scale switch
	 * a cut as well, and the captions appear without a fade; the reading
	 * time is the same.
	 */
	reducedMotion: boolean
	/** How long each beat's caption must stay readable (`captionReadingMs`). */
	readMs: ReadingTimes
}

/**
 * How long after a beat starts its caption is fully in and nothing moves any
 * more, ms: the move into it, the caption's fade and, in the last beat, the
 * scale switch. The beat's reading time starts there.
 */
export function settleMs(beat: IntroBeat, reducedMotion: boolean): number {
	if (reducedMotion) return 0
	const scale = beat === "scale" ? SCALE_REVEAL_MS : 0
	return Math.max(MOVE_MS[beat], CAPTION_FADE_MS, scale)
}

const earth = bodyById.get("earth")
const moon = bodyById.get("moon")

/** The Moon's mean distance from Earth, true km. */
export const MOON_DISTANCE_KM = moon?.orbit?.semiMajorAxisKm ?? 384_400

/** The Earth-Moon shot frames a sphere this much larger than the Moon's orbit. */
const MOON_FIT_MARGIN = 1.25
/** The inner-planets shot frames a sphere of this radius around the Sun, in TRUE km (2 AU: Mars and a margin). */
export const INNER_FIT_KM = 2 * 149_597_870.7

/** An angle in [-180, 180), degrees. */
const wrapDeg = (deg: number): number =>
	((((deg + 180) % 360) + 360) % 360) - 180

/** Azimuth `a` moved a share `w` of the shorter way toward `b`, degrees. */
export const turnToward = (a: number, b: number, w: number): number =>
	wrapDeg(a + wrapDeg(b - a) * w)

/**
 * The camera azimuth (degrees, camera-controls: 0 = scene +Z) from which Earth
 * at Julian Date `jd` is seen from the Sun's side, turned `EARTH_PHASE_DEG`
 * away, so the close-up shows a mostly lit globe on any date.
 */
export function sunlitAzimuthDeg(jd: number): number {
	if (earth?.orbit == null) return HOME_SHOT.azimuthDeg
	const p = propagate(earth.orbit, jd)
	// Earth -> Sun is -p; camera-controls puts azimuth theta at (sin theta, ., cos theta)
	const towardSun = radToDeg(Math.atan2(-p.x, -p.z))
	return wrapDeg(towardSun + EARTH_PHASE_DEG)
}

/**
 * The opening as a camera sequence. The azimuth turns from the sunlit side of
 * Earth to the overview's home direction over the pull-back, so the sequence
 * ends exactly on the overview a reset shows.
 */
export function introSteps({
	earthAzimuthDeg,
	reducedMotion,
	readMs,
}: IntroOptions): SequenceStep[] {
	const earthView: View = { kind: "body", id: "earth" }
	const az = (share: number) =>
		turnToward(earthAzimuthDeg, HOME_SHOT.azimuthDeg, share)
	const step = (beat: IntroBeat, rest: Omit<SequenceStep, "holdMs">) => {
		const moveMs = reducedMotion ? 0 : MOVE_MS[beat]
		// the hold starts on arrival: whatever of the fade and the scale switch is still running, then the reading
		const stillMs = settleMs(beat, reducedMotion) - moveMs
		return {
			...rest,
			durationMs: moveMs,
			holdMs: stillMs + Math.max(READ_MIN_MS, readMs[beat]),
		}
	}
	return [
		step("earth", {
			view: earthView,
			shot: { azimuthDeg: az(0), elevationDeg: 12, distance: 1 },
		}),
		step("moon", {
			view: earthView,
			shot: { azimuthDeg: az(0.15), elevationDeg: 28 },
			fit: { km: MOON_DISTANCE_KM * MOON_FIT_MARGIN, around: "earth" },
		}),
		step("inner", {
			view: OVERVIEW,
			shot: { azimuthDeg: az(0.55), elevationDeg: 55 },
			fit: { km: INNER_FIT_KM, around: "sun" },
		}),
		step("system", { view: OVERVIEW, shot: HOME_SHOT }),
		step("scale", { view: OVERVIEW, shot: HOME_SHOT }),
	]
}

/** Total length of a sequence of steps with explicit moves and holds, ms. */
export const sequenceLengthMs = (steps: readonly SequenceStep[]): number =>
	steps.reduce(
		(total, step) => total + (step.durationMs ?? 0) + (step.holdMs ?? 0),
		0,
	)

/** Start time of each beat within the opening, ms (for the progress bar). */
export const beatStartsMs = (steps: readonly SequenceStep[]): number[] => {
	let at = 0
	return steps.map((step) => {
		const start = at
		at += (step.durationMs ?? 0) + (step.holdMs ?? 0)
		return start
	})
}

/** The simulation search params (everything but `lang` and `reading`). */
const SIM_PARAMS = Object.keys(simSearchSchema.shape) as (keyof SimSearch)[]

/**
 * True when a link says where to look (a body, a camera, a time, a scale, a
 * layer, a panel, a mode): it opens exactly there and the opening never plays
 * over it. Only the language and the reading level (on every URL) don't count.
 */
export const hasExplicitView = (search: Partial<SimSearch>): boolean =>
	SIM_PARAMS.some((param) => search[param] !== undefined)
