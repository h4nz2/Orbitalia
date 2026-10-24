/**
 * Nothing on screen overlaps (#76): these find every pair of visible texts
 * and controls drawn on top of each other, every line of text an opaque bar
 * of its own scroller slices through, and every text pushed off screen. See
 * docs/ARCHITECTURE.md, "Size classes, finger sizes and screen edges".
 *
 * The rules, each against a false alarm the first sweep raised:
 * - **Visible**: displayed, not `visibility: hidden`, at least 0.15 opaque
 *   with every ancestor's opacity multiplied in, at least 2 px each way, not
 *   `aria-hidden` and not `inert` (behind a dialog). The scene's names are
 *   `aria-hidden` (the focus picker is their accessible way) but count.
 * - **Pieces**: a text is an element's own text, compared by its line boxes
 *   (a Range over its text nodes), so a paragraph's short last line is not
 *   as wide as the paragraph and a wrapped line is not a rectangle. A control
 *   is its whole box, which is what a finger hits (a 44 px button drawn as a
 *   bar is 44 px tall), a switch or a checkbox by its label as in touch.ts;
 *   a control's own words are part of the control.
 * - **Clipping**: every box is cut to its clipping ancestors (`overflow`
 *   other than visible, along its containing blocks, so a fixed or absolute
 *   box escapes what does not hold it): a scroller's content only counts
 *   where it shows, and a scroller's edge cuts lines as any list does.
 * - **Covers**: what is opaque hides what lies under it where it is on top
 *   (hit-tested), so that part does not count: a sticky bar of the scroller
 *   a piece scrolls in (the sheet's header and foot, #60, #62), an open
 *   menu, popover or dialog (Mantine's dropdowns), and any other opaque box
 *   holding others (a panel; never a control, whose box is what a finger
 *   hits). A text wholly under one is hidden, not overlapped. But a line a
 *   bar or a panel slices through, more than 3 px of it shown and more than
 *   3 px under it, is a finding of its own (`cut`): a sliced line, or a name
 *   half under a panel, looks broken. A menu slices nothing (it is meant to
 *   lie over the page), nor does a scroller that fades its words out before
 *   the bar below them (a CSS mask: the sheet's `data-sheet-more`, #75). A
 *   control under a panel, or partly under a bar, is out of a finger's reach
 *   (`covered`); wholly behind its own scroller's bar it is scrolled away
 *   (the sheet's foot, #62). A text or a control drawn over a panel it does
 *   not belong to is an overlap with that panel, unless it is meant to lie
 *   over the page (a menu) or passes over as a sticky bar of the panel's
 *   scroller does.
 * - **Nesting**: an element never overlaps its own ancestor or descendant.
 * - **Off screen**: a text past the screen's edge where nothing scrolls it
 *   into view: any scroller upright, sideways only one narrower than the
 *   screen (a page never scrolls sideways).
 */
import type { Page } from "@playwright/test"

/** An overlap is more than this many px each way: a hairline is not one. */
export const OVERLAP_PX = 3

/** Below this opacity a piece is not seen. */
export const VISIBLE_OPACITY = 0.15

/** What a finger or a pointer can act on (as touch.ts `smallControls`). */
const CONTROL = [
	"button",
	"a[href]",
	"input:not([type=hidden])",
	"select",
	"textarea",
	...[
		"button",
		"link",
		"switch",
		"radio",
		"checkbox",
		"tab",
		"menuitem",
		"menuitemradio",
		"menuitemcheckbox",
		"combobox",
		"slider",
		"option",
	].map((role) => `[role=${role}]`),
].join(",")

/**
 * The names drawn in the scene: the bodies' and orbits' (labels/LabelLayer),
 * the spacecraft's, the belts' and the light flash's. They are `aria-hidden`
 * (a visual aid) but on screen all the same.
 */
export const SCENE_NAMES =
	"[data-label-layer] > *, [aria-hidden=true] > [data-craft], [data-belt], [data-light-front-label]"

export interface Box {
	left: number
	top: number
	width: number
	height: number
}

/** A text or a control on the page. */
export interface Piece {
	/** Where it is, as a short selector path ("[data-testid=body-card] header button"). */
	name: string
	/** Its words (or its accessible name), shortened. */
	text: string
	control: boolean
}

export interface Overlap {
	/**
	 * `overlap`: drawn over each other; `cut`: a line of `a` that `b` (an
	 * opaque bar or panel) slices through; `covered`: the control `a` under
	 * the opaque `b`, where a finger cannot reach it.
	 */
	kind: "overlap" | "cut" | "covered"
	a: Piece
	b: Piece
	width: number
	height: number
	/** Which one is drawn on top at the middle of the overlap. */
	onTop: "a" | "b" | "neither"
	/** Where the overlap is, for the picture. */
	box: Box
	/** The allow-list entries (their indices) the pair matches. */
	listed: number[]
}

export interface OffScreen {
	piece: Piece
	box: Box
	listed: number[]
}

/** Two pieces the allow-list names by selector (`b` left out: `a` off screen). */
export interface PairSelectors {
	a: string
	b?: string
	kind: "overlap" | "cut" | "covered" | "offScreen"
}

export interface Findings {
	overlaps: Overlap[]
	offScreen: OffScreen[]
	/** For each allow-list entry: whether each of its pieces is on screen (not covered whole). */
	present: { a: boolean; b: boolean }[]
}

/**
 * Everything that overlaps on the page as it is now, read in one evaluate
 * (so a page still sliding in agrees with itself). `listed` are the
 * allow-list's selectors: each finding says which entries it matches, and
 * `present` which of each entry's pieces are on screen.
 */
export const findOverlaps = (
	page: Page,
	listed: PairSelectors[] = [],
	{ skip }: { skip?: string } = {},
): Promise<Findings> =>
	page.evaluate(
		({ listed, skip, min, visibleOpacity, sceneNames, CONTROL }) => {
			type Rect = { left: number; top: number; right: number; bottom: number }
			interface Item {
				element: Element
				/** what a finger hits, for a control (a switch's label) */
				hit: Element
				rects: Rect[]
				control: boolean
				text: boolean
				scroller: Element | null
				/** its line boxes cut only by what does not scroll, for the screen's edges */
				free: Rect[]
				sideways: boolean
				upright: boolean
			}
			/**
			 * Something opaque that hides what lies under it: a sticky bar (of the
			 * scroller it sticks in), a floating layer (a menu or popover, meant
			 * to lie over the page) or a panel (any other opaque box holding
			 * others, never a control: its box is what a finger hits).
			 */
			interface Cover {
				element: Element
				rect: Rect
				kind: "bar" | "layer" | "panel"
				scroller: Element | null
			}

			// the floating layers: an open menu, popover or dialog is meant to lie over the page
			const LAYER = [
				".mantine-Popover-dropdown",
				".mantine-Menu-dropdown",
				".mantine-Combobox-dropdown",
				".mantine-HoverCard-dropdown",
				".mantine-Modal-content",
				".mantine-Drawer-content",
			].join(",")
			// hooks worth naming a piece by, in this order
			const HOOKS = [
				"data-testid",
				"data-body",
				"data-orbit",
				"data-craft",
				"data-belt",
				"data-light-front-label",
				"data-light-front-stop",
				"data-entry",
				"data-tool",
				"data-dock-panel",
				"data-sheet-footer",
				"data-sheet-summary",
				"data-sheet-kind",
				"data-tour-card",
				"data-card-body",
				"data-light-panel",
				"data-gesture-hint",
				"data-more-page",
				"data-section",
				"data-entity",
			]
			const NAMED_TAGS = new Set([
				"header",
				"footer",
				"nav",
				"section",
				"aside",
				"dialog",
				"h1",
				"h2",
				"h3",
				"h4",
				"th",
				"td",
				"dt",
				"dd",
				"li",
				"label",
				"main",
				"article",
				"ul",
				"ol",
				"table",
				"button",
				"a",
				"input",
				"p",
			])

			const styles = new Map<Element, CSSStyleDeclaration>()
			const style = (element: Element) => {
				let found = styles.get(element)
				if (found === undefined) {
					found = getComputedStyle(element)
					styles.set(element, found)
				}
				return found
			}
			const opacities = new Map<Element, number>()
			const opacity = (element: Element | null): number => {
				if (element === null) return 1
				let found = opacities.get(element)
				if (found === undefined) {
					found =
						Number(style(element).opacity) * opacity(element.parentElement)
					opacities.set(element, found)
				}
				return found
			}
			const toRect = (box: DOMRectReadOnly): Rect => ({
				left: box.left,
				top: box.top,
				right: box.right,
				bottom: box.bottom,
			})
			const intersect = (a: Rect, b: Rect): Rect => ({
				left: Math.max(a.left, b.left),
				top: Math.max(a.top, b.top),
				right: Math.min(a.right, b.right),
				bottom: Math.min(a.bottom, b.bottom),
			})
			const width = (r: Rect) => r.right - r.left
			const height = (r: Rect) => r.bottom - r.top
			const scrolls = (value: string) => value === "auto" || value === "scroll"

			/** What a finger hits: a switch, checkbox or radio by its label, a slider by its row (as touch.ts). */
			const target = (element: Element): Element => {
				if (element.matches("input[type=radio], input[type=checkbox]")) {
					const label =
						element.closest("label") ??
						(element.id === ""
							? null
							: document.querySelector(`label[for="${element.id}"]`))
					if (label !== null) return label
				}
				if (element.matches("[role=slider]"))
					return element.closest(".mantine-Slider-root") ?? element
				return element
			}

			/** Whether `element` is a containing block for a box positioned `mode`. */
			const holds = (element: Element, mode: string) => {
				const s = style(element)
				const holdsFixed =
					s.transform !== "none" ||
					s.filter !== "none" ||
					s.perspective !== "none" ||
					(s.backdropFilter ?? "none") !== "none" ||
					/paint|layout|strict|content/.test(s.contain) ||
					/transform|perspective|filter/.test(s.willChange)
				if (mode === "fixed") return holdsFixed
				if (mode === "absolute") return s.position !== "static" || holdsFixed
				return true
			}

			const everywhere = (): Rect => ({
				left: -Infinity,
				top: -Infinity,
				right: Infinity,
				bottom: Infinity,
			})
			/**
			 * The part of the page `element`'s box can show in: cut by every
			 * clipping ancestor along its containing blocks (and by itself, for
			 * its own text), and the nearest of them that scrolls. `fixed` is cut
			 * by the ancestors that do not scroll only, and `sideways` and
			 * `upright` say whether a scroller with more in it can bring what
			 * lies beyond into view: one narrower than the screen sideways (the
			 * page itself never should), any upright.
			 */
			const clipOf = (element: Element, own: boolean) => {
				let clip = everywhere()
				let fixed = everywhere()
				let scroller: Element | null = null
				let sideways = false
				let upright = false
				// its own overflow clips its own text, but it scrolls in an ancestor
				const cut = (node: Element, self = false) => {
					const s = style(node)
					if (s.display === "contents" || s.display === "inline") return
					const clipsX = s.overflowX !== "visible"
					const clipsY = s.overflowY !== "visible"
					if (!clipsX && !clipsY) return
					const box = node.getBoundingClientRect()
					const left = box.left + node.clientLeft
					const top = box.top + node.clientTop
					const x = { left, right: left + node.clientWidth }
					const y = { top, bottom: top + node.clientHeight }
					const scrollsX = scrolls(s.overflowX)
					const scrollsY = scrolls(s.overflowY)
					if (clipsX) clip = intersect(clip, { ...clip, ...x })
					if (clipsY) clip = intersect(clip, { ...clip, ...y })
					if (clipsX && !scrollsX) fixed = intersect(fixed, { ...fixed, ...x })
					if (clipsY && !scrollsY) fixed = intersect(fixed, { ...fixed, ...y })
					if (self) return
					if (scroller === null && (scrollsX || scrollsY)) scroller = node
					// a scroller only brings into view what it has more of
					if (
						scrollsX &&
						node.scrollWidth > node.clientWidth + 1 &&
						node.clientWidth < innerWidth - 1
					)
						sideways = true
					if (scrollsY && node.scrollHeight > node.clientHeight + 1)
						upright = true
				}
				if (own) cut(element, true)
				let mode = style(element).position
				for (
					let node = element.parentElement;
					node !== null && node !== document.body;
					node = node.parentElement
				) {
					if (!holds(node, mode)) continue
					cut(node)
					const position = style(node).position
					mode =
						position === "fixed" || position === "absolute"
							? position
							: "static"
				}
				return {
					clip,
					fixed,
					scroller: scroller as Element | null,
					sideways,
					upright,
				}
			}

			const shown = (element: Element) =>
				element.checkVisibility({ visibilityProperty: true }) &&
				opacity(element) >= visibleOpacity &&
				element.closest("[inert]") === null &&
				(element.closest("[aria-hidden=true]") === null ||
					element.closest(sceneNames) !== null)

			const textNodes = (element: Element) =>
				[...element.childNodes].filter(
					(node) =>
						node.nodeType === Node.TEXT_NODE &&
						(node.textContent ?? "").trim() !== "",
				)

			const opaque = (s: CSSStyleDeclaration) => {
				if (s.backgroundImage !== "none") return true
				const channels = s.backgroundColor.match(/[\d.]+/g)?.map(Number)
				return (
					channels !== undefined &&
					s.backgroundColor !== "transparent" &&
					(channels.length < 4 || channels[3] >= 0.9)
				)
			}

			// every text and control, and everything opaque that can hide them
			const items: Item[] = []
			const covers: Cover[] = []
			const range = document.createRange()
			for (const element of document.body.querySelectorAll("*")) {
				if (element.closest("svg, canvas, script, style, template, noscript"))
					continue
				const s = style(element)
				const control = element.matches(CONTROL)
				const kind =
					s.position === "sticky"
						? "bar"
						: element.matches(LAYER)
							? "layer"
							: !control &&
								  element.childElementCount > 0 &&
								  s.display !== "contents" &&
								  s.display !== "inline"
								? "panel"
								: null
				if (kind !== null && opaque(s) && shown(element)) {
					const { clip, scroller } = clipOf(element, false)
					const rect = intersect(toRect(element.getBoundingClientRect()), clip)
					if (
						width(rect) > 0 &&
						height(rect) > 0 &&
						(kind !== "bar" || scroller !== null)
					)
						covers.push({ element, rect, kind, scroller })
				}
				const words = control ? [] : textNodes(element)
				if (!control && words.length === 0) continue
				// a control's own words are part of the control
				if (!control && element.parentElement?.closest(CONTROL) != null)
					continue
				if (skip !== undefined && element.closest(skip) !== null) continue
				if (!shown(element)) continue
				const hit = control ? target(element) : element
				let rects: Rect[]
				if (control) {
					// a link in running text is its line boxes, like the words round it
					rects =
						s.display === "inline"
							? [...hit.getClientRects()].map(toRect)
							: [toRect(hit.getBoundingClientRect())]
				} else {
					rects = []
					for (const node of words) {
						range.selectNodeContents(node)
						rects.push(...[...range.getClientRects()].map(toRect))
					}
				}
				const { clip, fixed, scroller, sideways, upright } = clipOf(
					element,
					!control,
				)
				const big = (rect: Rect) => width(rect) >= 2 && height(rect) >= 2
				const free = rects.map((rect) => intersect(rect, fixed)).filter(big)
				rects = rects.map((rect) => intersect(rect, clip)).filter(big)
				if (rects.length === 0) continue
				items.push({
					element,
					hit,
					rects,
					control,
					text: !control,
					scroller,
					free,
					sideways,
					upright,
				})
			}

			// a CSS module's class without its hash ("_label_1x2y3_12" → "label"), for reading only
			const moduleClass = (element: Element) => {
				for (const name of element.classList) {
					const local = name.match(/^_(.+)_[a-z0-9]{5}_\d+$/)?.[1]
					if (local !== undefined) return `.${local}`
				}
				return ""
			}
			const token = (element: Element, self: boolean): string | null => {
				for (const hook of HOOKS) {
					const value = element.getAttribute(hook)
					if (value === null) continue
					return value === "" ? `[${hook}]` : `[${hook}=${value}]`
				}
				// an id written by hand, not one Mantine or React made up
				if (element.id !== "" && !/^mantine|:|^r\d/.test(element.id))
					return `#${element.id}`
				const tag = element.tagName.toLowerCase()
				const role = element.getAttribute("role")
				if (self)
					return `${tag}${moduleClass(element)}${role === null ? "" : `[role=${role}]`}`
				if (role === "dialog" || role === "group") return `${tag}[role=${role}]`
				return NAMED_TAGS.has(tag) ? tag : null
			}
			/** A short selector path: its tag or hook, up to its nearest test id. */
			const nameOf = (element: Element) => {
				const parts = [token(element, true)!]
				for (
					let node = element.parentElement;
					node !== null && node !== document.body && parts.length < 4;
					node = node.parentElement
				) {
					const part = token(node, false)
					if (part === null) continue
					parts.unshift(part)
					if (part.startsWith("[data-testid=")) break
				}
				return parts.join(" ")
			}
			const textOf = (element: Element) =>
				(
					(element as HTMLElement).innerText ||
					element.getAttribute("aria-label") ||
					element.textContent ||
					""
				)
					.trim()
					.replace(/\s+/g, " ")
					.slice(0, 60)
			const piece = (element: Element, control: boolean) => ({
				name: nameOf(element),
				text: textOf(element),
				control,
			})
			const toBox = (r: Rect) => ({
				left: Math.round(r.left),
				top: Math.round(r.top),
				width: Math.round(width(r)),
				height: Math.round(height(r)),
			})
			const matches = (element: Element, selector: string | undefined) => {
				if (selector === undefined) return false
				try {
					return element.closest(selector) !== null
				} catch {
					return false
				}
			}

			const overlaps: Overlap[] = []
			// each finding's two elements, for matching the allow-list
			const elementsOf = new Map<Overlap | OffScreen, Element[]>()
			const found = (overlap: Overlap, elements: Element[]) => {
				overlaps.push(overlap)
				elementsOf.set(overlap, elements)
			}

			// what is on top is hit-tested, with every element taking the pointer for a moment
			const everything = document.createElement("style")
			everything.textContent = "* { pointer-events: auto !important; }"
			document.head.append(everything)
			const stackAt = (r: Rect) =>
				document.elementsFromPoint(
					(r.left + r.right) / 2,
					(r.top + r.bottom) / 2,
				)
			try {
				// a cover on top hides what it lies over: that part does not count; a
				// line a bar or a panel slices through, partly shown, is a finding
				for (const item of items)
					for (const cover of covers) {
						if (
							cover.element.contains(item.element) ||
							item.element.contains(cover.element) ||
							(cover.kind === "bar" && cover.scroller !== item.scroller)
						)
							continue
						const kept: Rect[] = []
						for (const rect of item.rects) {
							const c = cover.rect
							const under = intersect(rect, c)
							// on top: the cover comes before the piece where they meet (what
							// else is hit there, an empty layer over everything, does not count)
							const stack =
								width(under) > 0 && height(under) > 0 ? stackAt(under) : []
							const coverAt = stack.findIndex((element) =>
								cover.element.contains(element),
							)
							const itemAt = stack.findIndex(
								(element) =>
									item.element.contains(element) || item.hit.contains(element),
							)
							if (coverAt === -1 || (itemAt !== -1 && itemAt < coverAt)) {
								// drawn over a panel it does not belong to: out of place, unless
								// it is meant to lie over the page (a menu; the page's own
								// background is a panel too) or passes over as its scroller's
								// sticky bar does (the sheet's foot over the words)
								const overPage =
									item.element.closest(LAYER) !== null ||
									(c.left <= 0 &&
										c.top <= 0 &&
										c.right >= innerWidth &&
										c.bottom >= innerHeight)
								const passing = covers.some(
									(bar) =>
										bar.kind === "bar" &&
										bar.scroller !== null &&
										bar.element.contains(item.element) &&
										bar.scroller.contains(cover.element),
								)
								if (
									cover.kind === "panel" &&
									coverAt !== -1 &&
									!overPage &&
									!passing &&
									width(under) > min &&
									height(under) > min
								)
									found(
										{
											kind: "overlap",
											a: piece(item.element, item.control),
											b: piece(cover.element, false),
											width: Math.round(width(under)),
											height: Math.round(height(under)),
											onTop: "a",
											box: toBox(under),
											listed: [],
										},
										[item.element, cover.element],
									)
								kept.push(rect)
								continue
							}
							// a control under something opaque is out of a finger's reach: a
							// panel over it at all, a bar over a part of it (wholly behind its
							// own scroller's bar it is scrolled away: the sheet's foot, #62)
							const wholly =
								c.left <= rect.left + 1 &&
								c.right >= rect.right - 1 &&
								c.top <= rect.top + 1 &&
								c.bottom >= rect.bottom - 1
							if (
								item.control &&
								cover.kind !== "layer" &&
								(cover.kind === "panel" || !wholly) &&
								item.element.closest(sceneNames) === null &&
								width(under) > min &&
								height(under) > min
							)
								found(
									{
										kind: "covered",
										a: piece(item.element, true),
										b: piece(cover.element, false),
										width: Math.round(width(under)),
										height: Math.round(height(under)),
										onTop: "b",
										box: toBox(under),
										listed: [],
									},
									[item.element, cover.element],
								)
							// what shows is the larger part beside the cover
							let shownPart = 0
							let hiddenPart = 0
							if (c.left <= rect.left + 1 && c.right >= rect.right - 1) {
								const above = Math.max(0, c.top - rect.top)
								const below = Math.max(0, rect.bottom - c.bottom)
								;[shownPart, hiddenPart] = [
									Math.max(above, below),
									height(under),
								]
								if (above >= below && above > 0)
									kept.push({ ...rect, bottom: c.top })
								else if (below > 0) kept.push({ ...rect, top: c.bottom })
							} else if (c.top <= rect.top + 1 && c.bottom >= rect.bottom - 1) {
								const before = Math.max(0, c.left - rect.left)
								const after = Math.max(0, rect.right - c.right)
								;[shownPart, hiddenPart] = [
									Math.max(before, after),
									width(under),
								]
								if (before >= after && before > 0)
									kept.push({ ...rect, right: c.left })
								else if (after > 0) kept.push({ ...rect, left: c.right })
							} else {
								kept.push(rect)
								continue
							}
							// a scroller that fades its words out before the bar below them (a
							// CSS mask, #75) never slices a line; a sticky header above still can
							const fades =
								cover.kind === "bar" &&
								c.top > rect.top &&
								cover.scroller !== null &&
								[
									style(cover.scroller).maskImage,
									style(cover.scroller).webkitMaskImage,
								].some((mask) => mask !== undefined && mask !== "none")
							if (
								item.text &&
								cover.kind !== "layer" &&
								!fades &&
								hiddenPart > min &&
								shownPart > min
							)
								found(
									{
										kind: "cut",
										a: piece(item.element, false),
										b: piece(cover.element, false),
										width: Math.round(width(under)),
										height: Math.round(height(under)),
										onTop: "b",
										box: toBox(under),
										listed: [],
									},
									[item.element, cover.element],
								)
						}
						item.rects = kept
					}

				const onTop = (a: Item, b: Item, r: Rect): "a" | "b" | "neither" => {
					const stack = stackAt(r)
					const at = (item: Item) =>
						stack.findIndex(
							(element) =>
								item.element.contains(element) || item.hit.contains(element),
						)
					const ia = at(a)
					const ib = at(b)
					if (ia === -1 && ib === -1) return "neither"
					if (ia === -1) return "b"
					if (ib === -1) return "a"
					return ia < ib ? "a" : "b"
				}
				for (let i = 0; i < items.length; i += 1)
					for (let j = i + 1; j < items.length; j += 1) {
						const a = items[i]
						const b = items[j]
						if (
							a.hit.contains(b.element) ||
							b.hit.contains(a.element) ||
							a.element.contains(b.hit) ||
							b.element.contains(a.hit)
						)
							continue
						let best: Rect | null = null
						for (const ra of a.rects)
							for (const rb of b.rects) {
								const r = intersect(ra, rb)
								if (width(r) <= min || height(r) <= min) continue
								if (
									best === null ||
									width(r) * height(r) > width(best) * height(best)
								)
									best = r
							}
						if (best === null) continue
						found(
							{
								kind: "overlap",
								a: piece(a.element, a.control),
								b: piece(b.element, b.control),
								width: Math.round(width(best)),
								height: Math.round(height(best)),
								onTop: onTop(a, b, best),
								box: toBox(best),
								listed: [],
							},
							[a.element, b.element],
						)
					}
			} finally {
				everything.remove()
			}

			// texts past the screen's edge, where nothing scrolls them into view
			const root = document.scrollingElement ?? document.documentElement
			const pageScrolls =
				root.scrollHeight > innerHeight + 1 &&
				!/hidden|clip/.test(
					style(document.body).overflowY + style(root).overflowY,
				)
			const offScreen: OffScreen[] = []
			for (const item of items) {
				if (!item.text) continue
				const out = item.free.find(
					(r) =>
						((r.left < -1 || r.right > innerWidth + 1) && !item.sideways) ||
						((r.top < -1 || r.bottom > innerHeight + 1) &&
							!item.upright &&
							!pageScrolls),
				)
				if (out !== undefined) {
					const off = {
						piece: piece(item.element, false),
						box: toBox(out),
						listed: [],
					}
					offScreen.push(off)
					elementsOf.set(off, [item.element])
				}
			}

			// the allow-list: which entries each finding matches, and which have both pieces on screen
			listed.forEach((entry, index) => {
				for (const overlap of overlaps) {
					if (overlap.kind !== entry.kind) continue
					const [a, b] = elementsOf.get(overlap)!
					if (
						(matches(a, entry.a) && matches(b, entry.b)) ||
						(matches(b, entry.a) && matches(a, entry.b))
					)
						overlap.listed.push(index)
				}
				for (const off of offScreen)
					if (
						entry.kind === "offScreen" &&
						matches(elementsOf.get(off)![0], entry.a)
					)
						off.listed.push(index)
			})
			const onScreen = (selector: string | undefined) =>
				selector === undefined ||
				// what a menu or a bar covers whole is not on screen
				items.some(
					(item) => item.rects.length > 0 && matches(item.element, selector),
				) ||
				covers.some((cover) => matches(cover.element, selector))
			const present = listed.map((entry) => ({
				a: onScreen(entry.a),
				b: onScreen(entry.b),
			}))

			return { overlaps, offScreen, present }
		},
		{
			listed,
			skip,
			min: OVERLAP_PX,
			visibleOpacity: VISIBLE_OPACITY,
			sceneNames: SCENE_NAMES,
			CONTROL,
		},
	)

/**
 * Waits until nothing on the page moves: every visible text and control (the
 * scene's names left out: ./scene.ts `labelsAtRest` waits for those) has
 * kept its box for `frames` consecutive frames. It catches what CSS
 * transitions do not show: a page's own scripted entrance (the dictionary's
 * facts), a panel measuring itself, a lazy part arriving. What an endless
 * CSS animation moves (a pulse) is left out: it never rests.
 */
export const layoutAtRest = (page: Page, frames = 5): Promise<unknown> =>
	page.waitForFunction(
		({ frames, key, names, control }) => {
			const probe = window as unknown as {
				layoutKey?: number
				layoutState?: string
				layoutFor?: number
			}
			if (probe.layoutKey !== key) {
				probe.layoutKey = key
				probe.layoutState = undefined
				probe.layoutFor = 0
			}
			const endless = document
				.getAnimations()
				.filter(
					(animation) =>
						animation.effect?.getComputedTiming().iterations === Infinity,
				)
				.map((animation) => (animation.effect as KeyframeEffect).target)
				.filter((target): target is Element => target instanceof Element)
			const parts: string[] = []
			for (const element of document.body.querySelectorAll("*")) {
				const words = [...element.childNodes].some(
					(node) =>
						node.nodeType === Node.TEXT_NODE &&
						(node.textContent ?? "").trim() !== "",
				)
				if (!words && !element.matches(control)) continue
				if (element.closest(names) !== null) continue
				if (endless.some((target) => target.contains(element))) continue
				const box = element.getBoundingClientRect()
				if (box.width === 0 && box.height === 0) continue
				parts.push(
					[box.left, box.top, box.width, box.height].map(Math.round).join(),
				)
			}
			const state = parts.join(";")
			probe.layoutFor =
				state === probe.layoutState ? (probe.layoutFor ?? 0) + 1 : 0
			probe.layoutState = state
			return probe.layoutFor >= frames
		},
		{ frames, key: Math.random(), names: SCENE_NAMES, control: CONTROL },
		{ polling: "raf", timeout: 20_000 },
	)

/** The names the label layout places (the light flash's, outside it, never rests while it travels). */
const PLACED_NAMES =
	"[data-label-layer] > *, [aria-hidden=true] > [data-craft], [data-belt]"

/**
 * Waits until the scene's names have stood still, none fading or moving, for
 * `ms` of the page's time and at least `frames` frames. Unlike ./scene.ts
 * `labelsAtRest` it spans the label layout's own beat: the layout measures
 * the panels it keeps the names out from under every 0.25 s
 * (`KEEP_OUT_INTERVAL_S` in labels/Labels.tsx) and fades a name to its new
 * place over 0.2 s, so a name a panel just covered may stand still for a few
 * frames before it moves away.
 */
export const namesAtRest = (
	page: Page,
	ms = 600,
	frames = 3,
): Promise<unknown> =>
	page.waitForFunction(
		({ ms, frames, key, names }) => {
			const probe = window as unknown as {
				namesKey?: number
				namesState?: string
				namesSince?: number
				namesFor?: number
			}
			const now = performance.now()
			if (probe.namesKey !== key) {
				probe.namesKey = key
				probe.namesState = undefined
				probe.namesSince = now
				probe.namesFor = 0
			}
			const state = [...document.querySelectorAll<HTMLElement>(names)]
				.map(
					(name) =>
						`${name.style.transform}|${name.style.opacity}|${name.style.visibility}|${name.dataset.visible}`,
				)
				.join()
			if (state !== probe.namesState) {
				probe.namesState = state
				probe.namesSince = now
				probe.namesFor = 0
			} else probe.namesFor = (probe.namesFor ?? 0) + 1
			return probe.namesFor >= frames && now - (probe.namesSince ?? now) >= ms
		},
		{ ms, frames, key: Math.random(), names: PLACED_NAMES },
		{ polling: "raf", timeout: 20_000 },
	)
