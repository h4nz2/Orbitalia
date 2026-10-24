/**
 * Phones: panels never slice text, controls never overlap (#75).
 *
 * - The sheet's words (#60): where they go on under a tour's, a sky event's
 *   or the quick look's Back and Next, or under the entry buttons, they fade
 *   out above them, and at rest no line is cut through; at the end of the
 *   words the fade is gone.
 * - The sheet's handle has a strip of its own: its 44 px target lies over
 *   neither the header under it nor the time chip above, at any height, and
 *   a tap just above the sheet is the scene's.
 * - The top row (#59) gives way before anything overlaps: the name box
 *   shrinks, "Neptune" and "Voyager 1" stay whole, and on a narrow phone the
 *   point of view is under More.
 * - The dictionary on a phone is one column that scrolls: the dots in one
 *   row, the facts readable, the stories below them, nothing over anything.
 *
 * Boxes are read in one evaluate: the page slides in as it opens.
 */
import { expect, test, type Page } from "@playwright/test"

import { openTool, pageInPlace } from "./support/hud"
import { cameraAtRest } from "./support/scene"
import { smallControls } from "./support/touch"

// software WebGL is slow, and a link waits for its scene
test.describe.configure({ timeout: 180_000 })

const PHONES = [
	{ width: 390, height: 844 },
	{ width: 360, height: 640 },
]

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	await cameraAtRest(page)
}

const sheet = (page: Page) => page.getByTestId("sheet")
const handle = (page: Page) => page.getByTestId("sheet-handle")

/** Waits for the sheet to rest at `value`, its content as tall as the height it was given. */
async function restsAt(page: Page, value: "small" | "half" | "full") {
	await expect(sheet(page)).toHaveAttribute("data-sheet-height", value)
	await expect(sheet(page)).not.toHaveAttribute("data-sheet-dragging", "")
	await expect
		.poll(() =>
			page.evaluate(() => {
				const content = document.querySelector<HTMLElement>(
					"[data-testid=sheet-content]",
				)!
				const target = parseFloat(content.style.height)
				const now = content.getBoundingClientRect().height
				return Number.isFinite(target) && Math.abs(now - target) < 0.5
			}),
		)
		.toBe(true)
}

interface Words {
	/** The lines the edge cuts through: a foot's top, else the content's bottom. */
	cut: string[]
	/** Words lie hidden below the edge. */
	hidden: boolean
	/** The content says so (`data-sheet-more`) and fades out (a mask). */
	more: boolean
	masked: boolean
	/** Where the fade ends, px above the content's bottom, and the foot's height there. */
	fadeEnd: number
	foot: number
}

/**
 * The words in the sheet against the edge they pass under, read at once;
 * `scroll` sets the content's scroll first ("end" for its end).
 */
const words = (page: Page, scroll?: number | "end") =>
	page.evaluate((scroll): Words => {
		const area = document.querySelector<HTMLElement>(
			"[data-testid=sheet-content]",
		)!
		if (scroll === "end") area.scrollTop = area.scrollHeight
		else if (scroll !== undefined) area.scrollTop = scroll
		area.dispatchEvent(new Event("scroll"))
		const view = area.getBoundingClientRect()
		const foot = [...area.querySelectorAll("[data-sheet-footer]")].find(
			(element) =>
				element.getClientRects().length > 0 &&
				getComputedStyle(element).position === "sticky",
		)
		const footBox = foot?.getBoundingClientRect()
		const edge = footBox?.top ?? view.bottom
		const cut: string[] = []
		let hidden = false
		const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT)
		const range = document.createRange()
		for (
			let node = walker.nextNode();
			node !== null;
			node = walker.nextNode()
		) {
			const parent = node.parentElement!
			if (
				node.textContent!.trim() === "" ||
				parent.closest("header, [data-sheet-footer]") !== null ||
				(foot !== undefined &&
					!(
						foot.compareDocumentPosition(parent) &
						Node.DOCUMENT_POSITION_PRECEDING
					))
			)
				continue
			range.selectNodeContents(node)
			for (const box of range.getClientRects()) {
				if (box.width < 1 || box.bottom <= view.top + 1) continue
				if (box.bottom > edge + 1) hidden = true
				if (box.top < edge - 1 && box.bottom > edge + 1)
					cut.push(node.textContent!.trim().slice(0, 40))
			}
		}
		const style = getComputedStyle(area)
		const mask = style.maskImage || style.webkitMaskImage
		return {
			cut,
			hidden,
			more: area.hasAttribute("data-sheet-more"),
			masked:
				mask !== undefined && mask !== "none" && mask.includes("gradient"),
			fadeEnd: parseFloat(area.style.getPropertyValue("--sheet-fade-end")),
			foot: footBox === undefined ? 0 : view.bottom - footBox.top,
		}
	}, scroll)

for (const phone of PHONES) {
	test.describe(`an upright phone, ${phone.width}x${phone.height}`, () => {
		test.use({ viewport: phone, hasTouch: true, isMobile: true })

		for (const [what, url] of [
			["a tour stop", "/solar_system?tour=grandTour&lang=en"],
			["a step of the quick look", "/solar_system?look=play&lang=en"],
			["a sky event", "/solar_system?tour=event-solar2024&stop=1&lang=en"],
		] as const)
			test(`${what}: no line cut by Back and Next; the words fade above them until their end`, async ({
				page,
			}) => {
				await ready(page, url)
				// the quick look moves on by itself: hold it on its step
				const auto = page.getByTestId("quick-look-auto")
				if ((await auto.count()) > 0)
					await expect(async () => {
						if ((await auto.getAttribute("aria-pressed")) === "true")
							await auto.tap()
						await expect(auto).toHaveAttribute("aria-pressed", "false")
					}).toPass()
				await restsAt(page, "half")
				const rest = await words(page)
				expect(rest.cut, JSON.stringify(rest)).toEqual([])
				expect(rest.foot).toBeGreaterThan(40)
				// what is hidden fades out above the foot, not at the sheet's bottom
				expect(rest.more).toBe(rest.hidden)
				if (rest.hidden) {
					expect(rest.masked).toBe(true)
					expect(Math.abs(rest.fadeEnd - rest.foot)).toBeLessThan(1)
				}
				// while it scrolls a line may pass under the foot, faded
				const between = await words(page, 9)
				if (between.hidden) expect(between.more && between.masked).toBe(true)
				// at the end: nothing under the foot, no fade
				const end = await words(page, "end")
				expect(end.cut).toEqual([])
				expect(end.more, JSON.stringify(end)).toBe(false)
				expect(end.masked).toBe(false)
			})

		test("a panel without a foot: no line cut by the entry buttons, the fade at the bottom until the end", async ({
			page,
		}) => {
			await ready(page, "/solar_system?light=delay&lang=en")
			await restsAt(page, "half")
			const rest = await words(page)
			expect(rest.cut, JSON.stringify(rest)).toEqual([])
			expect(rest.foot).toBe(0)
			expect(rest.more).toBe(rest.hidden)
			if (rest.hidden) {
				expect(rest.masked).toBe(true)
				expect(rest.fadeEnd).toBe(0)
			}
			const end = await words(page, "end")
			expect(end.more).toBe(false)
			expect(end.masked).toBe(false)
		})

		test("the handle's target lies over nothing, at every height; a tap just above the sheet is the scene's", async ({
			page,
		}) => {
			await ready(page, "/solar_system?focus=earth&lang=en")
			await restsAt(page, "small")
			/** The handle against the shown header's parts and the time chip, read at once. */
			const clashes = () =>
				page.evaluate(() => {
					const handle = document
						.querySelector("[data-testid=sheet-handle]")!
						.getBoundingClientRect()
					const shown =
						document.querySelector("[data-sheet-shown]") ??
						document.querySelector("[data-info] > *")!
					const parts = [
						...shown.querySelectorAll(
							":scope > header *, [data-sheet-summary] *",
						),
						...document.querySelectorAll("[data-testid=time-chip]"),
					]
					const found: string[] = []
					for (const part of parts) {
						if (part.getClientRects().length === 0) continue
						const box = part.getBoundingClientRect()
						const w =
							Math.min(box.right, handle.right) -
							Math.max(box.left, handle.left)
						const h =
							Math.min(box.bottom, handle.bottom) -
							Math.max(box.top, handle.top)
						if (w > 0.5 && h > 0.5)
							found.push(
								`${part.tagName} "${(part.textContent ?? "").trim().slice(0, 20)}" ${Math.round(w)}x${Math.round(h)}`,
							)
					}
					return { found, height: handle.height }
				})
			const small = await clashes()
			expect(small.height).toBeGreaterThan(43.5)
			expect(small.found).toEqual([])
			// the card unfolded at half: its header sticks under the handle's strip
			await handle(page).tap()
			await restsAt(page, "half")
			expect((await clashes()).found).toEqual([])

			// a long list at half and full, scrolled: its header stays under the strip
			await openTool(page, "spacecraft")
			await restsAt(page, "half")
			const list = () =>
				page.evaluate(() => {
					const content = document.querySelector<HTMLElement>(
						"[data-testid=sheet-content]",
					)!
					content.scrollTop = 120
				})
			await list()
			expect((await clashes()).found).toEqual([])
			await handle(page).tap()
			await restsAt(page, "full")
			await list()
			expect((await clashes()).found).toEqual([])
			await page
				.locator("[data-sheet-shown]")
				.getByRole("button", { name: /^Close/ })
				.first()
				.tap()
			await handle(page).focus()
			await page.keyboard.press("Home")
			await restsAt(page, "small")

			// 10 px above the sheet, beside the time chip: the scene's, never the handle's
			await pageInPlace(page)
			await cameraAtRest(page)
			const spot = await page.evaluate(() => {
				const sheet = document
					.querySelector("[data-testid=sheet]")!
					.getBoundingClientRect()
				const handle = document
					.querySelector("[data-testid=sheet-handle]")!
					.getBoundingClientRect()
				const chip = document
					.querySelector("[data-testid=time-chip]")!
					.closest("[data-sheet-above]")!
					.getBoundingClientRect()
				const x = Math.max(handle.left, chip.right) + 4
				const y = sheet.top - 10
				return {
					x,
					y,
					overHandle: x < handle.right,
					target: document.elementFromPoint(x, y)?.tagName,
				}
			})
			expect(spot.overHandle).toBe(true)
			expect(spot.target).toBe("CANVAS")
			await page.touchscreen.tap(spot.x, spot.y)
			// the empty sky's answer on a touch screen (#59): the controls hide; the sheet never moved
			await expect(page.locator("html")).toHaveAttribute(
				"data-chrome",
				"hidden",
			)
			await expect(sheet(page)).toHaveAttribute("data-sheet-height", "small")
		})
	})
}

/** The top row's controls, read at once; null for one that is not there. */
const topRow = (page: Page) =>
	page.evaluate(() => {
		const box = (selector: string) => {
			const element = document.querySelector(selector)
			if (element === null || element.getClientRects().length === 0) return null
			const { left, right, top, bottom } = element.getBoundingClientRect()
			return { left, right, top, bottom }
		}
		const input = document.querySelector<HTMLInputElement>(
			"[data-testid=where] input",
		)!
		const style = getComputedStyle(input)
		const context = document.createElement("canvas").getContext("2d")!
		context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
		const name = input.value || input.placeholder
		return {
			controls: {
				back: box("[data-testid=where] button"),
				home: box("[data-testid=where] button[aria-keyshortcuts=Escape]"),
				name: box("[data-testid=where] .mantine-Select-root"),
				pointOfView: box("[data-testid=frame-menu]"),
				more: box("[data-testid=more-menu]"),
			},
			where: box("[data-testid=where]")!,
			corner: box("[data-testid=corner]")!,
			name,
			// the name's text against the room the box gives it
			nameRoom:
				input.clientWidth -
				parseFloat(style.paddingLeft) -
				parseFloat(style.paddingRight) -
				context.measureText(name).width,
		}
	})

for (const width of [320, 360, 390]) {
	test.describe(`the top row at ${width} px`, () => {
		test.use({
			viewport: { width, height: 700 },
			hasTouch: true,
			isMobile: true,
		})

		test(`nothing overlaps, in English and German, and "Neptune" and "Voyager 1" stay whole`, async ({
			page,
		}) => {
			test.slow()
			for (const lang of ["en", "de"])
				for (const [url, name] of [
					[`/solar_system?focus=neptune&lang=${lang}`, /^Neptun/],
					[
						`/solar_system?craft=voyager1&follow=true&lang=${lang}`,
						/^Voyager 1$/,
					],
				] as const) {
					await ready(page, url)
					const row = await topRow(page)
					const at = `${lang} ${url}`
					expect(row.name, at).toMatch(name)
					expect(row.nameRoom, `${at}: the name whole`).toBeGreaterThanOrEqual(
						0,
					)
					// on a narrow phone the point of view is under More
					expect(row.controls.pointOfView === null, at).toBe(width < 358)
					const boxes = Object.entries(row.controls).filter(
						(entry): entry is [string, NonNullable<(typeof entry)[1]>] =>
							entry[1] !== null,
					)
					for (const [one, a] of boxes) {
						expect(a.left, `${at}: ${one} on screen`).toBeGreaterThanOrEqual(0)
						expect(a.right, `${at}: ${one} on screen`).toBeLessThanOrEqual(
							width,
						)
						for (const [other, b] of boxes) {
							if (one >= other) continue
							const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
							const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
							expect(w > 0.5 && h > 0.5, `${at}: ${one} over ${other}`).toBe(
								false,
							)
						}
					}
					// the name, its buttons and More each inside their own panel
					for (const one of ["back", "home", "name", "pointOfView"] as const) {
						const b = row.controls[one]
						if (b !== null)
							expect(b.right, `${at}: ${one} in its panel`).toBeLessThanOrEqual(
								row.where.right + 0.5,
							)
					}
					expect(row.corner.left).toBeGreaterThanOrEqual(row.where.right)
				}
			expect(await smallControls(page)).toEqual([])
		})

		if (width < 358)
			test("the point of view is under More, one more tap away, and works", async ({
				page,
			}) => {
				await ready(page, "/solar_system?focus=mars&lang=en")
				await page.getByTestId("more-menu").tap()
				const panel = page.getByTestId("more-panel")
				const item = panel.getByTestId("more-point-of-view")
				await expect(item).toHaveText("Point of view: Sun-centred")
				await expect(item).toHaveAccessibleDescription(/stays still/)
				await item.tap()
				await expect(panel.getByTestId("frame-choices")).toBeVisible()
				expect(await smallControls(page)).toEqual([])
				await panel.locator("[data-preset=planets]").tap()
				// More closes, and Earth is held still
				await expect(panel).toBeHidden()
				await expect
					.poll(() =>
						page.evaluate(() => window.__orbitalia!.store.getState().frameId),
					)
					.toBe("earth")
				await page.getByTestId("more-menu").tap()
				await expect(item).toHaveText("Point of view: Seen from Earth")
			})
	})
}

/**
 * Every visible text and control of the page in one column: pairs of them
 * that overlap (neither inside the other), measured at the page's top.
 */
const pageOverlaps = (page: Page) =>
	page.evaluate(() => {
		window.scrollTo(0, 0)
		const items: { element: Element; boxes: DOMRect[]; text: string }[] = []
		for (const element of document.querySelectorAll("body *")) {
			if (element.closest("canvas, svg, [aria-hidden=true]")) continue
			const text = [...element.childNodes].some(
				(child) =>
					child.nodeType === Node.TEXT_NODE &&
					(child.textContent ?? "").trim() !== "",
			)
			const control = element.matches(
				"button, a[href], input, [role=button], [role=switch]",
			)
			if (!text && !control) continue
			// an inline run that wraps is one box per line
			const boxes = [...element.getClientRects()].filter(
				(box) => box.width >= 2 && box.height >= 2,
			)
			if (boxes.length === 0) continue
			const style = getComputedStyle(element)
			if (style.visibility === "hidden" || Number(style.opacity) < 0.15)
				continue
			items.push({
				element,
				boxes,
				text: (
					(element as HTMLElement).innerText ||
					element.getAttribute("aria-label") ||
					""
				)
					.trim()
					.slice(0, 30),
			})
		}
		const found: string[] = []
		for (let i = 0; i < items.length; i++)
			for (let j = i + 1; j < items.length; j++) {
				const a = items[i]
				const b = items[j]
				if (a.element.contains(b.element) || b.element.contains(a.element))
					continue
				const meet = a.boxes.some((p) =>
					b.boxes.some(
						(q) =>
							Math.min(p.right, q.right) - Math.max(p.left, q.left) > 2 &&
							Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 2,
					),
				)
				if (meet) found.push(`"${a.text}" × "${b.text}"`)
			}
		return found
	})

for (const [width, height, lang] of [
	[390, 844, "lang=en"],
	[360, 640, "lang=en"],
	[360, 640, "lang=de&reading=simple"],
] as const)
	test.describe(`the dictionary at ${width}x${height} (${lang})`, () => {
		test.use({ viewport: { width, height }, hasTouch: true, isMobile: true })

		test("one column: the dots in a row, the facts readable, the stories below them, nothing over anything", async ({
			page,
		}) => {
			await page.goto(`/solar_dictionary?entity=6&section=madeOf&${lang}`)
			const madeOf = page.getByTestId("dictionary-section-madeOf")
			await expect(madeOf).toHaveAttribute("aria-expanded", "true")
			// the facts have faded in
			await expect
				.poll(() =>
					page.evaluate(() =>
						[
							...document.querySelectorAll(
								"[data-fact-label], [data-fact-value]",
							),
						].every((fact) => Number(getComputedStyle(fact).opacity) > 0.99),
					),
				)
				.toBe(true)
			expect(await pageOverlaps(page)).toEqual([])
			const layout = await page.evaluate(() => {
				const dots = [
					...document.querySelectorAll<HTMLElement>("[data-dictionary-world]"),
				]
				const row = dots[0].parentElement!
				const facts = [
					...document.querySelectorAll<HTMLElement>("[data-fact-key]"),
				]
				const label = facts[0].querySelector("[data-fact-label]")!
				const value = facts[1].querySelector("[data-fact-value]")!
				const extra = facts[1].querySelector("[data-fact-extra]")
				const active = row
					.querySelector("[data-active]")!
					.getBoundingClientRect()
				const rowBox = row.getBoundingClientRect()
				const story = document
					.querySelector("[data-testid=dictionary-section-madeOf]")!
					.getBoundingClientRect()
				const size = (element: Element | null) =>
					element === null ? 16 : parseFloat(getComputedStyle(element).fontSize)
				const spacing = (element: Element) => {
					const value = getComputedStyle(element).letterSpacing
					return value === "normal" ? 0 : parseFloat(value)
				}
				return {
					count: dots.length,
					tops: new Set(
						dots.map((dot) => Math.round(dot.getBoundingClientRect().top)),
					).size,
					rowBottom: rowBox.bottom,
					scrolls: row.scrollWidth > row.clientWidth,
					activeInView:
						active.left >= rowBox.left - 0.5 &&
						active.right <= rowBox.right + 0.5,
					firstFactTop: facts[0].getBoundingClientRect().top,
					lastFactBottom:
						facts[facts.length - 1].getBoundingClientRect().bottom,
					storyTop: story.top,
					labelSize: size(label),
					labelSpacing: spacing(label),
					valueSize: size(value),
					valueSpacing: spacing(value),
					extraSize: size(extra),
					overflow: document.documentElement.scrollWidth - window.innerWidth,
				}
			})
			// the nine worlds in one row above the facts' headings; it scrolls sideways
			// where they do not fit, the chosen one in view
			expect(layout.count).toBe(9)
			expect(layout.tops).toBe(1)
			expect(layout.rowBottom).toBeLessThanOrEqual(layout.firstFactTop)
			expect(layout.activeInView).toBe(true)
			if (width < 400) expect(layout.scrolls).toBe(true)
			// readable: no letter-spaced micro type
			expect(layout.labelSize).toBeGreaterThanOrEqual(12)
			expect(layout.labelSpacing).toBeLessThan(1)
			expect(layout.valueSize).toBeGreaterThanOrEqual(16)
			expect(layout.valueSpacing).toBeLessThan(1)
			expect(layout.extraSize).toBeGreaterThanOrEqual(14)
			// the stories come after every fact, in the page's flow
			expect(layout.storyTop).toBeGreaterThanOrEqual(layout.lastFactBottom)
			expect(layout.overflow).toBeLessThanOrEqual(0)
			// the dots and the bars are finger-sized
			expect(await smallControls(page)).toEqual([])
			// the open section is a scroll away, and opens in place
			await madeOf.scrollIntoViewIfNeeded()
			await expect(
				page.getByRole("img", { name: /Saturn/ }).first(),
			).toBeVisible()
		})
	})

test.describe("the dictionary on a laptop", () => {
	test.use({ viewport: { width: 1366, height: 768 } })

	test("keeps the facts and the stories at the globe's sides", async ({
		page,
	}) => {
		await page.goto("/solar_dictionary?entity=6&section=madeOf&lang=en")
		await expect(page.getByTestId("dictionary-section-madeOf")).toBeVisible()
		const places = await page.evaluate(() => {
			const facts = document.querySelector("[data-fact-key]")!.parentElement!
			const column = document
				.querySelector("[data-testid=dictionary-section-madeOf]")!
				.closest("aside")!
			return [facts, column].map(
				(element) => getComputedStyle(element).position,
			)
		})
		expect(places).toEqual(["fixed", "fixed"])
	})
})
