/**
 * A tap on the sky hides the controls on a touch screen, and the next tap
 * anywhere brings them back (#59; docs/ARCHITECTURE.md, "HUD layout"). Apple's
 * "going full screen": when the content is the point, the controls step aside
 * and a tap calls them back. A mouse never does this: on a laptop a click on
 * empty space keeps doing nothing (#47), and a teacher presenting with the
 * controls hidden still clicks planets to fly there.
 *
 * - **Hiding** is never automatic: only a tap on empty space that has no other
 *   job hides (`skyTapHides`). Letting go of a second selected body (#47)
 *   comes first; a near miss beside a small body, a tap while the opening
 *   plays (it pauses the opening, #49) or its hints say "Tap a planet", while
 *   the hunt's panel is up (the clue is the point) or while the quick look
 *   asks or plays never hides. Nor does the tap that closes a menu, a popover
 *   or a hint. During a tour it may hide:
 *   hiding never stops the time or the tour.
 * - **The tap that brings them back** does that alone (`tapRestores`): it is
 *   swallowed in the capture phase before the scene's own click, so it never
 *   selects or focuses a body and never moves the camera. A drag while hidden
 *   is no tap: it still turns the view.
 * - The tap rules are `scene/tap.ts`'s: the travel allowance, the end of a
 *   pinch and the click that focused the window are never taps.
 *
 * The mechanism is #29's: `setChromeHidden`, `data-chrome="hidden"`, H, and
 * the "Show the controls" button for keyboards and screen readers.
 */
import { useEffect } from "react"

import { useHuntStore } from "@/store/hunt"
import { usePresentationStore } from "@/store/presentation"
import { useTourStore } from "@/store/tour"
import { isTouch } from "@/utils/sizeClasses"

import { useIntroStore } from "../intro/intro"
import { isQuickLook, useQuickLookStore } from "../quickLook/quickLook"
import { isTapClick, pointerKindOf, type PointerKind } from "../scene/tap"
import { setChromeHidden } from "./commands"

/** What decides whether a tap hides or brings back the controls. */
export interface SkyTapContext {
	/** The screen's primary pointer is a finger (`$touch`): phones and tablets. */
	touch: boolean
	/** The pointer of this tap. */
	pointer: PointerKind
	/** The controls are hidden now. */
	hidden: boolean
	/** The opening plays (#30): a tap pauses it (#49). */
	opening: boolean
	/** The opening's hints on how to move around are up ("Tap a planet"). */
	introHints: boolean
	/** The hunt's panel is up (#34): its clue is the point. */
	hunt: boolean
	/** The quick look (#44) asks its question or plays. */
	quickLook: boolean
	/** The press closed something: an open menu, popover or hint. */
	dismissing: boolean
}

const byFinger = (context: Pick<SkyTapContext, "touch" | "pointer">) =>
	context.touch && context.pointer !== "mouse"

/**
 * Whether a tap on empty space that has no other job (it let go of nothing,
 * #47, and was no near miss) hides the controls. Pure.
 */
export const skyTapHides = (context: SkyTapContext): boolean =>
	byFinger(context) &&
	!context.hidden &&
	!context.opening &&
	!context.introHints &&
	!context.hunt &&
	!context.quickLook &&
	!context.dismissing

/** Whether a tap, anywhere, only brings the hidden controls back. Pure. */
export const tapRestores = (
	context: Pick<SkyTapContext, "touch" | "pointer" | "hidden" | "opening">,
): boolean => byFinger(context) && context.hidden && !context.opening

/** Something a press outside it closes: an open menu, popover, list or hint. */
const DISMISSIBLE = [
	".mantine-Popover-dropdown",
	".mantine-Menu-dropdown",
	".mantine-Combobox-dropdown",
	"[role=tooltip]:not([hidden])",
].join(",")

/** Whether the press under way went down while something it closes was open. */
let pressDismisses = false

const currentContext = (event: Event): SkyTapContext => ({
	touch: isTouch(),
	pointer: pointerKindOf(event),
	hidden: usePresentationStore.getState().chromeHidden,
	opening: useIntroStore.getState().status === "playing",
	introHints: useIntroStore.getState().hints,
	hunt: useHuntStore.getState().open,
	quickLook:
		useQuickLookStore.getState().asking ||
		isQuickLook(useTourStore.getState().tour?.id),
	dismissing: pressDismisses,
})

/** Says a change to screen readers (installed by `useSkyTap`). */
let announceChrome: ((hidden: boolean) => void) | null = null

/**
 * The scene's tap on empty space had no other job (`scene/BodyPicking.tsx`):
 * on a touch screen it hides the controls. Returns whether it did.
 */
export function hideOnSkyTap(event: Event): boolean {
	if (!skyTapHides(currentContext(event))) return false
	setChromeHidden(true)
	announceChrome?.(true)
	return true
}

/** Notes, as a press goes down, whether it closes something rather than tapping the sky. */
function onPress(): void {
	if (typeof document === "undefined") return
	// some stay in the page while closed (a select's list): only what shows counts
	pressDismisses = [...document.querySelectorAll(DISMISSIBLE)].some(
		(element) => element.getClientRects().length > 0,
	)
}

/**
 * Installs the tap that brings the controls back (capture phase, so it comes
 * before the scene's own click) and the press watch that keeps a tap closing
 * a menu from also hiding the controls. `announce` tells screen readers what
 * a tap did.
 */
export function useSkyTap(announce: (hidden: boolean) => void): void {
	useEffect(() => {
		announceChrome = announce
		const onClick = (event: MouseEvent) => {
			if (!tapRestores(currentContext(event)) || !isTapClick(event)) return
			// the "Show the controls" button does the same by itself
			if (
				event.target instanceof Element &&
				event.target.closest("button, a[href], [role=dialog]") !== null
			)
				return
			event.preventDefault()
			event.stopImmediatePropagation()
			setChromeHidden(false)
			announce(false)
		}
		const options = { capture: true }
		window.addEventListener("pointerdown", onPress, options)
		window.addEventListener("click", onClick, options)
		return () => {
			if (announceChrome === announce) announceChrome = null
			window.removeEventListener("pointerdown", onPress, options)
			window.removeEventListener("click", onClick, options)
		}
	}, [announce])
}
