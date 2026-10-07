/**
 * The scavenger hunt (#34): clues a class solves by finding a world in the
 * scene and selecting it. Pure: the question bank and the hunts, how a hunt is
 * named in a link, and what a selection means for the clue being asked.
 *
 * The bank is data (`src/data/hunts.json`: ids, difficulties, answers, hunts),
 * the words are content (`src/locales/<locale>/hunts.json`, see `text.ts`), so
 * a teacher adds a clue or a whole hunt by editing those files alone.
 * `hunts.test.ts` is the contract: answers are real bodies, every clue has its
 * words in every locale, every Easy clue its picture.
 */
import { z } from "zod"

import { bodyById } from "@/data"
import huntsJson from "@/data/hunts.json"
import type { ReadingLevel } from "@/i18n"
import { HUNT_DIFFICULTIES, type HuntDifficulty } from "@/store/hunt"

import {
	FRAME_PRESETS,
	FRAME_PRESET_IDS,
	type FramePresetId,
} from "../frame/presets"

/**
 * Easy (ages 6–8), Medium (9–11) and Tricky (12+; `hard` in the data and
 * links), #52. Easy clues are answered by looking, not by knowing.
 */
export const DIFFICULTIES = HUNT_DIFFICULTIES
export type Difficulty = HuntDifficulty

/**
 * The difficulty the chooser opens on, following the ages of the reading
 * levels (simple 6–11 starts with the youngest; standard 12–15 and advanced
 * 16+ are Tricky). A teacher can pick any.
 */
export const DEFAULT_DIFFICULTY: Readonly<Record<ReadingLevel, Difficulty>> = {
	simple: "easy",
	standard: "hard",
	advanced: "hard",
}

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/)

export const HuntQuestion = z
	.object({
		/** Also the key of the clue's words in every locale's hunts.json. */
		id,
		/** Its own difficulty: a teacher's hunt may mix them, and each clue keeps its own help. */
		difficulty: z.enum(DIFFICULTIES),
		/** Body ids that answer the clue; selecting any of them solves it. */
		answers: z.array(z.string()).min(1),
		/**
		 * The body that must be held still (#31) while the answer is selected:
		 * "earth" for a clue about how the sky looks from Earth.
		 */
		frame: z.string().optional(),
		/**
		 * The body whose picture (its own texture, `ui/BodyPicture.tsx`) shows
		 * what to look for, so a child who cannot read yet can play. Every Easy
		 * clue has one.
		 */
		picture: z.string().optional(),
		/**
		 * The planet the hunt takes the camera to before asking (an Easy clue
		 * about its moons: "We are at Jupiter."). Without it an Easy clue is
		 * asked from the overview.
		 */
		at: z.string().optional(),
	})
	.strict()
export type HuntQuestion = z.infer<typeof HuntQuestion>

export const Hunt = z
	.object({
		id,
		/** Question ids in the order they are asked. */
		questions: z.array(id).min(1),
	})
	.strict()
export type Hunt = z.infer<typeof Hunt>

export const HuntFile = z
	.object({ questions: z.array(HuntQuestion), hunts: z.array(Hunt) })
	.strict()
export type HuntFile = z.infer<typeof HuntFile>

/** The bank as committed (validated by hunts.test.ts rather than at load). */
export const huntFile: HuntFile = huntsJson as HuntFile

export const QUESTIONS: readonly HuntQuestion[] = huntFile.questions
export const questionById: ReadonlyMap<string, HuntQuestion> = new Map(
	QUESTIONS.map((question) => [question.id, question]),
)
/** The ready-made hunts, in menu order. */
export const HUNTS: readonly Hunt[] = huntFile.hunts
export const huntById: ReadonlyMap<string, Hunt> = new Map(
	HUNTS.map((hunt) => [hunt.id, hunt]),
)

/** Joins the question ids of a hunt a teacher put together (`?hunt=geysers.oceanMoon`). */
export const CUSTOM_SEPARATOR = "."

/** Whether a clue is Easy: answered by looking, read aloud, with hints that show (#52). */
export const isEasy = (question: Pick<HuntQuestion, "difficulty">): boolean =>
	question.difficulty === "easy"

/** A hunt's difficulty: that of its hardest clue (null for no clues). */
export function difficultyOf(
	questions: readonly Pick<HuntQuestion, "difficulty">[],
): Difficulty | null {
	let hardest = -1
	for (const question of questions) {
		hardest = Math.max(hardest, DIFFICULTIES.indexOf(question.difficulty))
	}
	return hardest < 0 ? null : DIFFICULTIES[hardest]
}

/** The ready-made hunts of one difficulty, in menu order. */
export const huntsOf = (difficulty: Difficulty): readonly Hunt[] =>
	HUNTS.filter(
		(hunt) =>
			difficultyOf(
				hunt.questions.flatMap((qid) => questionById.get(qid) ?? []),
			) === difficulty,
	)

/** A hunt ready to play: a ready-made one (`id`) or one put together from the bank (`id` null). */
export interface ResolvedHunt {
	/** What the link carries: the hunt's id, or its question ids joined by ".". */
	key: string
	id: string | null
	/** Its hardest clue's; each clue keeps its own (a teacher's hunt may mix them). */
	difficulty: Difficulty | null
	questions: readonly HuntQuestion[]
}

/**
 * The hunt a link names: a ready-made hunt's id, or question ids joined by
 * "." in the order they are asked (unknown ids are skipped, repeats dropped);
 * null when nothing is left.
 */
export function resolveHunt(
	key: string | undefined | null,
): ResolvedHunt | null {
	if (key == null || key === "") return null
	const hunt = huntById.get(key)
	if (hunt !== undefined) {
		const questions = hunt.questions.flatMap(
			(qid) => questionById.get(qid) ?? [],
		)
		return {
			key,
			id: hunt.id,
			difficulty: difficultyOf(questions),
			questions,
		}
	}
	const ids = [...new Set(key.split(CUSTOM_SEPARATOR))].filter((qid) =>
		questionById.has(qid),
	)
	if (ids.length === 0) return null
	const questions = ids.map((qid) => questionById.get(qid)!)
	return {
		key: ids.join(CUSTOM_SEPARATOR),
		id: null,
		difficulty: difficultyOf(questions),
		questions,
	}
}

/** The link key of a hunt made of these questions (the builder's ticks), in the bank's order. */
export const customHuntKey = (ids: Iterable<string>): string => {
	const chosen = new Set(ids)
	return QUESTIONS.filter((question) => chosen.has(question.id))
		.map((question) => question.id)
		.join(CUSTOM_SEPARATOR)
}

/** What the hunt watches: the selection, and which body is held still (#31). */
export interface HuntView {
	selectedId: string | null
	frameId: string
}

/** Whether the view answers the clue: an answer is selected (with its frame held still). */
export const solves = (question: HuntQuestion, view: HuntView): boolean =>
	view.selectedId !== null &&
	question.answers.includes(view.selectedId) &&
	(question.frame === undefined || view.frameId === question.frame)

/**
 * What to say about a selection that does not solve the clue, never a
 * penalty: "almost" (the right world, not yet seen from the clue's frame),
 * "warm" (the planet of a moon that answers it) or "other".
 */
export type Guess = "almost" | "warm" | "other"

export function guessOf(question: HuntQuestion, bodyId: string): Guess {
	if (question.answers.includes(bodyId)) return "almost"
	const isParentPlanet =
		bodyById.get(bodyId)?.kind === "planet" &&
		question.answers.some((answer) => bodyById.get(answer)?.parentId === bodyId)
	return isParentPlanet ? "warm" : "other"
}

/**
 * The point of view (#31) "Show me" uses for a clue with a frame: a preset
 * holding that body still and selecting one of the answers (Mars from Earth).
 */
export function showPreset(question: HuntQuestion): FramePresetId | null {
	if (question.frame === undefined) return null
	return (
		FRAME_PRESET_IDS.find((presetId) => {
			const preset = FRAME_PRESETS[presetId]
			return (
				preset.anchorId === question.frame &&
				preset.selectId !== null &&
				question.answers.includes(preset.selectId)
			)
		}) ?? null
	)
}
