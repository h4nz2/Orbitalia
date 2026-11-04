/**
 * The phone's sheet (#60): on a phone held upright the body card, a panel,
 * the tour card, the hunt, the quick look and the time controls share one
 * sheet from the bottom, one at a time, at three heights; the entry buttons
 * are its bottom row and the time chip sits above it. It moves by its
 * handle (a tap, a drag, the keyboard), by its header, by a pull down from
 * the top of its content, and closes by its ×; scrolling inside never moves
 * it, and moving it never moves the scene. Its resting top edge is the
 * bottom of the band the camera frames into (#61). Inside it there is one
 * scroller: a finger on any panel scrolls the sheet's content.
 *
 * Boxes on the page and on the canvas are measured in one evaluate: the page
 * slides in as it opens, the canvas and the HUD together (see #61's
 * `onCanvas`).
 */
import { expect, test, type Locator, type Page } from "@playwright/test"

import { stubSpeech } from "./support/speech"
import { openLayers, openTool, unobstructed } from "./support/hud"
import { cameraAtRest, nextFrames } from "./support/scene"
import { smallControls } from "./support/touch"

// software WebGL is slow, and the sheet waits for the camera after each move
test.describe.configure({ timeout: 180_000 })

const PHONE = { width: 390, height: 844 }

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	await cameraAtRest(page)
}

const sheet = (page: Page) => page.getByTestId("sheet")
const handle = (page: Page) => page.getByTestId("sheet-handle")

/**
 * Waits for the sheet to rest at `value`: the height named, no finger on it,
 * and its content as tall as the height it was given (the snap is over; a
 * busy machine may draw no frame between two looks, so stillness is no proof).
 */
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

/** Waits until the band the camera frames into (#61) ends at the time chip, and the camera has followed. */
async function bandSettled(page: Page) {
	await expect
		.poll(async () => {
			const at = await layout(page)
			const edge = Math.min(at.chip?.top ?? Infinity, at.sheet.top)
			return Math.abs(at.band.bottom - edge) < 2
		})
		.toBe(true)
	await cameraAtRest(page, 10)
}

/** Boxes of the sheet's parts, and the band (#61), relative to the canvas, at one instant. */
const layout = (page: Page) =>
	page.evaluate(() => {
		const canvas = document.querySelector("canvas")!.getBoundingClientRect()
		const box = (selector: string) => {
			const element = document.querySelector(selector)
			if (element === null || element.getClientRects().length === 0) return null
			const r = element.getBoundingClientRect()
			return {
				top: r.top - canvas.top,
				bottom: r.bottom - canvas.top,
				left: r.left - canvas.left,
				right: r.right - canvas.left,
				height: r.height,
			}
		}
		return {
			canvasHeight: canvas.height,
			sheet: box("[data-testid=sheet]")!,
			content: box("[data-testid=sheet-content]")!,
			entries: box("[data-testid=entry-bar]")!,
			chip: box("[data-testid=time-chip]"),
			band: box("[data-free-area]")!,
			where: box("[data-testid=where]")!,
		}
	})

/** The camera round its pivot, rounded: equal means the scene did not move. */
const pose = (page: Page) =>
	page.evaluate(() => {
		const camera = window.__orbitalia!.camera()
		return [camera.azimuthDeg, camera.elevationDeg].map((value) =>
			value.toPrecision(5),
		)
	})

/**
 * A finger dragging from (x, y) by `dy` px in steps (CDP touch events). With
 * `rest` it stops that long before it lifts, so nothing flings on after it.
 */
async function swipe(
	page: Page,
	x: number,
	y: number,
	dy: number,
	steps = 8,
	rest = 0,
) {
	const cdp = await page.context().newCDPSession(page)
	const point = (yy: number) => [{ x, y: yy, id: 1 }]
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: point(y),
	})
	for (let i = 1; i <= steps; i++) {
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: point(y + (dy * i) / steps),
		})
		await page.waitForTimeout(16)
	}
	if (rest > 0) await page.waitForTimeout(rest)
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	})
	await cdp.detach()
}

/** The middle of the handle, on the page. */
const handleAt = async (page: Page) => {
	const box = (await handle(page).boundingBox())!
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test.describe("an upright phone, 390x844", () => {
	test.use({ viewport: PHONE, hasTouch: true, isMobile: true })

	test("a planet with its card small: three quarters of the screen is scene, two rows in the sheet", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		await restsAt(page, "small")
		await expect(page.getByTestId("body-card")).toBeVisible()
		expect(await unobstructed(page)).toBeGreaterThanOrEqual(0.75)
		const at = await layout(page)
		// the sheet holds two rows: the card's line, then the entry buttons
		expect(at.content.height).toBeLessThan(80)
		expect(at.entries.top).toBeGreaterThanOrEqual(at.content.bottom - 1)
		expect(at.sheet.bottom - at.content.top).toBeLessThan(80 + 64)
		// the time chip just above it, and the band down to the chip (#61)
		expect(at.chip).not.toBeNull()
		expect(at.chip!.bottom).toBeLessThanOrEqual(at.sheet.top)
		expect(Math.abs(at.band.bottom - at.chip!.top)).toBeLessThan(2)
		expect(at.band.top).toBeGreaterThanOrEqual(at.where.bottom - 1)
		expect(await smallControls(page)).toEqual([])
		// the earth is in the band, whole
		const earth = await page.evaluate(() =>
			window.__orbitalia!.screenOf("earth"),
		)
		expect(earth!.y - earth!.discPx).toBeGreaterThanOrEqual(at.band.top - 1)
		expect(earth!.y + earth!.discPx).toBeLessThanOrEqual(at.band.bottom + 1)
	})

	test("a panel, the unfolded card and a tour stop open at half and leave at least 45 % scene", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		await openLayers(page)
		await restsAt(page, "half")
		await expect(page.getByTestId("body-card")).toBeHidden()
		expect(await unobstructed(page)).toBeGreaterThanOrEqual(0.45)
		expect(await smallControls(page)).toEqual([])
		await page
			.locator("[data-dock-panel=layers]")
			.getByRole("button", { name: /^Close/ })
			.tap()
		await restsAt(page, "small")

		// the card's own unfold is the sheet's half height, and the other way round
		await page.getByTestId("card-toggle").tap()
		await restsAt(page, "half")
		expect(await unobstructed(page)).toBeGreaterThanOrEqual(0.45)
		await expect(page.locator("[data-fact=size]")).toBeVisible()
		await page.getByTestId("card-toggle").tap()
		await restsAt(page, "small")
		await expect(page.locator("[data-fact=size]")).toHaveCount(0)

		await ready(page, "/solar_system?tour=grandTour&stop=3&lang=en")
		await restsAt(page, "half")
		expect(await unobstructed(page)).toBeGreaterThanOrEqual(0.45)
		// the stop's words and its way on, in thumb reach
		const next = page.getByTestId("tour-next")
		await expect(next).toBeInViewport()
		const at = await layout(page)
		const nextBox = (await next.boundingBox())!
		expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(
			(await page.getByTestId("entry-bar").boundingBox())!.y + 1,
		)
		expect(at.content.top).toBeGreaterThan(at.canvasHeight * 0.4)
	})

	test("a panel just opened never dims: the camera backing off for the sheet is no camera move", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		await bandSettled(page)
		// every frame for the next 1.5 s: the panel's, the entry row's and the chip's opacity (#42's fade)
		await page.evaluate(() => {
			const w = window as unknown as { faded: string[]; frames: number }
			w.faded = []
			w.frames = 0
			const start = performance.now()
			const look = () => {
				w.frames += 1
				for (const selector of [
					"[data-dock-panel=layers]",
					"[data-testid=entry-bar]",
					"[data-testid=time-chip]",
				]) {
					const element = document.querySelector(selector)
					if (element === null) continue
					// up to the HUD: the page's own entrance fade (it slides in as it opens) is not #42's
					let opacity = 1
					for (
						let e: Element | null = element;
						e !== null && e.getAttribute("data-testid") !== "hud";
						e = e.parentElement
					)
						opacity *= Number(getComputedStyle(e).opacity)
					if (opacity < 1) w.faded.push(`${selector} ${opacity}`)
				}
				if (performance.now() - start < 1500) requestAnimationFrame(look)
			}
			requestAnimationFrame(look)
		})
		const before = await page.evaluate(
			() => window.__orbitalia!.camera().distance,
		)
		await openLayers(page)
		await page.waitForTimeout(1600)
		const seen = await page.evaluate(() => {
			const w = window as unknown as { faded: string[]; frames: number }
			return { faded: w.faded, frames: w.frames }
		})
		expect(seen.frames).toBeGreaterThan(5)
		expect(seen.faded).toEqual([])
		// the camera did back off, for the smaller band: that is what must not count
		await bandSettled(page)
		expect(
			await page.evaluate(() => window.__orbitalia!.camera().distance),
		).toBeGreaterThan(before)
		await expect(page.locator("html")).not.toHaveAttribute(
			"data-camera",
			"moving",
		)
	})

	test("the handle: a tap steps up, the keys raise and lower, and it says its height", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		await openTool(page, "spacecraft")
		await restsAt(page, "half")
		await expect(handle(page)).toHaveAccessibleName(/half/)
		await handle(page).tap()
		await restsAt(page, "full")
		// at full the sheet stops just under the top row, which stays in view
		const full = await layout(page)
		expect(full.sheet.top).toBeGreaterThanOrEqual(full.where.bottom)
		expect(full.sheet.top - full.where.bottom).toBeLessThan(24)
		await expect(page.getByTestId("where")).toBeInViewport()
		// the chip tucks into the strip: nothing covers the list
		expect(full.chip!.top).toBeGreaterThanOrEqual(full.sheet.top - 1)
		expect(full.chip!.bottom).toBeLessThanOrEqual(full.content.top + 1)
		await handle(page).tap()
		await restsAt(page, "small")
		await handle(page).tap()
		await restsAt(page, "half")

		// the keyboard (and a screen reader's button actions)
		await handle(page).focus()
		await page.keyboard.press("ArrowDown")
		await restsAt(page, "small")
		await expect(handle(page)).toHaveAccessibleName(/small/)
		await page.keyboard.press("ArrowUp")
		await restsAt(page, "half")
		await page.keyboard.press("ArrowUp")
		await restsAt(page, "full")
		await page.keyboard.press("Enter")
		await restsAt(page, "small")
		await page.keyboard.press(" ")
		await restsAt(page, "half")
		// the handle has its hint, like every control
		await expect(handle(page)).toHaveAccessibleDescription(/taller or shorter/)
	})

	test("dragging the handle raises, lowers and closes; the scene never moves", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		const before = await pose(page)
		await openTool(page, "spacecraft")
		await restsAt(page, "half")
		const list = page.locator("[data-dock-panel=spacecraft]")
		let at = await handleAt(page)
		await swipe(page, at.x, at.y, -400)
		await restsAt(page, "full")
		at = await handleAt(page)
		await swipe(page, at.x, at.y, 300)
		await restsAt(page, "half")
		at = await handleAt(page)
		await swipe(page, at.x, at.y, 200)
		await restsAt(page, "small")
		await expect(list).toBeVisible()
		// pulled down from small: the panel closes, the card is back
		at = await handleAt(page)
		await swipe(page, at.x, at.y, 120)
		await expect(list).toHaveCount(0)
		await expect(page.getByTestId("body-card")).toBeVisible()
		await cameraAtRest(page)
		expect(await pose(page)).toEqual(before)
		expect(
			await page.evaluate(() => window.__orbitalia!.store.getState().view),
		).toEqual({ kind: "body", id: "earth" })

		// the header drags it too
		await openLayers(page)
		await restsAt(page, "half")
		const header = (await page
			.locator("[data-dock-panel=layers] header")
			.boundingBox())!
		await swipe(page, header.x + 40, header.y + header.height / 2, 260)
		await restsAt(page, "small")
		expect(await pose(page)).toEqual(before)
	})

	test("scrolling inside never drags the sheet; a pull down from the top does", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		const before = await pose(page)
		await openTool(page, "spacecraft")
		await restsAt(page, "half")
		const content = page.getByTestId("sheet-content")
		const box = (await content.boundingBox())!
		const x = box.x + box.width / 2
		// every touchmove the sheet takes from the browser's own scrolling
		await page.evaluate(() => {
			const w = window as unknown as { taken: number }
			w.taken = 0
			window.addEventListener("touchmove", (event) => {
				if (event.defaultPrevented) w.taken += 1
			})
		})
		const taken = () =>
			page.evaluate(() => (window as unknown as { taken: number }).taken)
		// up: left to the list's scrolling, the sheet stays
		await swipe(page, x, box.y + box.height - 30, -200)
		await restsAt(page, "half")
		expect(await taken()).toBe(0)
		// down while the list is scrolled: back up the list, the sheet stays
		await content.evaluate((element) => {
			element.scrollTop = 200
		})
		await swipe(page, x, box.y + 60, 200)
		await restsAt(page, "half")
		expect(await taken()).toBe(0)
		// down from the top: the sheet lowers, and the browser does not scroll
		await content.evaluate((element) => {
			element.scrollTop = 0
		})
		await swipe(page, x, box.y + 60, 200)
		await restsAt(page, "small")
		expect(await taken()).toBeGreaterThan(0)
		expect(await pose(page)).toEqual(before)
	})

	test("the time chip plays and pauses, and opens the whole time in the sheet", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		const paused = () =>
			page.evaluate(() => window.__orbitalia!.store.getState().paused)
		const chip = page.getByTestId("time-chip")
		await chip.getByRole("button", { name: "Pause", exact: true }).tap()
		await expect.poll(paused).toBe(true)
		await chip.getByRole("button", { name: "Play", exact: true }).tap()
		await expect.poll(paused).toBe(false)
		// the second tap reaches every part of time
		await page.getByTestId("time-menu").tap()
		await restsAt(page, "half")
		const panel = page.getByTestId("time-panel")
		await expect(panel).toBeVisible()
		for (const control of [
			panel.getByRole("button", { name: "Reverse", exact: true }),
			panel.getByRole("button", { name: /^Travel to a date/ }),
			panel.getByRole("button", { name: "Now", exact: true }),
			panel.getByRole("combobox", { name: "Speed" }),
		])
			await expect(control).toBeVisible()
		await expect(page.getByTestId("body-card")).toBeHidden()
		expect(await smallControls(page)).toEqual([])
		// a panel takes its place, one at a time
		await openLayers(page)
		await expect(panel).toHaveCount(0)
		// hiding the controls hides the chip too (#59)
		await page.keyboard.press("h")
		await expect(chip).toBeHidden()
		await page.keyboard.press("h")
		await expect(chip).toBeVisible()
	})

	test("a tap on the sky lowers a raised sheet before it hides the controls", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=mars&lang=en")
		await openLayers(page)
		await restsAt(page, "half")
		await cameraAtRest(page)
		const spot = await page.evaluate(() => {
			const canvas = document.querySelector("canvas")!.getBoundingClientRect()
			const band = document
				.querySelector("[data-free-area]")!
				.getBoundingClientRect()
			const mars = window.__orbitalia!.screenOf("mars")!
			// above Mars, inside the band and well clear of its edge
			const y = Math.max(band.top + 12, canvas.top + mars.y - mars.discPx - 60)
			return { x: canvas.left + 30, y }
		})
		await page.touchscreen.tap(spot.x, spot.y)
		await restsAt(page, "small")
		await expect(page.locator("[data-dock-panel=layers]")).toBeVisible()
		await expect(page.locator("html")).not.toHaveAttribute(
			"data-chrome",
			"hidden",
		)
		await page.touchscreen.tap(spot.x, spot.y)
		await expect(page.locator("html")).toHaveAttribute("data-chrome", "hidden")
	})

	test("the band follows the sheet at rest, never during a drag", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		const bandBottom = async () => (await layout(page)).band.bottom
		const small = await bandBottom()
		await openTool(page, "spacecraft")
		await restsAt(page, "half")
		await bandSettled(page)
		const half = await bandBottom()
		expect(half).toBeLessThan(small - 100)
		// a finger holding the sheet near full height: the band stays until it lets go
		const at = await handleAt(page)
		const cdp = await page.context().newCDPSession(page)
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [{ x: at.x, y: at.y, id: 1 }],
		})
		for (let dy = 25; dy <= 300; dy += 25)
			await cdp.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [{ x: at.x, y: at.y - dy, id: 1 }],
			})
		await expect(sheet(page)).toHaveAttribute("data-sheet-dragging", "")
		await page.waitForTimeout(400)
		expect(await bandBottom()).toBeCloseTo(half, 0)
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		})
		await restsAt(page, "full")
		await expect.poll(bandBottom).toBeLessThan(half - 50)
	})

	test("turning the phone keeps what is open: the sheet upright, the dock on its side", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		await openLayers(page)
		await restsAt(page, "half")
		await page.setViewportSize({ width: 844, height: 390 })
		await expect(sheet(page)).toHaveCount(0)
		await expect(page.locator("[data-dock-panel=layers]")).toBeVisible()
		await expect(page.getByTestId("time-bar")).toBeVisible()
		await page.setViewportSize(PHONE)
		await expect(sheet(page)).toBeVisible()
		await expect(page.locator("[data-dock-panel=layers]")).toBeVisible()
		await expect(page.getByTestId("time-chip")).toBeVisible()
	})
})

test.describe("a small phone, 360x640", () => {
	test.use({
		viewport: { width: 360, height: 640 },
		hasTouch: true,
		isMobile: true,
	})

	test("Earth with its card at half height is in view above the sheet, and not tiny", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		await page.getByTestId("card-toggle").tap()
		await restsAt(page, "half")
		await bandSettled(page)
		const at = await layout(page)
		const earth = (await page.evaluate(() =>
			window.__orbitalia!.screenOf("earth"),
		))!
		expect(earth.y - earth.discPx).toBeGreaterThanOrEqual(at.band.top - 1)
		expect(earth.y + earth.discPx).toBeLessThanOrEqual(at.chip!.top + 1)
		// more than a quarter of the width across (86 px before #60)
		expect(2 * earth.discPx).toBeGreaterThan(100)
	})

	test("Look and find: every world a clue asks for is in sight above the clue", async ({
		page,
	}) => {
		test.slow()
		await stubSpeech(page)
		await ready(page, "/solar_system?hunt=lookAndFind&lang=en&reading=simple")
		for (const answer of ["earth", "mars", "jupiter", "saturn", "moon"]) {
			await expect(page.getByTestId("hunt-clue")).toBeVisible()
			await restsAt(page, "small")
			await cameraAtRest(page, 10)
			await nextFrames(page)
			const seen = await page.evaluate((id) => {
				const canvas = document.querySelector("canvas")!.getBoundingClientRect()
				const at = window.__orbitalia!.screenOf(id)
				const sheet = document
					.querySelector("[data-testid=sheet]")!
					.getBoundingClientRect()
				if (at === null) return null
				return {
					y: at.y,
					sheetTop: sheet.top - canvas.top,
					hit: document.elementFromPoint(canvas.left + at.x, canvas.top + at.y)
						?.tagName,
				}
			}, answer)
			expect(seen, `${answer} on screen`).not.toBeNull()
			expect(seen!.y, `${answer} above the clue`).toBeLessThan(seen!.sheetTop)
			expect(seen!.hit, `${answer} is not under a panel`).toBe("CANVAS")
			// the clue keeps its hint button at small height
			await expect(
				page.getByRole("button", { name: /hint/i }).first(),
			).toBeVisible()
			await page.evaluate(
				(id) => window.__orbitalia!.store.getState().setFocus(id),
				answer,
			)
			await expect(page.getByTestId("hunt-found")).toBeVisible()
			if (answer !== "moon") {
				await page.getByRole("button", { name: "Next clue" }).tap()
				await expect(page.getByTestId("hunt-found")).toHaveCount(0)
			}
		}
	})
})

/** How far the sheet's content has scrolled, px. */
const scrolled = (page: Page) =>
	page.getByTestId("sheet-content").evaluate((element) => element.scrollTop)

/** A finger through the sheet's content, stopping before it lifts: the scroll is over when this returns. */
const scrollWith = (page: Page, x: number, y: number, dy: number) =>
	swipe(page, x, y, dy, 12, 150)

/** The sheet's content, and where a finger lands low in it, in the middle of its width. */
const low = async (page: Page) => {
	const box = (await page.getByTestId("sheet-content").boundingBox())!
	return { x: box.x + box.width / 2, y: box.y + box.height - 20 }
}

/** A finger up from low in the content, and the content moves. */
async function fingerScrollsUp(page: Page) {
	const before = await scrolled(page)
	const { x, y } = await low(page)
	await scrollWith(page, x, y, -100)
	await expect.poll(() => scrolled(page)).toBeGreaterThan(before + 10)
}

/** Whether `target` is in the content's view: its bottom above the content's. */
const inReach = (target: Locator) =>
	target.evaluate((element) => {
		const content = document.querySelector("[data-testid=sheet-content]")!
		return (
			element.getBoundingClientRect().bottom <=
			content.getBoundingClientRect().bottom
		)
	})

/** Scrolls with a finger only, until `target` is in the content's view. */
async function reach(page: Page, target: Locator) {
	const { x, y } = await low(page)
	for (let i = 0; i < 60 && !(await inReach(target)); i++)
		await scrollWith(page, x, y, -100)
	expect(await inReach(target)).toBe(true)
}

/** Whether a finger meets the header across its whole width, whatever is scrolled under it. */
const headerOnTop = (header: Locator) =>
	header.evaluate((element) => {
		const box = element.getBoundingClientRect()
		return [0.1, 0.3, 0.5, 0.7, 0.9].every((share) =>
			element.contains(
				document.elementFromPoint(
					box.left + box.width * share,
					box.top + box.height / 2,
				),
			),
		)
	})

/** What in the content could end a finger's scroll: anything, on show or not, with an `overscroll-behavior` of its own. */
const heldBack = (page: Page) =>
	page.getByTestId("sheet-content").evaluate((content) =>
		[...content.querySelectorAll("*")]
			.filter((element) => {
				const style = getComputedStyle(element)
				return (
					style.overscrollBehaviorX !== "auto" ||
					style.overscrollBehaviorY !== "auto"
				)
			})
			.map((element) => `${element.tagName} ${String(element.className)}`),
	)

/** The hunt's chooser at half, a panel, on the screen with a card whole in view and the finger's to tap. */
async function chooserInView(page: Page) {
	const panel = page.locator("#hunt-panel")
	await expect(panel).toHaveAttribute("data-sheet-kind", "panel")
	await expect(panel).not.toHaveAttribute("data-collapsed")
	await expect(panel.locator("[data-hunt]").first()).toBeVisible()
	await restsAt(page, "half")
	// no card lit: nobody has chosen one, wherever a finger last fell
	await expect
		.poll(() =>
			panel
				.locator("[data-hunt]")
				.evaluateAll(
					(cards) =>
						new Set(cards.map((card) => getComputedStyle(card).borderColor))
							.size,
				),
		)
		.toBe(1)
	expect(
		await panel
			.locator("[data-hunt]")
			.first()
			.evaluate((card) => {
				const content = document.querySelector("[data-testid=sheet-content]")!
				const sheet = document.querySelector("[data-testid=sheet]")!
				const header = card.closest("section")!.querySelector("header")!
				const box = card.getBoundingClientRect()
				return (
					sheet.getBoundingClientRect().bottom <= innerHeight &&
					box.top >= header.getBoundingClientRect().bottom &&
					box.bottom <= content.getBoundingClientRect().bottom &&
					card.contains(
						document.elementFromPoint(
							box.left + box.width / 2,
							box.top + box.height / 2,
						),
					)
				)
			}),
	).toBe(true)
}

/** The hunt's clue, folded, with the sheet at small: the fold and the sheet agree. */
async function clueFolded(page: Page) {
	const panel = page.locator("#hunt-panel")
	await expect(page.getByTestId("hunt-clue")).toBeVisible()
	await expect(panel).toHaveAttribute("data-sheet-kind", "hunt")
	await expect(panel).toHaveAttribute("data-sheet-folds", "")
	await restsAt(page, "small")
	await expect(panel).toHaveAttribute("data-collapsed", "true")
}

test.describe("every way into the hunt's chooser, 390x844", () => {
	test.use({ viewport: PHONE, hasTouch: true, isMobile: true })

	const card = (page: Page) => page.locator("#hunt-panel [data-hunt]").first()
	const endHunt = (page: Page) =>
		page.locator("#hunt-panel").getByRole("button", { name: "End hunt" })

	test("Tools: at half with its cards in view; a pick ends at small with the clue, and End hunt goes back and forth", async ({
		page,
	}) => {
		await stubSpeech(page)
		await ready(page, "/solar_system?lang=en&reading=standard")
		await openTool(page, "hunt")
		await chooserInView(page)
		// "Make your own hunt" and all: a finger's size
		expect(await smallControls(page)).toEqual([])

		for (let round = 0; round < 2; round++) {
			await card(page).tap()
			await clueFolded(page)
			// unfolded, the same fold and height as a shared link's
			await handle(page).tap()
			await restsAt(page, "half")
			await expect(page.locator("#hunt-panel")).not.toHaveAttribute(
				"data-collapsed",
			)
			await endHunt(page).scrollIntoViewIfNeeded()
			await endHunt(page).tap()
			await chooserInView(page)
		}
	})

	test("a link: ?hunt=true at half with its cards in view, a shared hunt at small", async ({
		page,
	}) => {
		await stubSpeech(page)
		await ready(page, "/solar_system?hunt=true&lang=en&reading=simple")
		await chooserInView(page)
		await ready(page, "/solar_system?hunt=firstSteps&lang=en&reading=standard")
		await clueFolded(page)
	})

	test("the finish's Choose another hunt: at half with its cards in view", async ({
		page,
	}) => {
		await stubSpeech(page)
		await ready(page, "/solar_system?hunt=walkedOn.redPlanet&lang=en")
		await clueFolded(page)
		const panel = page.locator("#hunt-panel")
		await handle(page).tap()
		await restsAt(page, "half")
		for (const [answer, next] of [
			["moon", "Next clue"],
			["mars", "Finish"],
		]) {
			await page.evaluate(
				(id) => window.__orbitalia!.store.getState().setFocus(id),
				answer,
			)
			const button = panel.getByRole("button", { name: next })
			// its way on is in the sheet
			await button.scrollIntoViewIfNeeded()
			await button.tap()
		}
		await expect(page.getByTestId("hunt-done")).toBeVisible()
		const other = panel.getByRole("button", { name: "Choose another hunt" })
		await other.scrollIntoViewIfNeeded()
		await other.tap()
		await chooserInView(page)
		await card(page).tap()
		await clueFolded(page)
	})
})

test.describe("the hunt's chooser and clue on a small phone, 360x640", () => {
	test.use({
		viewport: { width: 360, height: 640 },
		hasTouch: true,
		isMobile: true,
	})

	const camera = (page: Page) =>
		page.evaluate(() => {
			const { azimuthDeg, distance } = window.__orbitalia!.camera()
			return { azimuthDeg, distance }
		})
	const lookAndFind = (page: Page) =>
		page.locator('#hunt-panel [data-hunt="lookAndFind"]')

	test("the first clue is planned for the band the sheet rests at: the home azimuth, again after End hunt", async ({
		page,
	}) => {
		await stubSpeech(page)
		await ready(page, "/solar_system?lang=en&reading=simple")
		await openTool(page, "hunt")
		for (let round = 0; round < 2; round++) {
			await chooserInView(page)
			await cameraAtRest(page, 5)
			const before = await camera(page)
			await lookAndFind(page).tap()
			await clueFolded(page)
			// it does not go without its move
			await expect
				.poll(async () => (await camera(page)).distance)
				.toBeLessThan(before.distance * 0.8)
			await cameraAtRest(page, 10)
			expect(Math.abs((await camera(page)).azimuthDeg)).toBeLessThan(1)
			await handle(page).tap()
			await restsAt(page, "half")
			const stop = page
				.locator("#hunt-panel")
				.getByRole("button", { name: "Stop this hunt" })
			await stop.scrollIntoViewIfNeeded()
			await stop.tap()
		}
	})

	test("a pick from the chooser at full ends at small, with the clue", async ({
		page,
	}) => {
		await stubSpeech(page)
		await ready(page, "/solar_system?lang=en&reading=simple")
		await openTool(page, "hunt")
		await chooserInView(page)
		await handle(page).tap()
		await restsAt(page, "full")
		await lookAndFind(page).tap()
		await clueFolded(page)
	})

	test("End hunt from a clue at full opens the chooser at half", async ({
		page,
	}) => {
		await ready(page, "/solar_system?hunt=firstSteps&lang=en&reading=standard")
		await clueFolded(page)
		await handle(page).tap()
		await restsAt(page, "half")
		// a tap would fold it again: a clue goes on up by a drag
		const at = await handleAt(page)
		await swipe(page, at.x, at.y, -300)
		await restsAt(page, "full")
		const end = page
			.locator("#hunt-panel")
			.getByRole("button", { name: "End hunt" })
		await end.scrollIntoViewIfNeeded()
		await end.tap()
		await chooserInView(page)
	})
})

for (const phone of [PHONE, { width: 360, height: 640 }]) {
	test.describe(`one scroller in the sheet, ${phone.width}x${phone.height}`, () => {
		test.use({ viewport: phone, hasTouch: true, isMobile: true })

		test("a finger scrolls the hunt's chooser: from its cards to the Start of your own hunt and back", async ({
			page,
		}) => {
			await ready(page, "/solar_system?lang=en&reading=simple")
			await openTool(page, "hunt")
			await chooserInView(page)
			const panel = page.locator("#hunt-panel")
			const card = panel.locator("[data-hunt]")
			const content = page.getByTestId("sheet-content")

			// your own hunt, opened: more than the sheet shows at either size
			const own = panel.getByText("Make your own hunt")
			await reach(page, own)
			await own.tap()
			const start = panel.getByRole("button", { name: "Start", exact: true })
			await expect(start).toBeAttached()
			await expect
				.poll(() =>
					content.evaluate(
						(element) => element.scrollHeight - element.clientHeight,
					),
				)
				.toBeGreaterThan(200)
			await content.evaluate((element) => {
				element.scrollTop = 0
			})
			await restsAt(page, "half")
			const header = panel.locator("header")
			const headerAt = (await header.boundingBox())!.y

			// a finger from a hunt's card: the list moves, the sheet and the header stay, the hunt does not start
			const { x, y } = await low(page)
			const on = (await card.first().boundingBox())!
			const onCard = on.y + on.height - 10
			expect(
				await page.evaluate(
					({ x, y }) =>
						document.elementFromPoint(x, y)?.closest("[data-hunt]") !== null,
					{ x, y: onCard },
				),
			).toBe(true)
			await scrollWith(page, x, onCard, -40)
			await expect.poll(() => scrolled(page)).toBeGreaterThan(10)
			await expect(page.getByTestId("hunt-progress")).toHaveCount(0)
			await restsAt(page, "half")
			expect((await header.boundingBox())!.y).toBeCloseTo(headerAt, 0)

			// the choice of difficulty passes under the header, never over it
			await page.getByTestId("hunt-difficulty").evaluate((element) => {
				const content = document.querySelector("[data-testid=sheet-content]")!
				const under = document
					.querySelector("#hunt-panel header")!
					.getBoundingClientRect()
				const box = element.getBoundingClientRect()
				content.scrollTop +=
					box.top + box.height / 2 - (under.top + under.height / 2)
			})
			expect(await headerOnTop(header)).toBe(true)

			// on to the last card, and your own hunt's Start
			await reach(page, card.last())
			await reach(page, start)
			await expect(start).toBeDisabled()
			await restsAt(page, "half")
			expect((await header.boundingBox())!.y).toBeCloseTo(headerAt, 0)

			// and back down the list with a finger, the sheet staying, up to its top
			const atStart = await scrolled(page)
			await scrollWith(page, x, y - 100, 100)
			await expect.poll(() => scrolled(page)).toBeLessThan(atStart - 10)
			await content.evaluate((element) => {
				element.scrollTop = 40
			})
			await scrollWith(page, x, y - 100, 100)
			await expect.poll(() => scrolled(page)).toBe(0)
			await restsAt(page, "half")

			// a finger on the header drags the sheet, it scrolls nothing
			const top = (await header.boundingBox())!
			// three quarters of the way: nearer small, and not so far that it closes
			const pull = (await content.boundingBox())!.height * 0.75
			await swipe(page, x, top.y + top.height / 2, pull)
			await restsAt(page, "small")
			await expect(panel).toBeVisible()
			expect(await scrolled(page)).toBe(0)
			await handle(page).tap()
			await restsAt(page, "half")

			// a pull down from the top lowers the sheet
			const open = (await content.boundingBox())!
			await swipe(page, x, open.y + 70, pull)
			await restsAt(page, "small")
			await expect(panel).toBeVisible()

			// and a tap on a card starts its hunt
			await handle(page).tap()
			await restsAt(page, "half")
			await card.first().tap()
			await clueFolded(page)
		})

		test("a finger scrolls every panel that scrolls for itself elsewhere, and nothing in the content holds it back", async ({
			page,
		}) => {
			await ready(page, "/solar_system?lang=en&reading=simple")
			for (const tool of ["birthday", "sky", "spacecraft"] as const) {
				await openTool(page, tool)
				await restsAt(page, "half")
				// it may have opened with its main action brought into view
				await page.getByTestId("sheet-content").evaluate((element) => {
					element.scrollTop = 0
				})
				await fingerScrollsUp(page)
				await restsAt(page, "half")
				expect(await heldBack(page), tool).toEqual([])
			}
		})

		test("a finger scrolls the hunt's clue, with its hints", async ({
			page,
		}) => {
			await stubSpeech(page)
			await ready(
				page,
				"/solar_system?hunt=firstSteps&lang=en&reading=standard",
			)
			await expect(page.getByTestId("hunt-clue")).toBeVisible()
			await restsAt(page, "small")
			await handle(page).tap()
			await restsAt(page, "half")
			await page.getByTestId("hunt-hint").tap()
			await restsAt(page, "half")
			await fingerScrollsUp(page)
			await restsAt(page, "half")
			expect(await heldBack(page)).toEqual([])
		})
	})
}

test.describe("a phone on its side, 844x390: a dock, no sheet", () => {
	test.use({
		viewport: { width: 844, height: 390 },
		hasTouch: true,
		isMobile: true,
	})

	test("a finger scrolls the hunt's chooser inside its panel", async ({
		page,
	}) => {
		await ready(page, "/solar_system?lang=en&reading=simple")
		await expect(sheet(page)).toHaveCount(0)
		await openTool(page, "hunt")
		const card = page.locator("#hunt-panel [data-hunt]").first()
		await expect(card).toBeVisible()
		const box = (await page.locator("#hunt-panel").boundingBox())!
		await swipe(page, box.x + box.width / 2, box.y + box.height - 20, -100, 12)
		// the panel's own scroller moves, whichever element under the header it is
		await expect
			.poll(() =>
				card.evaluate((element) => {
					let moved = 0
					for (
						let at = element.parentElement;
						at !== null;
						at = at.parentElement
					)
						moved += at.scrollTop
					return moved
				}),
			)
			.toBeGreaterThan(10)
	})
})

test("on a laptop a panel's body still scrolls for itself", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1366, height: 768 })
	await ready(page, "/solar_system?lang=en")
	const body = (panel: string) =>
		page.locator(`${panel} > [class*="_body_"]`).evaluate((element) => {
			const style = getComputedStyle(element)
			return `${style.overflowY} ${style.overscrollBehaviorY}`
		})
	await openTool(page, "spacecraft")
	expect(await body("[data-dock-panel=spacecraft]")).toBe("auto contain")
	await openTool(page, "birthday")
	expect(await body("#birthday-panel")).toBe("auto contain")
	await openTool(page, "hunt")
	expect(await body("#hunt-panel")).toBe("auto contain")
})

test("laptops and tablets keep the dock: no sheet", async ({ browser }) => {
	for (const device of [
		{ viewport: { width: 1366, height: 768 }, hasTouch: false },
		{ viewport: { width: 768, height: 1024 }, hasTouch: true },
	]) {
		const context = await browser.newContext({
			...device,
			isMobile: device.hasTouch,
		})
		const page = await context.newPage()
		await ready(page, "/solar_system?focus=earth&lang=en")
		await expect(page.getByTestId("time-bar")).toBeVisible()
		await expect(sheet(page)).toHaveCount(0)
		await expect(page.getByTestId("time-chip")).toHaveCount(0)
		await openLayers(page)
		await expect(page.locator("[data-sheet-height]")).toHaveCount(0)
		await context.close()
	}
})
