/**
 * Hover hints on every toggle (#39): the hint shows on hovering the label or
 * the switch, on keyboard focus and on a long press (where a plain tap still
 * toggles); it sits beside the control, never on it; disabled switches say
 * what to turn on first; options get one hint each; every hint is the
 * control's accessible description, in the current language and reading level.
 */
import { expect, test, type Locator, type Page } from "@playwright/test"

import { openLayers, openScale, openTime } from "./support/hud"

test.describe.configure({ timeout: 120_000 })

const open = async (page: Page, search = "lang=en") => {
	await page.setViewportSize({ width: 1280, height: 720 })
	await page.goto(`/solar_system?${search}`)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 30_000,
	})
	await expect(page.locator("time")).toBeVisible()
	// the switches wait behind Layers (#42)
	await openLayers(page)
}

const hint = (page: Page) => page.getByRole("tooltip")
const layers = (page: Page) => page.getByRole("group", { name: "Scene layers" })
const toggle = (page: Page, name: string) =>
	page.getByRole("switch", { name, exact: true })
/** The whole Mantine Switch (track and label) of the switch named `name`. */
const switchRoot = (page: Page, name: string) =>
	layers(page)
		.locator(".mantine-Switch-root")
		.filter({ has: page.getByRole("switch", { name, exact: true }) })

/**
 * Moves the mouse onto the middle of `target`. Mantine lays a switch's
 * transparent input over its whole label, so Playwright's own hover() would
 * refuse the label text as "covered"; that input is what a real pointer hits.
 */
async function pointAt(page: Page, target: Locator) {
	const box = (await target.boundingBox())!
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

/** The hint and the control it describes do not overlap. */
async function expectBeside(control: Locator, tip: Locator) {
	const a = (await control.boundingBox())!
	const b = (await tip.boundingBox())!
	const apart =
		a.x + a.width <= b.x ||
		b.x + b.width <= a.x ||
		a.y + a.height <= b.y ||
		b.y + b.height <= a.y
	expect(apart, JSON.stringify({ control: a, hint: b })).toBe(true)
}

test("hovering a switch's label or its track shows what it does, beside it", async ({
	page,
}) => {
	await open(page)
	const alwaysLit = switchRoot(page, "Always lit")

	await pointAt(page, alwaysLit.getByText("Always lit", { exact: true }))
	await expect(hint(page)).toHaveText(
		/^Lights every body from where you look, so the night side is not black\./,
	)
	await expectBeside(alwaysLit, hint(page))

	// away: gone
	await page.mouse.move(640, 360)
	await expect(hint(page)).toHaveCount(0)

	// the switch itself is a target too, not only its label
	await pointAt(page, alwaysLit.locator(".mantine-Switch-track"))
	await expect(hint(page)).toContainText("hides the day and night lesson")
	await expectBeside(alwaysLit, hint(page))

	// moving along the row switches hints without a second wait
	await pointAt(page, switchRoot(page, "Orbits"))
	await expect(hint(page)).toContainText("Draws the path each planet")

	// clicking hides the hint and still toggles
	await switchRoot(page, "Orbits").click()
	await expect(hint(page)).toHaveCount(0)
	await expect(toggle(page, "Orbits")).not.toBeChecked()
})

test("keyboard focus shows the hint, and every hint is the control's description", async ({
	page,
}) => {
	await open(page)
	await toggle(page, "Orbits").focus()
	await page.keyboard.press("Tab")
	await expect(toggle(page, "Labels")).toBeFocused()
	await expect(hint(page)).toContainText("Writes each body’s name beside it")
	await expectBeside(switchRoot(page, "Labels"), hint(page))
	await page.keyboard.press("Escape")
	await expect(hint(page)).toHaveCount(0)

	for (const [name, text] of [
		["Orbits", /^Draws the path/],
		["Labels", /^Writes each body’s name/],
		["Moons", /^Shows the moons of the planets/],
		["All moons", /^Also shows the many small moons/],
		["Markers", /^Puts a coloured dot on every planet/],
		["Orbit names", /^Writes each planet’s name on its orbit line/],
		["Always lit", /^Lights every body from where you look/],
	] as const)
		await expect(toggle(page, name)).toHaveAccessibleDescription(text)

	await openScale(page)
	await expect(
		page.getByRole("radio", { name: "True scale" }),
	).toHaveAccessibleDescription(/^Real sizes, real distances/)
	await expect(
		page.getByRole("button", { name: "Pause", exact: true }),
	).toHaveAccessibleDescription("Pause (Space)")
})

test("a disabled switch says what to turn on first", async ({ page }) => {
	await open(page)
	await toggle(page, "Moons").click()
	await expect(toggle(page, "All moons")).toBeDisabled()
	await expect(toggle(page, "All moons")).toHaveAccessibleDescription(
		/Turn on Moons first\.$/,
	)
	await pointAt(page, switchRoot(page, "All moons"))
	await expect(hint(page)).toContainText("Turn on Moons first.")

	// the open hint lies over the row above, which stays clickable
	await toggle(page, "Labels").click()
	await expect(toggle(page, "Orbit names")).toHaveAccessibleDescription(
		/Turn on Labels first\.$/,
	)
	await toggle(page, "Orbits").click()
	await expect(toggle(page, "Orbit names")).toHaveAccessibleDescription(
		/Turn on Orbits and Labels first\.$/,
	)
	await toggle(page, "Moons").click()
	await expect(toggle(page, "All moons")).toHaveAccessibleDescription(
		/^Also shows the many small moons[^]*kilometres across\.$/,
	)
})

test("each option of a choice has its own hint", async ({ page }) => {
	await open(page)
	await openScale(page)
	const presets = page.getByRole("radiogroup", { name: "Scale preset" })
	await presets.getByText("True scale", { exact: true }).hover()
	await expect(hint(page)).toHaveText(/^Real sizes, real distances/)
	await expectBeside(
		presets.getByText("True scale", { exact: true }),
		hint(page),
	)
	await presets.getByText("Textbook", { exact: true }).hover()
	await expect(hint(page)).toHaveText(/^Like a textbook picture/)

	await openTime(page)
	await page.getByText("Stopped", { exact: true }).hover()
	await expect(hint(page)).toHaveText(/^No planet spins/)

	await page.getByRole("button", { name: "Reverse", exact: true }).hover()
	await expect(hint(page)).toHaveText("Run time backwards")
})

test("hints follow the language and the reading level, and grow on a projector", async ({
	page,
}) => {
	await open(page, "lang=de&reading=simple")
	await pointAt(
		page,
		page
			.getByRole("group", { name: "Szenenebenen" })
			.getByText("Immer beleuchtet", { exact: true }),
	)
	await expect(hint(page)).toHaveText(
		/^Beleuchtet jeden Planeten von deiner Seite/,
	)
	const normal = await hint(page).evaluate((el) =>
		parseFloat(getComputedStyle(el).fontSize),
	)

	await open(page, "lang=en&present=true")
	await openTime(page)
	await page.getByRole("button", { name: "Now", exact: true }).hover()
	await expect(hint(page)).toHaveText("Jump to the current time")
	const projected = await hint(page).evaluate((el) =>
		parseFloat(getComputedStyle(el).fontSize),
	)
	expect(projected).toBeGreaterThan(normal * 1.2)
})

test.describe("touch", () => {
	test.use({ hasTouch: true })

	test("a long press shows the hint without toggling; a tap still toggles", async ({
		page,
	}) => {
		await open(page)
		const markers = toggle(page, "Markers")
		await expect(markers).toBeChecked()
		const box = (await switchRoot(page, "Markers")
			.getByText("Markers", { exact: true })
			.boundingBox())!
		const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

		// hold the finger down until the hint shows, then lift it
		const cdp = await page.context().newCDPSession(page)
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [point],
		})
		await expect(hint(page)).toContainText("Puts a coloured dot")
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		})
		await expectBeside(switchRoot(page, "Markers"), hint(page))
		await expect(markers).toBeChecked()

		// a plain tap toggles, and closes the hint
		await page.touchscreen.tap(point.x, point.y)
		await expect(markers).not.toBeChecked()
		await expect(hint(page)).toHaveCount(0)
	})
})
