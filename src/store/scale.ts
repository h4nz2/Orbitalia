/**
 * The active scale (docs/ARCHITECTURE.md, "Scale"): which of the engine's
 * named lies (src/sim/scale.ts) the scene is drawn with. The app opens in the
 * default preset, "Everything visible"; true scale is one click away.
 *
 * `scene/ScaleSync.tsx` pushes every change into the Canvas's SimFrame, which
 * derives all display positions and radii from it. React UI (the preset
 * picker, #21) subscribes through selectors; per-frame code reads the SimFrame.
 *
 * Switching presets is an animation, not a jump (#21): `switchTo` starts a
 * `transition` and `scene/ScaleTransition.tsx` calls `stepTransition` once per
 * frame, which moves `scale` along `interpolateScale`. `targetId` names the
 * preset the user chose from the first frame (the picker and the URL show it),
 * while `presetId` is null until the last step lands exactly on the preset.
 */
import { create } from "zustand"

import {
	DEFAULT_SCALE_PRESET,
	HIDES_LONG_TAIL,
	SCALE_PRESETS,
	easeInOutSine,
	interpolateScale,
	isScalePresetId,
	isValidScale,
	presetOf,
	type ScaleFactor,
	type ScalePresetId,
	type ScaleSettings,
} from "@/sim"

import { useSimStore } from "./sim"

/**
 * Length of an animated preset switch. Long enough to watch Earth shrink to a
 * speck and the planets drift apart, short enough not to stall a lesson.
 */
export const SCALE_TRANSITION_MS = 2500

/** A running animated switch to a preset. */
export interface ScaleTransition {
	/** The scale on screen when the switch started (mid-way through another one, possibly). */
	readonly from: ScaleSettings
	readonly to: ScalePresetId
	/** Clock of the caller (performance.now() in the app). */
	readonly startMs: number
	readonly durationMs: number
}

export interface ScaleState {
	/** The settings every display position and radius derives from. */
	scale: ScaleSettings
	/** The preset `scale` equals, or null for a custom mix or a transition in progress. */
	presetId: ScalePresetId | null
	/** The preset the user chose: `presetId` at rest, the destination during a transition, null for a custom mix. */
	targetId: ScalePresetId | null
	/** The animated switch in progress, if any. */
	transition: ScaleTransition | null

	/** Jumps to a named preset (no animation, e.g. a link opening); unknown ids are ignored. */
	setPreset: (id: ScalePresetId) => void
	/**
	 * Animates to a named preset over `durationMs` (0 jumps), starting from
	 * whatever is on screen, even mid-way through another switch. Unknown ids
	 * are ignored, and so is the preset already on screen or on its way.
	 */
	switchTo: (id: ScalePresetId, nowMs: number, durationMs?: number) => void
	/** Advances the running transition to `nowMs`; lands exactly on the preset at the end. */
	stepTransition: (nowMs: number) => void
	/** Replaces the whole scale and stops any transition; invalid settings (see `isValidScale`) are ignored. */
	setScale: (scale: ScaleSettings) => void
	/** Replaces one factor and keeps the other two; an invalid result is ignored. */
	setFactor: <K extends ScaleFactor>(factor: K, value: ScaleSettings[K]) => void
}

export const DEFAULT_SCALE: ScaleSettings = SCALE_PRESETS[DEFAULT_SCALE_PRESET]

/** The scale a transition shows at `nowMs` (eased; exactly the preset once it is over). */
export function transitionScale(
	transition: ScaleTransition,
	nowMs: number,
): ScaleSettings {
	const to = SCALE_PRESETS[transition.to]
	if (!(transition.durationMs > 0)) return to
	const p = (nowMs - transition.startMs) / transition.durationMs
	return interpolateScale(transition.from, to, easeInOutSine(p))
}

export const useScaleStore = create<ScaleState>()((set, get) => ({
	scale: DEFAULT_SCALE,
	presetId: DEFAULT_SCALE_PRESET,
	targetId: DEFAULT_SCALE_PRESET,
	transition: null,

	setPreset: (id) => {
		if (!isScalePresetId(id)) return
		const { presetId, transition } = get()
		if (presetId === id && transition === null) return
		set({
			scale: SCALE_PRESETS[id],
			presetId: id,
			targetId: id,
			transition: null,
		})
	},
	switchTo: (id, nowMs, durationMs = SCALE_TRANSITION_MS) => {
		if (!isScalePresetId(id)) return
		const { presetId, targetId, transition, scale } = get()
		if (transition === null ? presetId === id : targetId === id) return
		if (!(durationMs > 0) || !Number.isFinite(nowMs)) {
			get().setPreset(id)
			return
		}
		set({
			targetId: id,
			transition: { from: scale, to: id, startMs: nowMs, durationMs },
		})
	},
	stepTransition: (nowMs) => {
		const { transition } = get()
		if (transition === null) return
		const scale = transitionScale(transition, nowMs)
		const to = SCALE_PRESETS[transition.to]
		if (scale === to) {
			set({ scale: to, presetId: transition.to, transition: null })
			return
		}
		set({ scale, presetId: presetOf(scale) })
	},
	setScale: (scale) => {
		if (!isValidScale(scale)) return
		const presetId = presetOf(scale)
		// a preset always travels as its frozen object, so identity checks work downstream
		set({
			scale: presetId === null ? scale : SCALE_PRESETS[presetId],
			presetId,
			targetId: presetId,
			transition: null,
		})
	},
	setFactor: (factor, value) => {
		get().setScale({ ...get().scale, [factor]: value })
	},
}))

/** Whether the chosen preset hides the long tail of moons (#54: Poster). */
export const hidesLongTail = (targetId: ScalePresetId | null): boolean =>
	targetId !== null && HIDES_LONG_TAIL.has(targetId)

// the moons a preset hides go from the click on, and come back with the next one
useScaleStore.subscribe((state, previous) => {
	if (state.targetId !== previous.targetId) {
		useSimStore.getState().setLongTailHidden(hidesLongTail(state.targetId))
	}
})

export default useScaleStore
