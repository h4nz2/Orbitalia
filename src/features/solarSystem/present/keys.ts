/**
 * The presenter's keyboard (#29): what a teacher at the front of the room, or
 * a presenter remote, can do without a trackpad. These keys come on top of the
 * HUD's own (Space pause, "+"/"-" speed, Left/Right cycle, Escape the way out;
 * see ui/TimeControls, ui/FocusPicker, ui/OverviewButton), which keep working
 * while the controls are hidden because hiding never unmounts them.
 *
 * Backspace is Back (#46, back/back.ts): where you just were, or the tour's
 * previous stop.
 *
 * Presenter remotes send PageDown / PageUp for "next" / "previous"; their
 * "start show" button alternates F5 (a reload: harmless, the whole view is in
 * the URL) and Escape (the way out).
 */
import { planets } from "@/data"
import type { ScalePresetId } from "@/sim"
import { useSimStore } from "@/store/sim"

import { cycleFocus } from "../ui/focusCycle"

export type PresenterCommand =
	| { readonly kind: "step"; readonly direction: 1 | -1 }
	/** 0: the whole system; 1..8: the planets in order from the Sun. */
	| { readonly kind: "view"; readonly index: number }
	| { readonly kind: "start" }
	/** Back to where you just were (#46): the view before, or the tour's previous stop. */
	| { readonly kind: "back" }
	| { readonly kind: "scale" }
	| { readonly kind: "labels" }
	| { readonly kind: "chrome" }
	| { readonly kind: "fullscreen" }
	| { readonly kind: "present" }
	| { readonly kind: "contrast" }
	| { readonly kind: "help" }
	/** Stops the light flash (#38). */
	| { readonly kind: "stopLight" }

/** The key fields a command depends on (a KeyboardEvent has them all). */
export interface KeyLike {
	readonly key: string
	readonly ctrlKey: boolean
	readonly metaKey: boolean
	readonly altKey: boolean
}

const LETTERS: Readonly<Record<string, PresenterCommand>> = {
	r: { kind: "start" },
	s: { kind: "scale" },
	l: { kind: "labels" },
	h: { kind: "chrome" },
	f: { kind: "fullscreen" },
	p: { kind: "present" },
	c: { kind: "contrast" },
	x: { kind: "stopLight" },
}

/**
 * The command a key press stands for, or null. Browser shortcuts (anything
 * with Ctrl, Cmd or Alt) are never taken; Shift is allowed, so "?" and capital
 * letters work on every layout.
 */
export function keyCommand(event: KeyLike): PresenterCommand | null {
	if (event.ctrlKey || event.metaKey || event.altKey) return null
	const { key } = event
	switch (key) {
		case "PageDown":
			return { kind: "step", direction: 1 }
		case "PageUp":
			return { kind: "step", direction: -1 }
		case "Home":
			return { kind: "start" }
		case "Backspace":
			return { kind: "back" }
		case "?":
			return { kind: "help" }
		default:
			break
	}
	if (/^[0-9]$/.test(key)) {
		const index = Number(key)
		return index <= planets.length ? { kind: "view", index } : null
	}
	return LETTERS[key.toLowerCase()] ?? null
}

/** The body number key `index` shows: null for 0 (the whole system). */
export const viewBodyOfKey = (index: number): string | null =>
	index === 0 ? null : (planets[index - 1]?.id ?? null)

/**
 * "Next" / "previous" (PageDown / PageUp). While a scripted sequence runs (a
 * tour, #28), they step through it: next advances a stop that waits for the
 * presenter (or flies back to an interrupted one), previous goes one stop
 * back. Otherwise they cycle the focus like Left / Right. Returns the body
 * now shown, or null when a sequence was stepped or nothing changed.
 */
export function presenterStep(direction: 1 | -1): string | null {
	const state = useSimStore.getState()
	const { sequence } = state
	if (sequence !== null) {
		if (direction === -1) state.goToStep(Math.max(0, sequence.index - 1))
		else if (sequence.phase === "interrupted") state.resumeSequence()
		else state.nextStep()
		return null
	}
	const next = cycleFocus(state.focusId, direction)
	if (next === state.focusId) return null
	return next
}

/** The named scale presets S cycles through, from the readable lie to the truth. */
export const SCALE_CYCLE: readonly ScalePresetId[] = [
	"everythingVisible",
	"textbook",
	"trueScale",
]

/** The preset after `current` in the cycle; any other preset (Big planets, a mix) goes to the first. */
export function nextScalePreset(current: ScalePresetId | null): ScalePresetId {
	const at = current === null ? -1 : SCALE_CYCLE.indexOf(current)
	return SCALE_CYCLE[(at + 1) % SCALE_CYCLE.length]
}
