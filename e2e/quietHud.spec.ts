/**
 * A quieter interface (#42): space owns the screen. With a planet focused on
 * a 1366x768 laptop at least 80 % of the scene is unobstructed; every control
 * is at most two actions away behind the named entry points; the secondary
 * controls dim while the camera moves and come back when it stops; the
 * interface hides and returns with one key or button outside presentation
 * mode; tools open one at a time; phones get the panels from the bottom.
 */
import { expect, test, type Page } from "@playwright/test"

import {
	expandCard,
	openLayers,
	openScale,
	openTime,
	openTool,
} from "./support/hud"
import { cameraAtRest } from "./support/scene"

test.describe.configure({ timeout: 90_000 })

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	await cameraAtRest(page)
}

/**
 * The share of the screen no HUD panel covers: every element of the HUD that
 * takes the pointer (the panels; the HUD layer itself lets it through) is
 * painted onto a coarse grid, and the free cells are counted.
 */
const unobstructed = (page: Page): Promise<number> =>
	page.evaluate(() => {
		const hud = document.querySelector("[data-testid=hud]")!
		const boxes: DOMRect[] = []
		const walk = (element: Element) => {
			for (const child of element.children) {
				const style = getComputedStyle(child)
				if (style.display === "none" || style.visibility === "hidden") continue
				if (style.pointerEvents !== "none" && style.display !== "contents") {
					const box = child.getBoundingClientRect()
					if (box.width > 0 && box.height > 0) boxes.push(box)
					continue
				}
				walk(child)
			}
		}
		walk(hud)
		const step = 4
		const width = window.innerWidth
		const height = window.innerHeight
		let free = 0
		let total = 0
		for (let y = step / 2; y < height; y += step)
			for (let x = step / 2; x < width; x += step) {
				total += 1
				if (
					!boxes.some(
						(b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom,
					)
				)
					free += 1
			}
		return free / total
	})

test("a focused planet on a laptop leaves at least 80 % of the screen to space", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1366, height: 768 })
	await ready(page, "/solar_system?focus=saturn&lang=en")
	await expect(page.getByTestId("body-card")).toBeVisible()
	// what you look at, the way out, and whether time runs are on screen
	await expect(page.getByRole("combobox", { name: "Focus body" })).toHaveValue(
		"Saturn",
	)
	await expect(
		page.getByRole("button", { name: "Back to overview", exact: true }),
	).toBeVisible()
	await expect(page.getByRole("button", { name: "Pause" })).toBeVisible()
	await expect(page.locator("time")).toBeVisible()
	// nothing else is spread over the scene
	await expect(page.getByRole("switch")).toHaveCount(0)
	await expect(page.getByRole("radiogroup")).toHaveCount(0)
	await expect(
		page.getByTestId("body-card").locator("[data-fact]"),
	).toHaveCount(0)
	expect(await unobstructed(page)).toBeGreaterThanOrEqual(0.8)
	// presentation mode is easy to find: a named button of its own
	await expect(page.getByTestId("present-menu")).toBeVisible()
	await expect(page.getByTestId("present-menu")).toHaveText("Present")
})

test("every control is two actions away, behind named entry points", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 720 })
	await ready(page, "/solar_system?focus=earth&lang=en")

	const layers = await openLayers(page)
	await expect(layers.getByRole("switch")).toHaveCount(8)
	await expect(layers.getByRole("switch", { name: "Always lit" })).toBeVisible()

	const scale = await openScale(page)
	// one panel at a time: Layers made way
	await expect(page.locator("[data-dock-panel=layers]")).toHaveCount(0)
	await expect(
		scale.getByRole("radio", { name: "True scale", exact: true }),
	).toBeAttached()
	await expect(scale).toContainText("Earth is drawn 10× too big.")
	await expect(page.locator("[data-entry=scale]")).toContainText(
		"Everything visible",
	)

	const time = await openTime(page)
	await expect(time.getByRole("button", { name: "Now" })).toBeVisible()
	await expect(time.getByRole("radio", { name: "1 day/s" })).toBeAttached()
	await expect(time.getByRole("radiogroup", { name: "Spin" })).toBeVisible()
	await page.getByTestId("time-menu").click()
	await expect(time).toBeHidden()

	await page.getByTestId("tools-menu").click()
	const tools = page.locator("[data-tool]")
	await expect(tools).toHaveCount(9)
	for (const id of [
		"light",
		"sky",
		"spacecraft",
		"birthday",
		"hunt",
		"compare",
		"walk",
		"dictionary",
		"postcard",
	])
		await expect(page.locator(`[data-tool=${id}]`)).toBeVisible()
	// (Escape would also take the view back to the overview: the button closes the menu)
	await page.getByTestId("tools-menu").click()
	await expect(tools.first()).toBeHidden()

	await page.getByTestId("tour-menu").click()
	await expect(page.getByRole("menuitem")).toHaveCount(4)
	await page.getByTestId("tour-menu").click()
	await expect(page.getByRole("menuitem")).toHaveCount(0)

	// the body card starts small and unfolds on demand
	await expandCard(page)
	await expect(
		page.getByTestId("body-card").locator("[data-fact]").first(),
	).toBeVisible()
})

test("tools open one at a time", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 720 })
	await ready(page, "/solar_system?lang=en")
	await openTool(page, "light")
	await expect(page.locator("[data-light-panel]")).toBeVisible()
	await openTool(page, "birthday")
	await expect(
		page.getByRole("region", { name: "Your birthday in space" }),
	).toBeVisible({ timeout: 15_000 })
	await expect(page.locator("[data-light-panel]")).toHaveCount(0)
	await openLayers(page)
	await expect(
		page.getByRole("region", { name: "Your birthday in space" }),
	).toHaveCount(0)
	await openTool(page, "spacecraft")
	await expect(page.locator("[data-dock-panel=layers]")).toHaveCount(0)
	await expect(page.locator("[data-dock-panel=spacecraft]")).toBeVisible()
})

test("the secondary controls dim while the camera moves, and come back when it stops", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 720 })
	await ready(page, "/solar_system?focus=jupiter&lang=en")
	const html = page.locator("html")
	const entries = page.getByTestId("entry-bar")
	const corner = page.getByTestId("corner")
	const where = page.getByTestId("where")
	const timeBar = page.getByTestId("time-bar")
	const opacity = (locator: ReturnType<Page["locator"]>) =>
		locator.evaluate((element) => Number(getComputedStyle(element).opacity))
	await expect(html).not.toHaveAttribute("data-camera", "moving")
	expect(await opacity(entries)).toBe(1)

	// drag the camera round Jupiter, holding the button down
	await page.mouse.move(900, 300)
	await page.mouse.down()
	for (let step = 1; step <= 12; step += 1)
		await page.mouse.move(900 - step * 12, 300 + step * 4)
	await expect(html).toHaveAttribute("data-camera", "moving")
	await expect.poll(() => opacity(entries)).toBeLessThan(0.5)
	await expect.poll(() => opacity(corner)).toBeLessThan(0.5)
	// the name, the way out and the time never dim
	expect(await opacity(where)).toBe(1)
	expect(await opacity(timeBar)).toBe(1)
	await page.mouse.up()

	// the moment the camera stops, everything is back
	await expect(html).not.toHaveAttribute("data-camera", "moving", {
		timeout: 15_000,
	})
	await expect.poll(() => opacity(entries)).toBe(1)
})

test("the interface hides and returns with one button or one key, outside presentation mode", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 720 })
	await ready(page, "/solar_system?focus=mars&lang=en")
	const html = page.locator("html")
	await expect(html).not.toHaveAttribute("data-presenting", "")
	await page.getByTestId("hide-controls").click()
	await expect(html).toHaveAttribute("data-chrome", "hidden")
	await expect(page.getByTestId("entry-bar")).toBeHidden()
	await expect(page.getByTestId("time-bar")).toBeHidden()
	const show = page.getByRole("button", { name: "Show the controls" })
	await page.mouse.move(640, 360)
	await show.click()
	await expect(html).not.toHaveAttribute("data-chrome", "hidden")
	await expect(page.getByTestId("entry-bar")).toBeVisible()

	await page.keyboard.press("h")
	await expect(html).toHaveAttribute("data-chrome", "hidden")
	await page.keyboard.press("h")
	await expect(html).not.toHaveAttribute("data-chrome", "hidden")
})

test.describe("on a phone", () => {
	test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

	test("the scene keeps the middle and panels come up from the bottom, one at a time", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		const card = page.getByTestId("body-card")
		await expect(card).toBeVisible()
		const entries = page.getByTestId("entry-bar")
		const bar = (await entries.boundingBox())!
		// the entry points sit at the bottom, the full width
		expect(bar.y + bar.height).toBeGreaterThan(844 - 20)
		expect(bar.width).toBeGreaterThan(390 - 30)
		expect(await unobstructed(page)).toBeGreaterThanOrEqual(0.6)

		const layers = await openLayers(page)
		const sheet = (await layers.boundingBox())!
		expect(sheet.y + sheet.height).toBeLessThanOrEqual(bar.y)
		expect(sheet.y).toBeGreaterThan(844 * 0.3)
		// the card makes way while a panel is up
		await expect(card).toBeHidden()
		await page
			.locator("[data-dock-panel=layers]")
			.getByRole("button", { name: /^Close/ })
			.click()
		await expect(card).toBeVisible()
	})
})

test("the German layout keeps every entry point readable at 1024x768", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1024, height: 768 })
	await ready(page, "/solar_system?focus=earth&lang=de")
	for (const locator of [
		page.getByRole("combobox", { name: "Himmelskörper im Fokus" }),
		page.getByTestId("present-menu"),
		page.getByTestId("tour-menu"),
		page.locator("[data-entry=layers]"),
		page.locator("[data-entry=scale]"),
		page.getByTestId("tools-menu"),
		page.getByTestId("time-menu"),
	]) {
		const box = (await locator.boundingBox())!
		expect(box.x).toBeGreaterThanOrEqual(0)
		expect(box.x + box.width).toBeLessThanOrEqual(1024)
		expect(box.y + box.height).toBeLessThanOrEqual(768)
	}
	// the picker keeps its text: it is not squeezed by the corner
	const picker = (await page
		.getByRole("combobox", { name: "Himmelskörper im Fokus" })
		.boundingBox())!
	expect(picker.width).toBeGreaterThan(120)
})
