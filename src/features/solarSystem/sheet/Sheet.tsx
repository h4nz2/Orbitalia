/**
 * The phone's sheet (#60; docs/ARCHITECTURE.md, "The phone's sheet"). On a
 * phone held upright the body card, a dock panel (Layers, Scale, a tool), the
 * tour card, the hunt, the quick look and the time controls share one sheet
 * from the bottom, with the entry buttons as its bottom row and the time chip
 * above it. Everywhere else the same elements keep their places in the HUD
 * grid: this wrapper and its content are `display: contents` there, so
 * nothing remounts when a phone turns.
 *
 * - **One at a time.** What appeared in the dock last is on show
 *   (`data-sheet-shown`); with nothing in the dock, the body card. A new
 *   thing opens at its kind's height (`DEFAULT_HEIGHT`).
 * - **Three heights** (`heights.ts`): `small` shows one line of it (a panel's
 *   header; the card, a tour and the hunt fold themselves, their own fold
 *   toggles and the sheet's height being one and the same), `half` about
 *   half the screen, `full` up to just under the top row.
 * - **Moving it:** the handle (a button: a tap or Enter/Space steps up, the
 *   arrow keys raise and lower), a drag on the handle or on the header, and
 *   a downward drag on the content once it is scrolled to its top (touch
 *   events, so scrolling inside never moves the sheet). Pulled well below
 *   `small`, it closes what it shows, except a tour or the quick look, which
 *   close with their own ×. Dragging never reaches the scene.
 * - **Ready to use** (#62): a panel that opens brings its main action
 *   (`data-sheet-main`: the light's Send, the birthday's calendar, the sky's
 *   place) into view at its height, scrolling its words above it out of the
 *   way, so a link's tool is ready in thumb reach on a small phone too.
 * - **Swiping the card** (#62): a finger moving sideways on a world's card
 *   flies to the next world (to the left, outwards) or the one before, as
 *   the arrow keys do (`ui/focusCycle.ts`); the card follows the finger a
 *   little and springs back. Up and down stay the sheet's.
 * - **The band the scene is seen in** (#61): the sheet writes its resting top
 *   edge (the time chip's, which sits above it, or the gesture hint's above
 *   that, #62) to `useFreeAreaStore`, on rest and on resize, never during a
 *   drag. It is the band's only writer on an upright phone
 *   (`dock/FreeArea.tsx` stands down there).
 */
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
} from "react"

import { useUprightPhone } from "@/hooks/useSizeClass"
import { useI18n } from "@/i18n"
import { Hint } from "@/primitives/hint"
import { useFreeAreaStore } from "@/store/freeArea"
import { useHudStore } from "@/store/hud"
import { useHuntStore } from "@/store/hunt"
import { usePresentationStore } from "@/store/presentation"
import {
	DEFAULT_HEIGHT,
	isSheetKind,
	useSheetStore,
	type SheetHeight,
	type SheetKind,
} from "@/store/sheet"
import { useTourStore } from "@/store/tour"

import { dismissGestureHint, useGestureHintStore } from "./gestureHint"
import {
	HALF_SHARE,
	clearOfFoot,
	contentPx,
	nextHeight,
	restingHeight,
	stepHeight,
	type ContentSizes,
	type Span,
} from "./heights"
import { followPx, swipeDirection, swipeToWorld } from "./swipe"

import hudClasses from "../SolarSystem.module.css"
import classes from "./Sheet.module.css"

/** The handle's strip above the content, px; at `full` it also holds the time chip. */
export const STRIP_PX = 24
export const STRIP_FULL_PX = 60

/** A press must travel this far, px, before it moves the sheet (a tap stays a tap). */
const DRAG_START_PX = 6

/** The card springs back in this long, ms (#62). */
const SWIPE_SPRING_MS = 200

/** The snap's length (SolarSystem.module.css): the band is written once it is over. */
const SNAP_MS = 240

/** The longest a write waits for a snap to end (its `transitionend` usually comes first). */
const SNAP_WAIT_MS = 1500

/** Kinds whose content folds itself to its small form (the store holds the fold). */
const FOLDS: readonly SheetKind[] = ["card", "tour", "hunt"]

/** Kinds that a pull below `small` never closes: leaving them is their own ×. */
const KEEPS: readonly SheetKind[] = ["tour", "quickLook"]

const kindOf = (element: Element | null, inDock: boolean): SheetKind | null => {
	if (element === null) return null
	if (!inDock) return "card"
	const kind = element.getAttribute("data-sheet-kind")
	return isSheetKind(kind) ? kind : "panel"
}

/** Folds or unfolds what the sheet shows, through the store that holds its fold. */
function setFolded(kind: SheetKind | null, folded: boolean): void {
	switch (kind) {
		case "card":
			if (useHudStore.getState().cardExpanded === folded)
				useHudStore.getState().setCardExpanded(!folded)
			return
		case "tour":
			if (useTourStore.getState().collapsed !== folded)
				useTourStore.getState().setCollapsed(folded)
			return
		case "hunt":
			if (useHuntStore.getState().collapsed !== folded)
				useHuntStore.getState().setCollapsed(folded)
			return
		default:
			return
	}
}

/** The nearest element from `target` up to `root` that scrolls vertically, else `root`. */
function scrollerOf(
	target: EventTarget | null,
	root: HTMLElement,
): HTMLElement {
	let element = target instanceof HTMLElement ? target : null
	while (element !== null && element !== root) {
		const style = getComputedStyle(element)
		if (
			(style.overflowY === "auto" || style.overflowY === "scroll") &&
			element.scrollHeight > element.clientHeight + 1
		)
			return element
		element = element.parentElement
	}
	return root
}

/** Room kept round a main action brought into view, px. */
const REVEAL_MARGIN = 8

/**
 * Scrolls the sheet's content `area` so the main action of `element` (its
 * first `data-sheet-main`, #62) is in view with the content `px` high, never
 * past the action's top under a header that stays in place. Returns whether
 * there was one to bring.
 */
function revealMain(area: HTMLElement, element: Element, px: number): boolean {
	const main = [
		...element.querySelectorAll<HTMLElement>("[data-sheet-main]"),
	].find((candidate) => candidate.getClientRects().length > 0)
	if (main === undefined) return false
	const view = area.getBoundingClientRect()
	const box = main.getBoundingClientRect()
	const top = box.top - view.top + area.scrollTop
	const header = element.querySelector(":scope > header")
	const headerPx =
		header !== null && getComputedStyle(header).position === "sticky"
			? header.getBoundingClientRect().height
			: 0
	const want = top + box.height + REVEAL_MARGIN - px
	const limit = top - headerPx - REVEAL_MARGIN
	const scroll = Math.max(0, Math.min(want, limit))
	if (scroll > area.scrollTop + 1) area.scrollTop = scroll
	return true
}

/**
 * What a finger presses: the controls a sticky foot must not rest across (a
 * segment or a switch by its label, which is what shows).
 */
const CONTROLS =
	"button, a[href], label, select, textarea, [role=button], [role=slider]"

/**
 * The sticky foot of `element` (`data-sheet-footer`: a tour's, a sky event's
 * or the quick look's Back and Next) and the controls before it, which slide
 * under it, in px from the top of the content `area` (scroll included); null
 * without a foot that sticks. The sticky header's controls never pass under it.
 */
function footOf(
	area: HTMLElement,
	element: Element,
): { foot: number; controls: Span[] } | null {
	const foot = [
		...element.querySelectorAll<HTMLElement>("[data-sheet-footer]"),
	].find((candidate) => candidate.getClientRects().length > 0)
	if (foot === undefined || getComputedStyle(foot).position !== "sticky")
		return null
	const top = area.getBoundingClientRect().top - area.scrollTop
	const controls: Span[] = []
	for (const control of element.querySelectorAll<HTMLElement>(CONTROLS)) {
		if (
			control.getClientRects().length === 0 ||
			control.closest("header, [data-sheet-footer]") !== null ||
			!(
				foot.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING
			)
		)
			continue
		const box = control.getBoundingClientRect()
		controls.push({ top: box.top - top, bottom: box.bottom - top })
	}
	return { foot: foot.getBoundingClientRect().height, controls }
}

/** Whether `target` sits in something that scrolls sideways (its own swipe is a scroll). */
function inSideScroller(target: EventTarget | null, root: Element): boolean {
	let element = target instanceof HTMLElement ? target : null
	while (element !== null && element !== root) {
		const style = getComputedStyle(element)
		if (
			(style.overflowX === "auto" || style.overflowX === "scroll") &&
			element.scrollWidth > element.clientWidth + 1
		)
			return true
		element = element.parentElement
	}
	return false
}

const reducedMotion = () =>
	typeof window.matchMedia === "function" &&
	window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** The bottom of the HUD's top row (where, More, the badges under them), px from the HUD's top. */
function topRowBottom(hud: HTMLElement): number {
	const hudTop = hud.getBoundingClientRect().top
	let bottom = 0
	for (const element of hud.querySelectorAll<HTMLElement>("[data-sheet-top]")) {
		if (element.getClientRects().length === 0) continue
		bottom = Math.max(bottom, element.getBoundingClientRect().bottom - hudTop)
	}
	return bottom
}

interface Drag {
	pointerId: number | null
	zone: "handle" | "header" | "content"
	startY: number
	startX: number
	startPx: number
	scroller: HTMLElement | null
	moving: boolean
	samples: { y: number; t: number }[]
	/** A world's card under a finger (#62): a sideways move swipes it. */
	swipe: HTMLElement | null
	/** The finger is swiping the card sideways (it then never moves the sheet). */
	swiping: boolean
	lastX: number
	lastY: number
}

export interface SheetProps {
	/** The content: the body card's place and the dock. */
	content: ReactNode
	/** The bottom row: the time (the chip on a phone) and the entry buttons. */
	bottom: ReactNode
}

export function Sheet({ content, bottom }: SheetProps) {
	const { t } = useI18n()
	const active = useUprightPhone()
	const height = useSheetStore((state) => state.height)
	const dragging = useSheetStore((state) => state.dragging)
	const setHeight = useSheetStore((state) => state.setHeight)
	const rootRef = useRef<HTMLDivElement>(null)
	const contentRef = useRef<HTMLDivElement>(null)
	const [shown, setShown] = useState<{
		element: Element
		inDock: boolean
	} | null>(null)
	const kind = kindOf(shown?.element ?? null, shown?.inDock ?? false)
	const kindRef = useRef(kind)
	// first of the layout effects, so the ones below read this render's kind
	useLayoutEffect(() => {
		kindRef.current = kind
	})
	/** The content's px at each height, as last measured. */
	const levels = useRef<Record<SheetHeight, number>>({
		small: 0,
		half: 0,
		full: 0,
	})
	/** The content's height while folded small, kept for a drag that unfolds it. */
	const foldedPx = useRef<number | null>(null)
	const drag = useRef<Drag | null>(null)
	/** The click a drag's release leaves behind is swallowed; the next press clears this. */
	const suppressClick = useRef(false)
	const writeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	)
	/** The next world's card comes from a swipe (#62): it keeps the sheet's height. */
	const swiped = useRef(false)
	/** A panel just opened: its main action is brought into view once it is there (#62). */
	const bringMain = useRef(false)

	// the dock's children in the order they came: the last one is on show
	useLayoutEffect(() => {
		const root = contentRef.current
		const dock = root?.querySelector<HTMLElement>("[data-dock]")
		const info = root?.querySelector<HTMLElement>("[data-info]")
		if (!active || root == null || dock == null || info == null) {
			setShown(null)
			return
		}
		let order: Element[] = []
		const update = () => {
			const children = [...dock.children]
			order = order.filter((child) => children.includes(child))
			for (const child of children)
				if (!order.includes(child)) order.push(child)
			const top = order[order.length - 1] ?? null
			for (const child of children)
				child.toggleAttribute("data-sheet-shown", child === top)
			const element = top ?? info.firstElementChild
			setShown((previous) =>
				previous?.element === element
					? previous
					: element === null
						? null
						: { element, inDock: top !== null },
			)
		}
		update()
		const observer = new MutationObserver(update)
		observer.observe(dock, { childList: true })
		observer.observe(info, { childList: true })
		return () => {
			observer.disconnect()
			for (const child of dock.children)
				child.removeAttribute("data-sheet-shown")
		}
	}, [active])

	useEffect(() => {
		useSheetStore.getState().setActive(active && shown !== null)
		// a world's card: the one a swipe moves on from (#62)
		useSheetStore
			.getState()
			.setWorld(
				active &&
					shown !== null &&
					!shown.inDock &&
					shown.element.hasAttribute("data-card-body"),
			)
	}, [active, shown])
	useEffect(
		() => () => {
			useSheetStore.getState().setActive(false)
			useSheetStore.getState().setWorld(false)
		},
		[],
	)

	// something new opens at its kind's height; the next world's card after a swipe keeps it (#62)
	useLayoutEffect(() => {
		const opened = kindRef.current
		if (shown === null || opened === null) return
		foldedPx.current = null
		const keep = swiped.current && opened === "card"
		swiped.current = false
		bringMain.current = opened === "panel"
		if (!keep) useSheetStore.getState().setHeight(DEFAULT_HEIGHT[opened])
	}, [shown])

	// a tour or the quick look starting puts the time controls away: one thing at a time
	useEffect(() => {
		if (!active) return
		return useTourStore.subscribe((state, previous) => {
			if (state.tour !== null && state.tour !== previous.tour)
				useSheetStore.getState().setTimeOpen(false)
		})
	}, [active])

	/** The sizes the heights are made of, measured now. */
	const measure = useCallback((): ContentSizes | null => {
		const root = rootRef.current
		const area = contentRef.current
		const hud = root?.parentElement
		const element = shown?.element
		// a thing just taken out of the page: the observer brings the next one
		if (
			root == null ||
			area == null ||
			hud == null ||
			element == null ||
			!element.isConnected
		)
			return null
		const container = shown!.inDock
			? element.parentElement!
			: (element.parentElement ?? element)
		const natural = (container as HTMLElement).offsetHeight
		let summary = Infinity
		if (!(element as HTMLElement).hasAttribute("data-sheet-folds")) {
			const header = element.querySelector(
				":scope > header, :scope [data-sheet-summary]",
			)
			if (header !== null) {
				const top = container.getBoundingClientRect().top
				const pad = parseFloat(getComputedStyle(container).paddingBottom) || 0
				summary = header.getBoundingClientRect().bottom - top + pad
			}
		}
		const hudBox = hud.getBoundingClientRect()
		const rootBox = root.getBoundingClientRect()
		const chrome = rootBox.height - area.getBoundingClientRect().height
		const strip = height === "full" ? STRIP_FULL_PX : STRIP_PX
		const fullChrome = chrome - strip + STRIP_FULL_PX
		const halfCap = HALF_SHARE * hudBox.height - chrome
		// the grid's two gaps stay: under the top row, and above the sheet
		const gap = parseFloat(getComputedStyle(hud).rowGap) || 0
		const fullCap =
			rootBox.bottom - hudBox.top - (topRowBottom(hud) + 2 * gap) - fullChrome
		// shown whole (#62, the Tools tiles): its half is all of it, up to under the top row
		const whole = (element as HTMLElement).hasAttribute("data-sheet-whole")
		return { natural, summary, halfCap: whole ? fullCap : halfCap, fullCap }
	}, [shown, height])

	/** Writes the band the scene is seen in (#61): from under the top row to the top of the chip or the sheet. */
	const writeFreeArea = useCallback(() => {
		const root = rootRef.current
		const hud = root?.parentElement
		const page = hud?.parentElement
		if (!active || root == null || hud == null || page == null) return
		const screen = page.getBoundingClientRect()
		const area = { width: screen.width, height: screen.height }
		if (usePresentationStore.getState().chromeHidden) {
			useFreeAreaStore.getState().setArea({ ...area, top: 0, bottom: 0 })
			return
		}
		const hudTop = hud.getBoundingClientRect().top
		const top = topRowBottom(hud) + (hudTop - screen.top)
		// the time chip, a flight's readout and the gesture hint (#62) sit above the sheet
		let edge = root.getBoundingClientRect().top
		for (const element of hud.querySelectorAll<HTMLElement>(
			"[data-sheet-above]",
		))
			if (element.getClientRects().length > 0)
				edge = Math.min(edge, element.getBoundingClientRect().top)
		useFreeAreaStore.getState().setArea({
			...area,
			top: Math.max(0, top),
			bottom: Math.max(0, screen.bottom - edge),
		})
	}, [active])

	/** Until when a snap is under way (its transition's end clears it; a busy machine stretches it). */
	const snapUntil = useRef(0)

	/**
	 * Writes the band once the sheet has come to rest: never during a drag,
	 * never halfway through a snap (it waits for the snap's end, or at most
	 * `SNAP_WAIT_MS`), and once things have stopped changing for `delay` ms.
	 */
	const scheduleWrite = useCallback(
		(delay = 80) => {
			const wait = (ms: number) => {
				clearTimeout(writeTimer.current)
				writeTimer.current = setTimeout(() => {
					if (useSheetStore.getState().dragging) return
					if (performance.now() < snapUntil.current) wait(80)
					else writeFreeArea()
				}, ms)
			}
			wait(delay)
		},
		[writeFreeArea],
	)
	useEffect(() => () => clearTimeout(writeTimer.current), [])

	/** Sets the content's height for the resting height, measured now. */
	const apply = useCallback(
		(write = true) => {
			const area = contentRef.current
			if (area === null || useSheetStore.getState().dragging) return
			// what it showed was just taken out of the page: the observer brings the next one
			if (shown !== null && !shown.element.isConnected) return
			const sizes = measure()
			if (sizes === null) {
				area.style.height = ""
				if (write) scheduleWrite()
				return
			}
			const px = {
				small: contentPx("small", sizes),
				half: contentPx("half", sizes),
				full: contentPx("full", sizes),
			}
			// a sticky foot (a tour's Back and Next) never rests across a control above it
			const foot = shown === null ? null : footOf(area, shown.element)
			if (foot !== null)
				for (const at of ["half", "full"] as const)
					px[at] = clearOfFoot(px[at], foot.foot, foot.controls, area.scrollTop)
			levels.current = px
			if (height === "small" && FOLDS.includes(kindRef.current!))
				foldedPx.current = px.small
			const target = px[height]
			if (area.style.height !== `${target}px`) {
				const from = area.getBoundingClientRect().height
				area.style.height = `${target}px`
				// a snap (none with reduced motion): the band waits for its end
				const animates =
					Math.abs(from - target) > 0.5 &&
					parseFloat(getComputedStyle(area).transitionDuration) > 0
				if (animates) snapUntil.current = performance.now() + SNAP_WAIT_MS
				if (write) scheduleWrite(animates ? SNAP_MS + 60 : 0)
			} else if (write) scheduleWrite()
			if (height === "small") area.scrollTop = 0
			// a panel that just opened: its main action in view (it may still be loading)
			else if (
				bringMain.current &&
				shown !== null &&
				revealMain(area, shown.element, target)
			)
				bringMain.current = false
		},
		[measure, height, scheduleWrite, shown],
	)

	// the height at rest, and the fold of what folds itself
	useLayoutEffect(() => {
		if (!active) {
			const area = contentRef.current
			if (area !== null) area.style.height = ""
			return
		}
		// a new thing just set its own height: this render's is stale, the next one applies
		if (useSheetStore.getState().height !== height) return
		setFolded(kindRef.current, height === "small")
		apply()
	}, [active, height, shown, apply])

	// the content's own fold toggles move the sheet: unfolded is at least half, folded is small
	useEffect(() => {
		if (!active) return
		const follow = (folded: boolean, of: SheetKind) => {
			const sheet = useSheetStore.getState()
			if (sheet.dragging || kindRef.current !== of) return
			if (folded && sheet.height !== "small") sheet.setHeight("small")
			if (!folded && sheet.height === "small") sheet.setHeight("half")
		}
		const stops = [
			useHudStore.subscribe((state, previous) => {
				if (state.cardExpanded !== previous.cardExpanded)
					follow(!state.cardExpanded, "card")
			}),
			useTourStore.subscribe((state, previous) => {
				if (state.collapsed !== previous.collapsed)
					follow(state.collapsed, "tour")
			}),
			useHuntStore.subscribe((state, previous) => {
				if (state.collapsed !== previous.collapsed)
					follow(state.collapsed, "hunt")
			}),
		]
		return () => stops.forEach((stop) => stop())
	}, [active])

	// sizes change: what it shows (a new stop, an unfolded card), the screen, the top row
	useEffect(() => {
		const root = rootRef.current
		const hud = root?.parentElement
		if (!active || root == null || hud == null) return
		const observer = new ResizeObserver(() => apply())
		// the sheet itself: a snap is over when it stops changing size
		observer.observe(root)
		if (shown !== null) {
			observer.observe(shown.element)
			if (shown.element.parentElement !== null)
				observer.observe(shown.element.parentElement)
		}
		observer.observe(hud)
		for (const element of hud.querySelectorAll("[data-sheet-top]"))
			observer.observe(element)
		for (const element of root.querySelectorAll("[data-sheet-above]"))
			observer.observe(element)
		return () => observer.disconnect()
	}, [active, shown, apply])

	// the snap is over: the band now (a busy machine may stretch a snap well past its time)
	useEffect(() => {
		const area = contentRef.current
		if (!active || area === null) return
		const onEnd = (event: TransitionEvent) => {
			if (event.target !== area || event.propertyName !== "height") return
			snapUntil.current = 0
			scheduleWrite(0)
		}
		area.addEventListener("transitionend", onEnd)
		return () => area.removeEventListener("transitionend", onEnd)
	}, [active, scheduleWrite])

	// hiding the controls (#59) frees the whole screen; showing them again, the band;
	// the gesture hint (#62) coming and going moves the band's foot
	useEffect(() => {
		if (!active) return
		writeFreeArea()
		const stops = [
			usePresentationStore.subscribe((state, previous) => {
				if (state.chromeHidden !== previous.chromeHidden) scheduleWrite(0)
			}),
			useGestureHintStore.subscribe((state, previous) => {
				if (state.showing !== previous.showing) scheduleWrite()
			}),
		]
		return () => stops.forEach((stop) => stop())
	}, [active, writeFreeArea, scheduleWrite])

	// —— moving it ——————————————————————————————————————————————

	const closable = () =>
		kindRef.current !== null && !KEEPS.includes(kindRef.current)

	/** Presses the × of what the sheet shows; returns whether there was one. */
	const closeShown = (): boolean => {
		const element = shown?.element
		if (element == null) return false
		const button =
			element.querySelector<HTMLElement>("[data-sheet-close]") ??
			element.querySelector<HTMLElement>(
				"header .mantine-CloseButton-root, [data-sheet-summary] .mantine-CloseButton-root",
			)
		if (button === null) return false
		// this click is meant: the one a drag leaves behind is not
		suppressClick.current = false
		button.click()
		return true
	}

	/** The world's card under a finger's press, which a sideways move swipes (#62); else null. */
	const swipeable = (target: EventTarget | null): HTMLElement | null => {
		const element = shown?.element
		if (
			kindRef.current !== "card" ||
			!(element instanceof HTMLElement) ||
			!element.hasAttribute("data-card-body") ||
			!(target instanceof Node) ||
			!element.contains(target) ||
			inSideScroller(target, element)
		)
			return null
		return element
	}

	const begin = (
		zone: Drag["zone"],
		pointerId: number | null,
		x: number,
		y: number,
		target: EventTarget | null,
		finger: boolean,
	) => {
		const area = contentRef.current
		if (area === null || shown === null) return
		drag.current = {
			pointerId,
			zone,
			startX: x,
			startY: y,
			startPx: area.getBoundingClientRect().height,
			scroller: zone === "content" ? scrollerOf(target, area) : null,
			moving: false,
			samples: [{ y, t: performance.now() }],
			swipe: finger && zone !== "handle" ? swipeable(target) : null,
			swiping: false,
			lastX: x,
			lastY: y,
		}
	}

	/** The card follows a sideways finger a little (#62); none with reduced motion. */
	const follow = (card: HTMLElement, dx: number) => {
		if (reducedMotion()) return
		const px = followPx(dx)
		card.style.transition = "none"
		card.style.transform = `translateX(${px}px)`
		card.style.opacity = String(1 - Math.abs(px) / 216)
	}

	/** And springs back as the finger lifts. */
	const springBack = (card: HTMLElement) => {
		if (card.style.transform === "") return
		card.style.transition = `transform ${SWIPE_SPRING_MS}ms ease-out, opacity ${SWIPE_SPRING_MS}ms ease-out`
		card.style.transform = ""
		card.style.opacity = ""
		setTimeout(() => {
			card.style.transition = ""
		}, SWIPE_SPRING_MS)
	}

	/** Moves the sheet with the press; returns whether it is a drag of the sheet now. */
	const move = (x: number, y: number): boolean => {
		const current = drag.current
		const area = contentRef.current
		if (current === null || area === null) return false
		current.lastX = x
		current.lastY = y
		const dy = y - current.startY
		const dx = x - current.startX
		// sideways on a world's card: a swipe to the next world (#62), never the sheet
		if (current.swiping) {
			follow(current.swipe!, dx)
			return true
		}
		if (
			!current.moving &&
			current.swipe !== null &&
			Math.abs(dx) >= DRAG_START_PX &&
			Math.abs(dx) > Math.abs(dy)
		) {
			current.swiping = true
			follow(current.swipe, dx)
			return true
		}
		if (!current.moving) {
			if (Math.abs(dy) < DRAG_START_PX || Math.abs(dy) < Math.abs(dx))
				return false
			// on the content: only down, and only from the top of what scrolls
			if (
				current.zone === "content" &&
				(dy < 0 || (current.scroller?.scrollTop ?? 0) > 0)
			) {
				drag.current = null
				return false
			}
			current.moving = true
			useSheetStore.getState().setDragging(true)
			// one of the gestures the hint shows (#62): it has done its job
			dismissGestureHint()
			// what folds itself opens as the sheet rises, so there is something to see
			if (dy < 0 && FOLDS.includes(kindRef.current!))
				setFolded(kindRef.current, false)
		}
		const { full } = levels.current
		const floor = closable() ? 0 : levels.current.small * 0.6
		const px = Math.min(full + 24, Math.max(floor, current.startPx - dy))
		area.style.height = `${px}px`
		current.samples.push({ y, t: performance.now() })
		if (current.samples.length > 6) current.samples.shift()
		return true
	}

	const end = () => {
		const current = drag.current
		drag.current = null
		const area = contentRef.current
		if (current?.swiping === true) {
			const dx = current.lastX - current.startX
			const dy = current.lastY - current.startY
			springBack(current.swipe!)
			// the click the finger leaves on a button of the card is no click
			suppressClick.current = true
			// to the left is the next world, outwards, like a carousel
			const direction = swipeDirection(dx, dy)
			if (direction !== null) {
				dismissGestureHint()
				swiped.current = true
				if (!swipeToWorld(direction)) swiped.current = false
			}
			return
		}
		if (current === null || !current.moving || area === null) return
		suppressClick.current = true
		// px per ms, positive when the sheet grows (the finger moves up), over the
		// last moments before the finger lifted: one that stopped first flicks nothing
		const now = performance.now()
		const recent = current.samples.filter((sample) => now - sample.t < 120)
		const first = recent[0]
		const last = recent[recent.length - 1]
		const velocity =
			recent.length < 2 ? 0 : (first.y - last.y) / Math.max(1, last.t - first.t)
		const px = area.getBoundingClientRect().height
		// the small height is the folded one, even while unfolded for the drag
		const heights = {
			...levels.current,
			small: foldedPx.current ?? levels.current.small,
		}
		const sizes = measure()
		if (sizes !== null) {
			heights.half = contentPx("half", sizes)
			heights.full = contentPx("full", sizes)
		}
		const resting = restingHeight(px, velocity, heights, closable())
		useSheetStore.getState().setDragging(false)
		if (resting === "close" && closeShown()) {
			suppressClick.current = true
			return
		}
		const rest = resting === "close" ? "small" : resting
		const sheet = useSheetStore.getState()
		if (sheet.height === rest) {
			setFolded(kindRef.current, rest === "small")
			apply()
		} else sheet.setHeight(rest)
	}

	// handle and header: pointer events (they take no scrolling: `touch-action: none`)
	const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!active || shown === null || event.button !== 0) return
		const target = event.target as Element
		const zone = target.closest("[data-sheet-handle]")
			? "handle"
			: shown.element.contains(target) &&
				  target.closest("header, [data-sheet-summary]") !== null
				? "header"
				: null
		if (zone === null) return
		begin(
			zone,
			event.pointerId,
			event.clientX,
			event.clientY,
			event.target,
			event.pointerType !== "mouse",
		)
	}

	useEffect(() => {
		if (!active) return
		const onMove = (event: PointerEvent) => {
			const current = drag.current
			if (current === null || current.pointerId !== event.pointerId) return
			if (move(event.clientX, event.clientY)) event.preventDefault()
		}
		const onUp = (event: PointerEvent) => {
			const current = drag.current
			if (current === null || current.pointerId !== event.pointerId) return
			if (
				event.type === "pointercancel" &&
				!current.moving &&
				!current.swiping
			) {
				drag.current = null
				return
			}
			end()
		}
		// a drag that ends on a button is no click on it; a new press is a new start
		const onClick = (event: MouseEvent) => {
			if (!suppressClick.current) return
			suppressClick.current = false
			event.preventDefault()
			event.stopPropagation()
		}
		const onPress = () => {
			if (drag.current === null) suppressClick.current = false
		}
		const root = rootRef.current
		window.addEventListener("pointermove", onMove, { passive: false })
		window.addEventListener("pointerup", onUp)
		window.addEventListener("pointercancel", onUp)
		root?.addEventListener("click", onClick, true)
		window.addEventListener("pointerdown", onPress, true)
		return () => {
			window.removeEventListener("pointerdown", onPress, true)
			window.removeEventListener("pointermove", onMove)
			window.removeEventListener("pointerup", onUp)
			window.removeEventListener("pointercancel", onUp)
			root?.removeEventListener("click", onClick, true)
		}
	})

	// the content: touch events, so a pull down from the top can stop the scroll and move the sheet
	useEffect(() => {
		const area = contentRef.current
		if (!active || area === null) return
		const onStart = (event: TouchEvent) => {
			if (event.touches.length !== 1 || drag.current !== null) return
			const target = event.target as Element
			if (target.closest("header, [data-sheet-summary]")) return
			const touch = event.touches[0]
			// the viewer scrolls for themselves now
			bringMain.current = false
			begin("content", null, touch.clientX, touch.clientY, event.target, true)
		}
		const onMove = (event: TouchEvent) => {
			const current = drag.current
			if (current === null || current.pointerId !== null) return
			const touch = event.touches[0]
			if (touch !== undefined && move(touch.clientX, touch.clientY))
				event.preventDefault()
		}
		const onEnd = () => {
			const current = drag.current
			if (current === null || current.pointerId !== null) return
			end()
		}
		area.addEventListener("touchstart", onStart, { passive: true })
		area.addEventListener("touchmove", onMove, { passive: false })
		area.addEventListener("touchend", onEnd)
		area.addEventListener("touchcancel", onEnd)
		return () => {
			area.removeEventListener("touchstart", onStart)
			area.removeEventListener("touchmove", onMove)
			area.removeEventListener("touchend", onEnd)
			area.removeEventListener("touchcancel", onEnd)
		}
	})

	// —— the handle ———————————————————————————————————————————————

	const heightsNow = () => {
		const sizes = measure()
		if (sizes === null) return levels.current
		// folded content does not know its unfolded size yet: count `half` as higher
		const small = contentPx("small", sizes)
		const half = Math.max(contentPx("half", sizes), small + 2)
		const full = Math.max(contentPx("full", sizes), half)
		return FOLDS.includes(kindRef.current!) && height === "small"
			? { small, half, full: full + 2 }
			: {
					small,
					half: contentPx("half", sizes),
					full: contentPx("full", sizes),
				}
	}

	const onHandleClick = () => {
		if (suppressClick.current) return
		// one of the gestures the hint shows (#62)
		dismissGestureHint()
		setHeight(nextHeight(height, heightsNow()))
	}

	const onHandleKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
		const step = (direction: 1 | -1) => {
			event.preventDefault()
			event.stopPropagation()
			setHeight(stepHeight(height, direction, heightsNow()))
		}
		switch (event.key) {
			case "ArrowUp":
				step(1)
				return
			case "ArrowDown":
				step(-1)
				return
			case "Home":
				event.preventDefault()
				setHeight("small")
				return
			case "End":
				event.preventDefault()
				setHeight(stepHeight("half", 1, heightsNow()))
				return
			default:
				return
		}
	}

	const heightName = t(`solarSystem.sheet.height.${height}`)
	const sheetOn = active && shown !== null

	return (
		<div
			ref={rootRef}
			className={hudClasses.sheet}
			data-sheet={active ? "" : undefined}
			data-sheet-height={sheetOn ? height : undefined}
			data-sheet-empty={active && shown === null ? "" : undefined}
			data-sheet-kind={sheetOn ? (kind ?? undefined) : undefined}
			data-sheet-dragging={sheetOn && dragging ? "" : undefined}
			data-testid={active ? "sheet" : undefined}
			onPointerDown={onPointerDown}
		>
			{sheetOn && (
				<div className={classes.strip}>
					<Hint text={t("solarSystem.sheet.handleHint")}>
						<button
							type="button"
							className={classes.handle}
							aria-label={t("solarSystem.sheet.handle", { height: heightName })}
							data-sheet-handle
							data-testid="sheet-handle"
							onClick={onHandleClick}
							onKeyDown={onHandleKey}
						>
							<span className={classes.grabber} aria-hidden />
						</button>
					</Hint>
				</div>
			)}
			<div
				ref={contentRef}
				className={hudClasses.sheetContent}
				data-testid={active ? "sheet-content" : undefined}
			>
				{content}
			</div>
			{bottom}
		</div>
	)
}

export default Sheet

/**
 * The band the scene is seen in, as the sheet last wrote it (#61): an
 * invisible box over it, on an upright phone only (`dock/FreeArea.tsx` is the
 * band itself elsewhere on a phone). Tests and anyone curious measure it.
 */
export function SheetBand() {
	const active = useUprightPhone()
	const area = useFreeAreaStore((state) => state.area)
	if (!active) return null
	return (
		<div
			className={classes.band}
			style={{
				top: area.top,
				height: Math.max(0, area.height - area.top - area.bottom),
			}}
			data-free-area
			aria-hidden
		/>
	)
}
