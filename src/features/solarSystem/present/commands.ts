/**
 * What the presenter's keys do (#29; the keys themselves are in keys.ts).
 * Everything goes through the stores' actions: the camera through the
 * navigation model, time through the clock actions, the scale through its
 * animated switch. Each command returns the sentence the live region reads
 * out (null for none), so a screen-reader user hears what a key did even
 * while the controls are hidden.
 */
import type { I18n } from "@/i18n"
import { useLightStore } from "@/store/light"
import { usePresentationStore } from "@/store/presentation"
import { useScaleStore } from "@/store/scale"
import { useSimStore } from "@/store/sim"

import { switchScale } from "../ui/ScalePanel"
import { nudgeTowardsWalk } from "../walk/walkNudge"
import {
	nextScalePreset,
	presenterStep,
	viewBodyOfKey,
	type PresenterCommand,
} from "./keys"
import { prefersReducedMotion } from "./media"
import { restoreStart } from "./restoreStart"

export interface CommandContext {
	readonly t: I18n["t"]
	/** A body's name in the active language. */
	readonly bodyName: (id: string) => string
	/** Moves jump instead of flying (the viewer prefers reduced motion). */
	readonly instant?: boolean
}

/**
 * Selects and frames a body, like a click (`setFocus`), but jumps when motion
 * should be reduced.
 */
export function showBody(id: string, instant: boolean): void {
	const state = useSimStore.getState()
	state.select(id)
	if (state.view.kind === "body" && state.view.id === id) return
	state.focus(id, instant ? { durationMs: 0 } : undefined)
}

/** Full screen on or off; a browser that refuses is simply left as it is. */
export function toggleFullscreen(): void {
	if (typeof document === "undefined") return
	const request = document.fullscreenElement
		? document.exitFullscreen?.()
		: document.documentElement.requestFullscreen?.()
	void request?.catch(() => undefined)
}

/** Hides or shows the HUD; focus inside a panel that disappears goes back to the page. */
export function setChromeHidden(hidden: boolean): void {
	usePresentationStore.getState().setChromeHidden(hidden)
	if (!hidden || typeof document === "undefined") return
	const active = document.activeElement
	if (active instanceof HTMLElement && active !== document.body) active.blur()
}

export function runCommand(
	command: PresenterCommand,
	context: CommandContext,
): string | null {
	const { t, bodyName } = context
	const instant = context.instant ?? prefersReducedMotion()
	const presentation = usePresentationStore.getState()
	switch (command.kind) {
		case "step": {
			const id = presenterStep(command.direction)
			if (id !== null) {
				showBody(id, instant)
				return t("solarSystem.present.announce.focus", { body: bodyName(id) })
			}
			const { sequence } = useSimStore.getState()
			return sequence === null
				? null
				: t("solarSystem.present.announce.step", {
						n: sequence.index + 1,
						total: sequence.steps.length,
					})
		}
		case "view": {
			const id = viewBodyOfKey(command.index)
			if (id === null) {
				useSimStore.getState().overview(instant ? { durationMs: 0 } : undefined)
				return t("solarSystem.present.announce.overview")
			}
			showBody(id, instant)
			return t("solarSystem.present.announce.focus", { body: bodyName(id) })
		}
		case "start":
			restoreStart(presentation.startSearch ?? {}, instant)
			return t("solarSystem.present.announce.start")
		case "scale": {
			const next = nextScalePreset(useScaleStore.getState().targetId)
			if (instant) useScaleStore.getState().setPreset(next)
			else switchScale(next)
			// the viewer's own switch: the first time to True scale, the walk's tip (#48; never while presenting)
			nudgeTowardsWalk(next)
			return t("solarSystem.present.announce.scale", {
				preset: t(`solarSystem.scale.preset.${next}`),
			})
		}
		case "labels": {
			const { showLabels, setShowLabels } = useSimStore.getState()
			setShowLabels(!showLabels)
			return t(
				showLabels
					? "solarSystem.present.announce.labelsOff"
					: "solarSystem.present.announce.labelsOn",
			)
		}
		case "chrome":
			setChromeHidden(!presentation.chromeHidden)
			return t(
				presentation.chromeHidden
					? "solarSystem.present.announce.chromeShown"
					: "solarSystem.present.announce.chromeHidden",
			)
		case "fullscreen":
			toggleFullscreen()
			return null
		case "present":
			presentation.setPresenting(!presentation.presenting)
			return t(
				presentation.presenting
					? "solarSystem.present.announce.projectorOff"
					: "solarSystem.present.announce.projectorOn",
			)
		case "contrast":
			presentation.setHighContrast(!presentation.highContrast)
			return t(
				presentation.highContrast
					? "solarSystem.present.announce.contrastOff"
					: "solarSystem.present.announce.contrastOn",
			)
		case "help":
			presentation.setHelpOpen(!presentation.helpOpen)
			return null
		case "stopLight": {
			const light = useLightStore.getState()
			if (light.pulse === null) return null
			light.clear()
			return t("solarSystem.present.announce.lightStopped")
		}
	}
}
