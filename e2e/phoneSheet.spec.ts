/**
 * The phone's sheet (#60): on a phone held upright the body card, a panel,
 * the tour card, the hunt, the quick look and the time controls share one
 * sheet from the bottom, one at a time, at three heights; the entry buttons
 * are its bottom row and the time chip sits above it. It moves by its
 * handle (a tap, a drag, the keyboard), by its header, by a pull down from
 * the top of its content, and closes by its ×; scrolling inside never moves
 * it, and moving it never moves the scene. Its resting top edge is the
 * bottom of the band the camera frames into (#61).
 *
 * Boxes on the page and on the canvas are measured in one evaluate: the page
 * slides in as it opens, the canvas and the HUD together (see #61's
 * `onCanvas`).
 */
import { expect, test, type Page } from "@playwright/test"

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

/** A finger dragging from (x, y) by `dy` px in steps (CDP touch events). */
async function swipe(page: Page, x: number, y: number, dy: number, steps = 8) {
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
