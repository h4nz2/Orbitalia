/**
 * The scavenger hunt's progress (#34): which hunt is being played, the clue
 * being asked, the hints shown so far and what was found. The questions
 * themselves live in `features/solarSystem/hunt/hunts.ts`; this store only
 * counts, so it stays free of content.
 *
 * Nothing is sent anywhere and there are no accounts. Progress is kept in
 * the tab's sessionStorage, so a reload in the middle of a lesson does not
 * throw the class back to the first clue; closing the tab forgets it. There is
 * no score, no timer and no record of wrong guesses or hints used: this is not
 * a test.
 *
 * Two bits of state are for the scene rather than the panel (#52): the
 * difficulty the chooser shows, and `assist`, on while an Easy clue is on
 * screen, which the labels (pictures beside the names) and the picking
 * (forgiving clicks) read.
 */
import { create } from "zustand"

/**
 * Easy (ages 6–8), Medium (9–11), Tricky (12+): the chooser's filter and each
 * clue's own level (`features/solarSystem/hunt/hunts.ts`).
 */
export const HUNT_DIFFICULTIES = ["easy", "medium", "hard"] as const
export type HuntDifficulty = (typeof HUNT_DIFFICULTIES)[number]

/** Asking a clue, or showing what the class just found. */
export type HuntPhase = "asking" | "found"

/** Feedback on the latest selection that did not solve the clue (never counted). */
export interface HuntGuess {
	bodyId: string
	kind: "almost" | "warm" | "other"
}

export interface HuntProgress {
	/** The hunt being played (a hunt id or question ids joined by "."), or none. */
	key: string | null
	/** Index of the clue being asked; equal to the number of clues when the hunt is done. */
	step: number
	/** Hints shown for the current clue. */
	hints: number
	phase: HuntPhase
	/** The body that solved each clue so far, in order. */
	found: string[]
}

export interface HuntState extends HuntProgress {
	/** The hunt panel is showing (the chooser when no hunt is being played). */
	open: boolean
	/** The panel is folded to its header and the clue, to show more of the scene. */
	collapsed: boolean
	/** The chooser is showing although a hunt is in progress (kept until another one starts). */
	choosing: boolean
	guess: HuntGuess | null
	/** The difficulty the chooser shows; null follows the reading level. */
	difficulty: HuntDifficulty | null
	/**
	 * An Easy clue is on screen: the labels carry pictures and a click near a
	 * body counts (#52). Set by the hunt panel, never stored.
	 */
	assist: boolean
	setDifficulty: (difficulty: HuntDifficulty) => void
	setAssist: (assist: boolean) => void
	setOpen: (open: boolean) => void
	setCollapsed: (collapsed: boolean) => void
	/** Starts `key` from its first clue. */
	start: (key: string) => void
	/** Opens `key`: continues it when it is the hunt in progress, else starts it. */
	resume: (key: string) => void
	/** Shows the chooser; the hunt in progress is kept and can be carried on. */
	browse: () => void
	/** Shows one more hint (at most `available`). */
	hint: (available: number) => void
	/** The clue is solved by `bodyId`. */
	solve: (bodyId: string) => void
	/** A selection that does not solve the clue: kind words, nothing counted. */
	setGuess: (guess: HuntGuess | null) => void
	/** On to the next clue. */
	next: () => void
}

export const HUNT_STORAGE_KEY = "orbitalia.hunt"

const EMPTY: HuntProgress = {
	key: null,
	step: 0,
	hints: 0,
	phase: "asking",
	found: [],
}

const fresh = (key: string): HuntProgress => ({ ...EMPTY, key })

/** Progress read back from storage, or null when it is missing or malformed. */
export function parseProgress(raw: string | null): HuntProgress | null {
	if (raw === null) return null
	try {
		const value = JSON.parse(raw) as Partial<HuntProgress>
		if (
			typeof value.key !== "string" ||
			!Number.isInteger(value.step) ||
			!Number.isInteger(value.hints) ||
			(value.phase !== "asking" && value.phase !== "found") ||
			!Array.isArray(value.found) ||
			!value.found.every((id) => typeof id === "string")
		) {
			return null
		}
		return {
			key: value.key,
			step: Math.max(0, value.step!),
			hints: Math.max(0, value.hints!),
			phase: value.phase,
			found: value.found,
		}
	} catch {
		return null
	}
}

function loadProgress(): HuntProgress {
	try {
		return parseProgress(sessionStorage.getItem(HUNT_STORAGE_KEY)) ?? EMPTY
	} catch {
		return EMPTY
	}
}

function saveProgress({ key, step, hints, phase, found }: HuntProgress): void {
	try {
		if (key === null) sessionStorage.removeItem(HUNT_STORAGE_KEY)
		else {
			const progress: HuntProgress = { key, step, hints, phase, found }
			sessionStorage.setItem(HUNT_STORAGE_KEY, JSON.stringify(progress))
		}
	} catch {
		// storage blocked or full: the hunt still works, it just does not survive a reload
	}
}

export const useHuntStore = create<HuntState>()((set, get) => ({
	...loadProgress(),
	open: false,
	collapsed: false,
	choosing: false,
	guess: null,
	difficulty: null,
	assist: false,
	setDifficulty: (difficulty) => set({ difficulty }),
	setAssist: (assist) => {
		if (get().assist !== assist) set({ assist })
	},
	setOpen: (open) => set({ open, choosing: false }),
	setCollapsed: (collapsed) => set({ collapsed }),
	start: (key) =>
		set({ ...fresh(key), open: true, choosing: false, guess: null }),
	resume: (key) => {
		if (get().key === key) set({ open: true, choosing: false })
		else get().start(key)
	},
	browse: () => set({ choosing: true, collapsed: false }),
	hint: (available) =>
		set((state) => ({ hints: Math.min(available, state.hints + 1) })),
	solve: (bodyId) =>
		set((state) =>
			state.phase === "asking" && state.key !== null
				? {
						phase: "found",
						found: [...state.found.slice(0, state.step), bodyId],
						guess: null,
					}
				: {},
		),
	setGuess: (guess) => set({ guess }),
	next: () =>
		set((state) =>
			state.phase === "found"
				? { step: state.step + 1, hints: 0, phase: "asking", guess: null }
				: {},
		),
}))

useHuntStore.subscribe((state, previous) => {
	if (
		state.key !== previous.key ||
		state.step !== previous.step ||
		state.hints !== previous.hints ||
		state.phase !== previous.phase ||
		state.found !== previous.found
	) {
		saveProgress(state)
	}
})
