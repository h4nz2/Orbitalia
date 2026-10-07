/**
 * Shared bits of the HUD hotkeys (Space, "+"/"-", Left/Right), so a key press
 * meant for a text field or a focused widget never doubles as a scene shortcut.
 */
import { useEffect } from "react"

const EDITABLE =
	"input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='combobox'], [role='listbox'], [role='option']"

const ACTIVATABLE =
	"button, a[href], [role='button'], [role='switch'], [role='radio'], [role='tab'], [role='menuitem']"

/** Widgets that use the arrow keys themselves (tabs, sliders, menus, radio groups). */
const ARROW_WIDGETS =
	"[role='tab'], [role='tablist'], [role='slider'], [role='menu'], [role='menuitem'], [role='radio'], [role='radiogroup']"

const matches = (target: EventTarget | null, selector: string): boolean =>
	target instanceof Element && target.closest(selector) !== null

/** True when the key press belongs to a text field or a widget with its own key handling. */
export const isEditableTarget = (target: EventTarget | null): boolean =>
	matches(target, EDITABLE)

/** True for elements the browser activates with Space/Enter by itself (buttons, links, switches). */
export const isActivatableTarget = (target: EventTarget | null): boolean =>
	matches(target, ACTIVATABLE)

/** True inside a widget that moves with the arrow keys (a stepped tour or opening leaves them their arrows). */
export const isArrowWidgetTarget = (target: EventTarget | null): boolean =>
	matches(target, ARROW_WIDGETS)

/** A key press with a browser modifier (zoom, tabs, ...) is never a HUD hotkey. */
export const hasModifier = (event: KeyboardEvent): boolean =>
	event.ctrlKey || event.metaKey || event.altKey

/**
 * Listens to `keydown` on the window while mounted. Pass a stable handler (a
 * module-level function reading `useSimStore.getState()`), or it re-subscribes every render.
 */
export function useWindowKeydown(
	handler: (event: KeyboardEvent) => void,
): void {
	useEffect(() => {
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [handler])
}
