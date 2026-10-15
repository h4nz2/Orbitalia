/**
 * Students first (#62): students open their teacher's links on their own
 * phones, held upright. Every kind of link opens with the shared thing ready
 * in the sheet (#60), its main action within thumb reach (the lower half of
 * the screen) and nothing to close first; a sideways swipe on a world's card
 * flies to the next world; Tools is a grid of tiles; the tour shows a compact
 * progress; a first-time hint shows the moves that have no button; and the
 * children's words (German at the simple level) fit at 360 px.
 *
 * Boxes are measured on the page and the canvas in one evaluate: the page
 * slides in as it opens, the canvas and the HUD together (see #61's
 * `onCanvas`).
 */
import { expect, test, type Page } from "@playwright/test"

import { openTool } from "./support/hud"
import { cameraAtRest } from "./support/scene"
import { smallControls, TOUCH_TARGET_PX } from "./support/touch"

// software WebGL is slow, and a link waits for its scene
test.describe.configure({ timeout: 180_000 })

const PHONES = [
	{ width: 390, height: 844 },
	{ width: 360, height: 640 },
]

const HINT_KEY = "orbitalia.gestureHintShown"

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	await cameraAtRest(page)
}

const sheet = (page: Page) => page.getByTestId("sheet")
const html = (page: Page) => page.locator("html")

/** Waits for the sheet to rest at `value`, its content as tall as the height it was given. */
async function restsAt(page: Page, value: "small" | "half" | "full") {
	await expect(sheet(page)).toHaveAttribute("data-sheet-height", value)
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

/**
 * Where `selector`'s first visible element is, as shares of the canvas's
 * height (its top, centre and bottom), and whether it is the topmost thing
 * at its centre: nothing in front of it.
 */
const reach = (page: Page, selector: string) =>
	page.evaluate((selector) => {
		const canvas = document.querySelector("canvas")!.getBoundingClientRect()
		const element = [...document.querySelectorAll(selector)].find(
			(e) => e.getClientRects().length > 0,
		)
		if (element === undefined) return null
		const box = element.getBoundingClientRect()
		const x = box.left + box.width / 2
		const y = box.top + Math.min(box.height, 44) / 2
		const top = document.elementFromPoint(x, y)
		return {
			top: (box.top - canvas.top) / canvas.height,
			centre: (box.top + box.height / 2 - canvas.top) / canvas.height,
			bottom: (box.bottom - canvas.top) / canvas.height,
			onTop: top !== null && (element.contains(top) || top.contains(element)),
		}
	}, selector)

/** What a link opened, and its main action: in the lower half, on screen, nothing in front of it. */
async function expectInReach(page: Page, selector: string, what: string) {
	await expect(page.locator(selector).first()).toBeVisible()
	const at = await reach(page, selector)
	expect(at, what).not.toBeNull()
	expect(at!.centre, `${what}: in the lower half`).toBeGreaterThanOrEqual(0.5)
	expect(at!.bottom, `${what}: on screen`).toBeLessThanOrEqual(1.001)
	expect(at!.onTop, `${what}: nothing in front of it`).toBe(true)
}

/** Nothing to close first: no question, no opening, no dialog over the shared thing. */
async function expectNothingInTheWay(page: Page) {
	await expect(page.getByTestId("quick-look-ask")).toHaveCount(0)
	await expect(page.getByRole("dialog")).toHaveCount(0)
	await expect(html(page)).not.toHaveAttribute("data-intro", "playing")
	await expect(html(page)).not.toHaveAttribute("data-chrome", "hidden")
}

interface Link {
	name: string
	url: string
	kind: string
	/** What must be there. */
	shows: string
	/** Its main action (or actions), which must be within thumb reach. */
	actions: string[]
	/** A world shown big: across at least this share of the width (#62: faint rings may run off). */
	big?: { id: string; share: number }
}

const LINKS: Link[] = [
	{
		name: "a tour stop",
		url: "/solar_system?tour=grandTour&stop=3&lang=en",
		kind: "tour",
		shows: "[data-tour-card][data-stop]",
		actions: [
			"[data-testid=tour-next]",
			"[data-tour-card] [data-sheet-footer]",
		],
	},
	{
		name: "a tour from its start",
		url: "/solar_system?tour=howBig&lang=en",
		kind: "tour",
		shows: "[data-tour-card]",
		actions: ["[data-testid=tour-next]"],
	},
	{
		name: "a hunt",
		url: "/solar_system?hunt=lookAndFind&lang=en",
		kind: "hunt",
		shows: "[data-sheet-shown][data-sheet-kind=hunt] [data-testid=hunt-clue]",
		actions: ["[data-testid=hunt-clue]", "[data-testid=hunt-hint]"],
	},
	{
		name: "a hunt at the simple level",
		url: "/solar_system?hunt=firstSteps&lang=en&reading=simple",
		kind: "hunt",
		shows: "[data-sheet-shown][data-sheet-kind=hunt] [data-testid=hunt-clue]",
		actions: ["[data-testid=hunt-clue]", "[data-testid=hunt-hint]"],
	},
	{
		name: "a planet",
		url: "/solar_system?focus=jupiter&lang=en",
		kind: "card",
		shows: "[data-card-body=jupiter]",
		actions: ["[data-testid=body-card] header"],
		// its faint rings do not shrink it to a third of the width (#62)
		big: { id: "jupiter", share: 0.6 },
	},
	{
		name: "a planet with a laptop's camera",
		url: "/solar_system?focus=saturn&cam=35_20_1&lang=en",
		kind: "card",
		shows: "[data-card-body=saturn]",
		actions: ["[data-testid=body-card] header"],
	},
	{
		name: "a moon",
		url: "/solar_system?focus=europa&lang=en",
		kind: "card",
		shows: "[data-card-body=europa]",
		actions: ["[data-testid=body-card] header"],
	},
	{
		name: "the light flash",
		url: "/solar_system?light=flash&lang=en",
		kind: "panel",
		shows: "[data-light-panel]",
		actions: ["[data-testid=light-send]"],
	},
	{
		name: "the signal delay",
		url: "/solar_system?light=delay&lang=en",
		kind: "panel",
		shows: "[data-light-panel]",
		actions: ["[data-light-panel] [data-light-delay]"],
	},
	{
		name: "the birthday",
		url: "/solar_system?birthday=true&lang=en",
		kind: "panel",
		shows: "#birthday-panel",
		actions: ["#birthday-panel .mantine-DatePicker-yearsListControl"],
	},
	{
		name: "tonight's sky",
		url: "/solar_system?sky=true&lang=en",
		kind: "panel",
		shows: "[data-sheet-shown]",
		actions: ["[data-sheet-shown] [data-sheet-main] .mantine-Button-root"],
	},
	{
		name: "a spacecraft",
		url: "/solar_system?craft=voyager1&lang=en",
		kind: "card",
		shows: "section[data-craft=voyager1]",
		actions: ["section[data-craft=voyager1] header"],
	},
	{
		name: "following a spacecraft",
		url: "/solar_system?craft=voyager1&follow=true&lang=en",
		kind: "card",
		shows: "section[data-craft=voyager1]",
		actions: ["section[data-craft=voyager1] header"],
	},
]

for (const phone of PHONES) {
	test.describe(`a student's phone, ${phone.width}x${phone.height}`, () => {
		test.use({ viewport: phone, hasTouch: true, isMobile: true })

		for (const link of LINKS)
			test(`${link.name} opens ready, in thumb reach, with nothing to close first`, async ({
				page,
			}) => {
				await ready(page, link.url)
				await expect(sheet(page)).toHaveAttribute("data-sheet-kind", link.kind)
				await expect(page.locator(link.shows).first()).toBeVisible({
					timeout: 30_000,
				})
				await expectNothingInTheWay(page)
				await cameraAtRest(page, 5)
				await expect(sheet(page)).not.toHaveAttribute("data-sheet-dragging", "")
				for (const action of link.actions)
					await expectInReach(page, action, `${link.name}: ${action}`)
				if (link.big !== undefined) {
					const { id, share } = link.big
					const across = await page.evaluate(
						(id) =>
							(2 * window.__orbitalia!.screenOf(id)!.discPx) /
							document.querySelector("canvas")!.getBoundingClientRect().width,
						id,
					)
					expect(across, `${id} across the width`).toBeGreaterThan(share)
				}
				expect(await smallControls(page)).toEqual([])
			})

		test("a sideways swipe on Earth's card flies to Mars, the other way to Venus, and Back returns", async ({
			page,
		}) => {
			await ready(page, "/solar_system?focus=earth&lang=en")
			await restsAt(page, "small")
			const card = page.getByTestId("body-card")
			await expect(card).toHaveAttribute("data-card-body", "earth")

			// mid-way the card follows the finger a little
			const moved = await swipeCard(page, -1, { look: true })
			expect(Math.abs(moved!)).toBeGreaterThan(4)
			expect(Math.abs(moved!)).toBeLessThanOrEqual(72)
			await expect(card).toHaveAttribute("data-card-body", "mars")
			await expect.poll(() => focusId(page)).toBe("mars")
			// the card springs back into place for the next world
			await expect
				.poll(() =>
					card.evaluate((element) => (element as HTMLElement).style.transform),
				)
				.toBe("")
			await cameraAtRest(page)

			// Back (#46): the swipe was a step
			await page.getByTestId("back-button").tap()
			await expect(card).toHaveAttribute("data-card-body", "earth")
			await expect.poll(() => focusId(page)).toBe("earth")
			await cameraAtRest(page)

			await swipeCard(page, 1)
			await expect(card).toHaveAttribute("data-card-body", "venus")
			await expect.poll(() => focusId(page)).toBe("venus")
			await cameraAtRest(page)
			await page.getByTestId("back-button").tap()
			await expect(card).toHaveAttribute("data-card-body", "earth")
			await cameraAtRest(page)

			// an upright move is the sheet's, never a swipe; a short one is nothing
			await swipeCard(page, -1, { dx: 30 })
			await swipeCard(page, -1, { dx: 60, dy: -60 })
			await cameraAtRest(page)
			await expect(card).toHaveAttribute("data-card-body", "earth")
			expect(await focusId(page)).toBe("earth")
		})

		test("Tools is nine large tiles in the sheet, all in view without scrolling", async ({
			page,
		}) => {
			await ready(page, "/solar_system?focus=earth&lang=en")
			await page.getByTestId("tools-menu").tap()
			const panel = page.locator("[data-dock-panel=tools]")
			await expect(panel).toBeVisible()
			await expect(page.getByRole("menu")).toHaveCount(0)
			await restsAt(page, "half")
			const tiles = panel.locator("[data-tool]")
			await expect(tiles).toHaveCount(9)
			// what you do with a phone in your hand first
			expect(
				await tiles.evaluateAll((all) =>
					all.map((tile) => tile.getAttribute("data-tool")),
				),
			).toEqual([
				"hunt",
				"birthday",
				"sky",
				"postcard",
				"compare",
				"light",
				"spacecraft",
				"walk",
				"dictionary",
			])
			const layout = await page.evaluate(() => {
				const content = document.querySelector<HTMLElement>(
					"[data-testid=sheet-content]",
				)!
				const view = content.getBoundingClientRect()
				return {
					scrolls: content.scrollHeight > content.clientHeight + 1,
					tiles: [...document.querySelectorAll("[data-tool]")].map((tile) => {
						const box = tile.getBoundingClientRect()
						return {
							width: box.width,
							height: box.height,
							inside:
								box.top >= view.top - 1 &&
								box.bottom <= view.bottom + 1 &&
								box.bottom <= window.innerHeight,
						}
					}),
				}
			})
			expect(layout.scrolls).toBe(false)
			for (const tile of layout.tiles) {
				expect(tile.width).toBeGreaterThanOrEqual(TOUCH_TARGET_PX)
				expect(tile.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PX)
				expect(tile.inside).toBe(true)
			}
			expect(await smallControls(page)).toEqual([])

			// a tile does what the menu's item does: the hunt opens in the tiles' place
			await openTool(page, "hunt")
			await expect(
				page.locator("[data-sheet-shown][data-sheet-kind=hunt]"),
			).toBeVisible()
			await expect(panel).toHaveCount(0)
			await expect(page.getByTestId("tools-menu")).toHaveAttribute(
				"data-variant",
				"light",
			)
		})

		test("a tour stop shows a compact progress instead of a dot per stop", async ({
			page,
		}) => {
			await ready(page, "/solar_system?tour=grandTour&stop=3&lang=en")
			const card = page.locator("[data-tour-card]")
			await expect(card).toBeVisible()
			const progress = page.getByTestId("tour-progress")
			await expect(progress).toBeVisible()
			await expect(progress).toHaveAttribute("aria-valuenow", "3")
			await expect(progress).toHaveAttribute("aria-valuemax", "11")
			await expect(progress).toHaveAttribute("aria-valuetext", "Stop 3 of 11")
			await expect(page.getByTestId("tour-count")).toHaveText("3 / 11")
			await expect(card.locator("ol button")).toHaveCount(0)
			// Back and Next have the foot to themselves; autoplay and the link sit under the words
			const foot = card.locator("[data-sheet-footer]")
			await expect(foot.getByTestId("tour-next")).toBeVisible()
			await expect(foot.getByTestId("tour-autoplay")).toHaveCount(0)
			await expect(card.getByTestId("tour-autoplay")).toBeAttached()
			await page.getByTestId("tour-next").tap()
			await expect(progress).toHaveAttribute("aria-valuenow", "4")
			await expect(page.getByTestId("tour-count")).toHaveText("4 / 11")
		})
	})
}

test.describe("children's words fit: German at the simple level, 360x640", () => {
	test.use({
		viewport: { width: 360, height: 640 },
		hasTouch: true,
		isMobile: true,
	})

	test("the card, the time chip, More, the tiles, the tour, the hunt and the entry row: nothing cut off", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=de&reading=simple")
		await expect(page.getByTestId("body-card")).toBeVisible()
		expect(
			await truncated(page, [
				"[data-testid=body-card] header",
				"[data-testid=time-chip]",
				"[data-testid=more-menu]",
				"[data-testid=entry-bar]",
				"[data-testid=where]",
			]),
		).toEqual([])

		await page.getByTestId("more-menu").tap()
		await expect(page.getByTestId("more-panel")).toBeVisible()
		expect(await truncated(page, ["[data-testid=more-panel]"])).toEqual([])
		await page.getByTestId("more-menu").tap()
		await expect(page.getByTestId("more-panel")).toBeHidden()

		await page.getByTestId("tools-menu").tap()
		await expect(page.locator("[data-dock-panel=tools]")).toBeVisible()
		await restsAt(page, "half")
		expect(await truncated(page, ["[data-dock-panel=tools]"])).toEqual([])

		// a world with a long name
		await ready(page, "/solar_system?focus=ganymede&lang=de&reading=simple")
		await expect(page.getByTestId("body-card")).toBeVisible()
		expect(await truncated(page, ["[data-testid=body-card] header"])).toEqual(
			[],
		)

		await ready(
			page,
			"/solar_system?tour=grandTour&stop=3&lang=de&reading=simple",
		)
		await expect(page.locator("[data-tour-card]")).toBeVisible()
		await expect(page.getByTestId("tour-count")).toHaveText("3 / 11")
		expect(
			await truncated(page, [
				"[data-tour-card] header",
				"[data-tour-card] [data-sheet-footer]",
			]),
		).toEqual([])

		await ready(page, "/solar_system?hunt=lookAndFind&lang=de&reading=simple")
		const hunt = "[data-sheet-shown][data-sheet-kind=hunt]"
		await expect(page.locator(hunt)).toBeVisible()
		expect(await truncated(page, [hunt])).toEqual([])
	})

	test("the gesture hint fits too", async ({ page }) => {
		await page.addInitScript((key) => localStorage.removeItem(key), HINT_KEY)
		await ready(page, "/solar_system?focus=earth&lang=de&reading=simple")
		const hint = page.getByTestId("gesture-hint")
		await expect(hint).toBeVisible({ timeout: 30_000 })
		expect(await truncated(page, ["[data-gesture-hint]"])).toEqual([])
		expect(await smallControls(page)).toEqual([])
	})
})

test.describe("the gesture hint on a phone held upright", () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	})

	// a first-time visitor to this device's phone arrangement
	test.beforeEach(async ({ page }) => {
		await page.addInitScript((key) => {
			if (sessionStorage.getItem("kept") === null) localStorage.removeItem(key)
			sessionStorage.setItem("kept", "1")
		}, HINT_KEY)
	})

	test("appears once on a link's world, clear of the sheet; OK takes it away and nothing else", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		const hint = page.getByTestId("gesture-hint")
		await expect(hint).toBeVisible({ timeout: 30_000 })
		await expect(hint).toContainText("Drag")
		await expect(hint).toContainText("Tap the sky")
		await expect(hint).toContainText("Swipe the card")
		expect(
			await page.evaluate((key) => localStorage.getItem(key), HINT_KEY),
		).toBe("1")

		// above the time chip: clear of the sheet, its handle and the card
		const boxes = await page.evaluate(() => {
			const box = (selector: string) =>
				document.querySelector(selector)!.getBoundingClientRect().toJSON()
			return {
				hint: box("[data-gesture-hint]"),
				chip: box("[data-testid=time-chip]"),
				sheet: box("[data-testid=sheet]"),
				handle: box("[data-testid=sheet-handle]"),
				band: box("[data-free-area]"),
			}
		})
		expect(boxes.hint.bottom).toBeLessThanOrEqual(boxes.chip.top + 1)
		expect(boxes.hint.bottom).toBeLessThanOrEqual(boxes.handle.top + 1)
		expect(boxes.hint.bottom).toBeLessThan(boxes.sheet.top)
		// the scene is framed above it, so it covers no world
		await expect
			.poll(async () =>
				page.evaluate(() => {
					const band = document
						.querySelector("[data-free-area]")!
						.getBoundingClientRect()
					const hint = document
						.querySelector("[data-gesture-hint]")!
						.getBoundingClientRect()
					return Math.abs(band.bottom - hint.top) < 2
				}),
			)
			.toBe(true)
		expect(await smallControls(page)).toEqual([])

		const height = await sheet(page).getAttribute("data-sheet-height")
		await page.getByTestId("gesture-hint-ok").tap()
		await expect(hint).toHaveCount(0)
		await expect(html(page)).not.toHaveAttribute("data-chrome", "hidden")
		await expect(sheet(page)).toHaveAttribute("data-sheet-height", height!)

		// once: not again on the next visit
		await ready(page, "/solar_system?focus=mars&lang=en")
		await page.waitForTimeout(6000)
		await cameraAtRest(page)
		await expect(hint).toHaveCount(0)
	})

	test("a tap on the sky takes it away, and neither hides the controls nor lowers the sheet", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		const hint = page.getByTestId("gesture-hint")
		await expect(hint).toBeVisible({ timeout: 30_000 })
		// the card unfolded: the sheet at half, which a tap on the sky would lower (#60)
		await page.getByTestId("card-toggle").tap()
		await restsAt(page, "half")
		await expect(hint).toBeVisible()
		await cameraAtRest(page)
		const spot = await page.evaluate(() => {
			const band = document
				.querySelector("[data-free-area]")!
				.getBoundingClientRect()
			const canvas = document.querySelector("canvas")!.getBoundingClientRect()
			const earth = window.__orbitalia!.screenOf("earth")!
			const centre = { x: canvas.x + earth.x, y: canvas.y + earth.y }
			for (let y = band.top + 24; y < band.bottom - 24; y += 12)
				for (let x = 24; x < window.innerWidth - 24; x += 12)
					if (
						Math.hypot(x - centre.x, y - centre.y) > earth.discPx + 40 &&
						document.elementFromPoint(x, y)?.tagName === "CANVAS"
					)
						return { x, y }
			return null
		})
		expect(spot, "sky in view").not.toBeNull()
		await page.touchscreen.tap(spot!.x, spot!.y)
		await expect(hint).toHaveCount(0)
		await page.waitForTimeout(500)
		await expect(html(page)).not.toHaveAttribute("data-chrome", "hidden")
		await expect(sheet(page)).toHaveAttribute("data-sheet-height", "half")
		await expect(page.getByTestId("card-toggle")).toHaveAttribute(
			"aria-expanded",
			"true",
		)
	})

	test("a swipe of the card is one of its moves: it takes the hint away", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		const hint = page.getByTestId("gesture-hint")
		await expect(hint).toBeVisible({ timeout: 30_000 })
		await swipeCard(page, -1)
		await expect(hint).toHaveCount(0)
		await expect(page.getByTestId("body-card")).toHaveAttribute(
			"data-card-body",
			"mars",
		)
	})

	test("over a hunt it waits: the clue is the point, and the scene must stay free", async ({
		page,
	}) => {
		await ready(page, "/solar_system?hunt=lookAndFind&lang=en")
		await expect(page.getByTestId("hunt-clue")).toBeVisible()
		await page.waitForTimeout(6000)
		await cameraAtRest(page)
		await expect(page.getByTestId("gesture-hint")).toHaveCount(0)
		expect(
			await page.evaluate((key) => localStorage.getItem(key), HINT_KEY),
		).toBeNull()
	})
})

for (const device of [
	{ name: "a laptop", viewport: { width: 1366, height: 768 }, touch: false },
	{ name: "a tablet", viewport: { width: 768, height: 1024 }, touch: true },
])
	test.describe(`${device.name}, ${device.viewport.width}x${device.viewport.height}`, () => {
		test.use({
			viewport: device.viewport,
			hasTouch: device.touch,
			isMobile: device.touch,
		})

		test("never shows the gesture hint, keeps the Tools menu and the tour's dots", async ({
			page,
		}) => {
			await page.addInitScript((key) => localStorage.removeItem(key), HINT_KEY)
			await ready(page, "/solar_system?focus=earth&lang=en")
			await page.waitForTimeout(6000)
			await cameraAtRest(page)
			await expect(page.getByTestId("gesture-hint")).toHaveCount(0)
			expect(
				await page.evaluate((key) => localStorage.getItem(key), HINT_KEY),
			).toBeNull()

			await page.getByTestId("tools-menu").click()
			await expect(page.getByRole("menu")).toBeVisible()
			await expect(page.getByRole("menu").locator("[data-tool]")).toHaveCount(9)
			await expect(page.locator("[data-dock-panel=tools]")).toHaveCount(0)
			await page.getByTestId("tools-menu").click()

			await ready(page, "/solar_system?tour=grandTour&stop=3&lang=en")
			const card = page.locator("[data-tour-card]")
			await expect(card).toBeVisible()
			await expect(card.locator("ol button")).toHaveCount(11)
			await expect(page.getByTestId("tour-progress")).toHaveCount(0)
			await expect(page.getByTestId("tour-count")).toHaveText("Stop 3 of 11")
		})
	})

/** The focused body. */
const focusId = (page: Page) =>
	page.evaluate(() => window.__orbitalia!.store.getState().focusId)

/**
 * A finger on the world's card moving sideways (CDP touch events, which
 * Chromium also sends as pointer events): `direction` -1 to the left (the
 * next world), 1 to the right. With `look`, returns how far the card had
 * followed the finger half way.
 */
async function swipeCard(
	page: Page,
	direction: 1 | -1,
	{
		dx = 140,
		dy = 0,
		look = false,
	}: { dx?: number; dy?: number; look?: boolean } = {},
): Promise<number | null> {
	const start = await page.evaluate(() => {
		const name = document
			.querySelector("[data-testid=body-card] h2")!
			.getBoundingClientRect()
		return { x: name.left + name.width / 2 + 60, y: name.top + name.height / 2 }
	})
	const cdp = await page.context().newCDPSession(page)
	const at = (i: number, steps: number) => [
		{
			x: start.x + (direction * dx * i) / steps,
			y: start.y + (dy * i) / steps,
			id: 1,
		},
	]
	const steps = 10
	let followed: number | null = null
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: at(0, steps),
	})
	for (let i = 1; i <= steps; i++) {
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: at(i, steps),
		})
		await page.waitForTimeout(16)
		if (look && i === steps / 2)
			followed = await page.evaluate(() => {
				const card = document.querySelector<HTMLElement>(
					"[data-testid=body-card]",
				)!
				return new DOMMatrixReadOnly(getComputedStyle(card).transform).m41
			})
	}
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	})
	await cdp.detach()
	return followed
}

/**
 * Every label cut off in the parts named: text that is wider than its box
 * (spilling out of it, or clipped by it), or ellipsised.
 */
const truncated = (page: Page, selectors: string[]) =>
	page.evaluate((selectors) => {
		const cut: string[] = []
		for (const selector of selectors)
			for (const root of document.querySelectorAll(selector))
				for (const element of [root, ...root.querySelectorAll("*")]) {
					if (!(element instanceof HTMLElement)) continue
					if (!element.checkVisibility()) continue
					const style = getComputedStyle(element)
					if (style.display === "inline" || style.display === "contents")
						continue
					const text = (element.textContent ?? "").trim()
					if (text === "") continue
					const own = [...element.childNodes].some(
						(node) =>
							node.nodeType === Node.TEXT_NODE &&
							(node.textContent ?? "").trim() !== "",
					)
					const wider = element.scrollWidth > element.clientWidth + 1
					const clips =
						style.overflowX === "hidden" || style.overflowX === "clip"
					const ellipsis = style.textOverflow === "ellipsis" && wider
					if (ellipsis || (wider && (own || clips)))
						cut.push(`${selector}: “${text.slice(0, 40)}”`)
				}
		return cut
	}, selectors)
