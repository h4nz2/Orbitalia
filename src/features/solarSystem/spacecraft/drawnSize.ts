/**
 * The honest statement in the selected craft's card (issue #73): how much
 * bigger than it is the craft is drawn, or that it is shown as a marker.
 * The scene works the number out every frame (./CraftModels.tsx) and hands
 * it over here at most four times a second, and only when what the card
 * would say changes, so the card never re-renders at the frame rate. The
 * sentence itself is pure (`drawnSentence`), tested in every locale and
 * reading level.
 */
import { create } from "zustand"

import {
	formatCount,
	isSimple,
	type I18n,
	type MessageKey,
	type MessageValues,
} from "@/i18n"

import { roundDrawnFactor } from "./modelSize"

/** How the selected craft is drawn: as its model, `factor` times bigger than it is; as the diamond; or not at all. */
export type CraftDrawnAs = "model" | "marker" | "none"

export interface CraftDrawnState {
	craftId: string | null
	as: CraftDrawnAs
	/** The model's size over the craft's (rounded, `roundDrawnFactor`); 0 unless `as` is "model". */
	factor: number
}

export const useCraftDrawnStore = create<CraftDrawnState>()(() => ({
	craftId: null,
	as: "none",
	factor: 0,
}))

/** The card's number changes at most this often (ms), while dollying or as the craft moves. */
export const DRAWN_UPDATE_MS = 250

let lastUpdateMs = -Infinity

/**
 * Hands the scene's view of the selected craft to the card: at once when the
 * craft or the way it is drawn changes, else when the rounded factor
 * changes, at most every `DRAWN_UPDATE_MS`.
 */
export function publishCraftDrawn(
	craftId: string | null,
	as: CraftDrawnAs,
	factor: number,
	nowMs: number,
): void {
	const state = useCraftDrawnStore.getState()
	const rounded = as === "model" ? roundDrawnFactor(factor) : 0
	if (state.craftId === craftId && state.as === as) {
		if (state.factor === rounded || nowMs - lastUpdateMs < DRAWN_UPDATE_MS) {
			return
		}
	}
	lastUpdateMs = nowMs
	useCraftDrawnStore.setState({ craftId, as, factor: rounded })
}

/** A message and its arguments, ready for `t`. */
export interface Sentence {
	key: MessageKey
	values?: MessageValues
}

/** From this factor on the exact levels say it in words ("2.1 million"). */
const WORDS_FROM = 1e6

/**
 * The factor as the reading level shows it: "more than 100" at `simple`
 * (#51), else two significant digits, in words from a million ("510,000",
 * "37 billion" / "37 Milliarden"). `form` says which, for the languages
 * whose grammar differs ("2 millions de fois", "510 000 fois").
 */
export function formatDrawnFactor(
	factor: number,
	i18n: I18n,
): { n: string; form: "words" | "digits" } {
	if (isSimple(i18n)) return { n: formatCount(factor, i18n), form: "digits" }
	const rounded = roundDrawnFactor(factor)
	if (rounded < WORDS_FROM) return { n: i18n.number(rounded), form: "digits" }
	return {
		n: new Intl.NumberFormat(i18n.formatLocale, {
			notation: "compact",
			compactDisplay: "long",
			maximumSignificantDigits: 2,
		}).format(rounded),
		form: "words",
	}
}

/** What the card says about how the craft is drawn; null when it is not drawn. */
export function drawnSentence(
	as: CraftDrawnAs,
	factor: number,
	i18n: I18n,
): Sentence | null {
	switch (as) {
		case "model":
			return {
				key: "solarSystem.spacecraft.drawnBigger",
				values: formatDrawnFactor(factor, i18n),
			}
		case "marker":
			return { key: "solarSystem.spacecraft.drawnMarker" }
		case "none":
			return null
	}
}
