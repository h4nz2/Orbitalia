/**
 * "A tap selects, a drag does not" (docs/ARCHITECTURE.md, "Picking"): the
 * one rule every clickable thing in the scene applies. A finger wobbles more
 * than a mouse between press and release, so the allowance depends on the
 * pointer type, and it is measured on the whole path of the press: a drag
 * that wanders off and comes back to where it started is still a drag. A
 * press held as long as you like is still a tap while it stays within the
 * allowance (a small, slow, shaky finger).
 *
 * Two presses are never taps (#47):
 * - one with more than one finger down at any moment: the end of a pinch,
 *   when one finger lifts first and the other follows, is not a tap;
 * - one that only brought the window into focus (a teacher clicking the app
 *   to the front): the page had no focus when it went down, or the window
 *   came into focus within `FOCUS_CLICK_MS` before it or while it was held.
 *
 * The camera follows the same rule (#49): a press takes it only once it is
 * a gesture (`isPressGrab`: it wandered beyond the allowance, or a second
 * finger joined), so a tap never grabs the camera.
 */

/** Longest travel between press and release that is still a tap, px. */
export const TAP_MAX_TRAVEL_PX = { mouse: 4, pen: 8, touch: 12 } as const

/**
 * A press this soon after the window came into focus is the click that
 * brought it there, ms. The window's focus event and the press it came with
 * arrive within a few milliseconds of each other, in either order.
 */
export const FOCUS_CLICK_MS = 500

export type PointerKind = keyof typeof TAP_MAX_TRAVEL_PX

const isPointerKind = (value: unknown): value is PointerKind =>
	value === "mouse" || value === "pen" || value === "touch"

export const isTap = (travelPx: number, kind: PointerKind): boolean =>
	travelPx <= TAP_MAX_TRAVEL_PX[kind]

/** The fields of a pointer event the tracker reads. */
export type PressInput = Pick<
	PointerEvent,
	| "pointerId"
	| "pointerType"
	| "isPrimary"
	| "clientX"
	| "clientY"
	| "timeStamp"
>

/**
 * Whether a press went down while the page had no focus, or the window came
 * into focus (at `focusedAt`) shortly before the press went down (at `at`)
 * or after it: then it is the click that brought the window to the front.
 */
export const isFocusPress = (
	press: { at: number; hadFocus: boolean },
	focusedAt: number,
): boolean => !press.hadFocus || focusedAt > press.at - FOCUS_CLICK_MS

/**
 * Follows the presses on the page (pure, fed by window listeners below and by
 * the unit tests): where the current press started, how far it has wandered,
 * whether a second finger joined it, and whether it focused the window.
 */
export function createPressTracker() {
	/** The kind of pointer that moved or pressed last (hover has no press). */
	let lastKind: PointerKind = "mouse"
	/** When the window last came into focus (an event time stamp). */
	let focusedAt = -Infinity
	/** The current (or last) press. */
	const press = {
		id: -1,
		kind: "mouse" as PointerKind,
		x: 0,
		y: 0,
		travel: 0,
		at: 0,
		hadFocus: true,
		/** another pointer went down while this one was held: a pinch or a palm */
		multi: false,
	}

	return {
		/** The window came into focus. */
		focus(timeStamp: number): void {
			focusedAt = timeStamp
		},
		/** A pointer went down; `hasFocus`: the page had focus at that moment. */
		down(event: PressInput, hasFocus: boolean): void {
			if (isPointerKind(event.pointerType)) lastKind = event.pointerType
			// a second finger: the press it joins is a gesture now, until every finger is up
			// (the browser's primary pointer is the first one down while no other is)
			if (!event.isPrimary) {
				press.multi = true
				return
			}
			press.id = event.pointerId
			if (isPointerKind(event.pointerType)) press.kind = event.pointerType
			press.x = event.clientX
			press.y = event.clientY
			press.travel = 0
			press.at = event.timeStamp
			press.hadFocus = hasFocus
			press.multi = false
		},
		/** A pointer moved (with or without a button held). */
		move(event: PressInput): void {
			if (isPointerKind(event.pointerType)) lastKind = event.pointerType
			if (event.pointerId !== press.id) return
			press.travel = Math.max(
				press.travel,
				Math.hypot(event.clientX - press.x, event.clientY - press.y),
			)
		},
		/** The pointer in use right now: sizes the hit targets while hovering and tapping. */
		currentKind: (): PointerKind => lastKind,
		/** The kind of the current (or last) press. */
		pressKind: (): PointerKind => press.kind,
		/**
		 * Whether the current press, released `deltaPx` from where it went down,
		 * is a tap: one pointer, within the allowance all the way, and not the
		 * click that brought the window into focus.
		 */
		isTap(deltaPx: number, kind: PointerKind): boolean {
			if (press.multi || isFocusPress(press, focusedAt)) return false
			return isTap(Math.max(deltaPx, press.travel), kind)
		},
		/**
		 * Whether the press under way has become a gesture: it wandered beyond
		 * the allowance, or another finger joined it (#49). Until then the
		 * camera stays where it is.
		 */
		isGrab(): boolean {
			return press.multi || !isTap(press.travel, press.kind)
		},
	}
}

export type PressTracker = ReturnType<typeof createPressTracker>

/** The page's own tracker. */
const presses = createPressTracker()

if (typeof window !== "undefined") {
	const options = { capture: true, passive: true }
	window.addEventListener(
		"pointerdown",
		(event) => presses.down(event, document.hasFocus()),
		options,
	)
	window.addEventListener(
		"pointermove",
		(event) => presses.move(event),
		options,
	)
	// focus does not bubble: this sees the window's own focus, not a button's
	window.addEventListener("focus", (event) => {
		if (event.target === window) presses.focus(event.timeStamp)
	})
}

/** The pointer type behind a DOM event (a PointerEvent's own, else the last press's). */
export const pointerKindOf = (event: Event): PointerKind => {
	const type = (event as Partial<PointerEvent>).pointerType
	return isPointerKind(type) ? type : presses.pressKind()
}

/** The pointer in use right now: sizes the hit targets while hovering and tapping. */
export const currentPointerKind = (): PointerKind => presses.currentKind()

/**
 * For R3F click events: `delta` is the distance from the press to the
 * release, px; the press's furthest excursion counts too, and a pinch or a
 * click that focused the window is no tap at all.
 */
export const isTapEvent = (event: {
	delta: number
	nativeEvent: Event
}): boolean => presses.isTap(event.delta, pointerKindOf(event.nativeEvent))

/**
 * For DOM click events (the opening's tap to pause, #49): the same rule as
 * `isTapEvent`, measured over the whole press.
 */
export const isTapClick = (event: Event): boolean =>
	presses.isTap(0, pointerKindOf(event))

/** The camera director: the press under way is a drag or a pinch now, not a tap (#49). */
export const isPressGrab = (): boolean => presses.isGrab()
