import { expect, test, type Page } from "@playwright/test"
import { openLayers, openTool } from "./support/hud"

// Real spacecraft (#35) in the real browser: the menu, the info panel with its
// launch date, targets and signal time, a milestone that travels in time,
// honest states before launch and after a mission ended, the layer switch,
// German names, and a craft's name as a click target. The layer is hidden
// until asked for (#70): its two switches agree and are in the link, and a
// link, a sky event or Back to a craft shows it.

// software WebGL is slow, and flights and time glides must land first
test.describe.configure({ timeout: 180_000 })

/** 25 September 2026, 00:00 UTC (paused in the link, so nothing drifts). */
const T_2026 = 2461308.5

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setPaused(true),
	)
	await settled(page)
}

const settled = (page: Page) =>
	page.waitForFunction(
		() => {
			const handle = window.__orbitalia
			if (handle === undefined) return false
			const state = handle.store.getState()
			return (
				handle.camera().transitionId === null &&
				state.transition === null &&
				state.clock.glide === null
			)
		},
		null,
		{ timeout: 60_000 },
	)

/** Tools → Real spacecraft (#42): the list opens in the dock. */
const openMenu = async (page: Page) => {
	await openTool(page, "spacecraft")
	await expect(page.locator("[data-dock-panel=spacecraft]")).toBeVisible()
}

const pick = async (page: Page, id: string) => {
	await openMenu(page)
	await page.locator(`button[data-craft=${id}]`).click()
	await settled(page)
	await page.waitForTimeout(600) // labels fade in over 0.2 s
}

const panel = (page: Page) =>
	page.getByRole("region", { name: "Selected spacecraft" })

/** Craft names on screen (the layer draws them with the markers and paths). */
const namesShown = (page: Page) =>
	page.locator("span[data-craft][data-visible=true]")

/** Layers → Spacecraft (#70). */
const layerSwitch = async (page: Page) =>
	(await openLayers(page)).getByRole("switch", { name: "Spacecraft" })

/** Tools → Real spacecraft → Spacecraft: the same layer. */
const listSwitch = async (page: Page) => {
	await openMenu(page)
	return page
		.locator("[data-dock-panel=spacecraft]")
		.getByRole("switch", { name: "Spacecraft" })
}

/**
 * The HUD clock; its `datetime` is the machine-readable instant. Its text
 * follows the store's clock at 10 Hz (`useThrottledSimTime`), up to 100 ms
 * and a render behind it: await it with `toHaveAttribute`, never read it once.
 */
const hudClock = (page: Page) => page.locator("time[datetime]").first()

test("Voyager 1: where it is, when it launched, how long its signal takes", async ({
	page,
}) => {
	await ready(page, `/solar_system?t=${T_2026}&lang=en&reading=standard`)
	await openMenu(page)
	// every craft is listed, with its state at the simulation date
	await expect(page.locator("button[data-craft]")).toHaveCount(10)
	await expect(page.locator("button[data-craft=pioneer10]")).toContainText(
		"Silent since Jan 23, 2003",
	)
	await expect(page.locator("button[data-craft=voyager1]")).toContainText(
		"Mission active",
	)
	await page.locator("button[data-craft=voyager1]").click()
	await settled(page)

	const info = panel(page)
	await expect(info).toContainText("Voyager 1")
	await expect(info).toContainText("Spacecraft")
	await expect(info).toContainText("Mission active")
	await expect(info).toContainText("Sep 5, 1977")
	// about 170 AU from the Sun in 2026, a signal takes about 23 hours
	const au = Number(
		(await info.locator("[data-fact=sun]").innerText()).match(
			/([\d.]+) AU/,
		)![1],
	)
	expect(au).toBeGreaterThan(165)
	expect(au).toBeLessThan(175)
	await expect(info.locator("[data-fact=signal]")).toContainText(
		/2[2-4] h \d+ min/,
	)
	// the targets it visited
	await expect(info).toContainText("Flies past Jupiter")
	await expect(info).toContainText("Flies past Saturn")
	await expect(info).toContainText("Crosses the heliopause")

	// the view flew to it: its name is on screen, in the selection colour
	await page.waitForTimeout(600)
	const label = page.locator("span[data-craft=voyager1]")
	await expect(label).toHaveAttribute("data-visible", "true")
	await expect(label).toHaveAttribute("data-selected", "true")
})

test("a milestone travels in time to it: Voyager 1 at Jupiter, 1979", async ({
	page,
}) => {
	await ready(page, `/solar_system?t=${T_2026}&lang=en`)
	await pick(page, "voyager1")
	await panel(page)
		.locator("button[data-event=flyby]")
		.filter({ hasText: "Jupiter" })
		.click()
	await settled(page)
	// on arrival the clock stands exactly on the flyby: paused, nothing drifts
	const clock = await page.evaluate(() => {
		const { simTimeJD, clock } = window.__orbitalia!.store.getState()
		const iso = new Date((simTimeJD - 2440587.5) * 86_400_000).toISOString()
		return { iso, rate: clock.rate }
	})
	expect(clock.iso).toMatch(/^1979-03-05T12:/)
	expect(clock.rate).toBe(0)
	// and the HUD shows it, a moment later
	await expect(hudClock(page)).toHaveAttribute("datetime", /^1979-03-05T12:/)
	await expect(
		page.getByRole("button", { name: "Pause", pressed: true }),
	).toBeVisible()
	// the view is on Jupiter, and the craft passing it is named
	await expect(page.getByRole("combobox", { name: "Focus body" })).toHaveValue(
		"Jupiter",
	)
	await page.waitForTimeout(600)
	await expect(page.locator("span[data-craft=voyager1]")).toHaveAttribute(
		"data-visible",
		"true",
	)
	await expect(panel(page).locator("[data-fact=speed]")).toContainText("km/s")
})

test("before launch a craft is not in space, after its end it is shown as ended", async ({
	page,
}) => {
	// 1 January 1975: before the Voyagers, Pioneer 10 already on its way
	await ready(page, "/solar_system?t=2442413.5&lang=en")
	await openMenu(page)
	await expect(page.locator("button[data-craft=voyager1]")).toContainText(
		"Not launched yet",
	)
	await expect(page.locator("button[data-craft=pioneer10]")).toContainText(
		"Mission active",
	)
	await page.locator("button[data-craft=voyager1]").click()
	await expect(panel(page)).toContainText(
		"Not launched yet (launch on Sep 5, 1977)",
	)
	await expect(panel(page).locator("[data-fact=signal]")).toHaveCount(0)
	await expect(page.locator("span[data-craft=voyager1]")).not.toHaveAttribute(
		"data-visible",
		"true",
	)

	// 2020: Cassini burned up in Saturn in 2017
	await ready(page, "/solar_system?t=2458849.5&lang=en")
	await pick(page, "cassini")
	await expect(panel(page)).toContainText("Mission ended on Sep 15, 2017")
	await expect(page.locator("span[data-craft=cassini]")).not.toHaveAttribute(
		"data-visible",
		"true",
	)
	await expect(panel(page)).toContainText("Plunges into Saturn")
})

test("the layer switch hides every craft; names are translated", async ({
	page,
}) => {
	await ready(page, `/solar_system?t=${T_2026}&lang=de`)
	await pick(page, "jwst")
	await expect(panel(page)).toHaveCount(0) // the panel's name is German
	const info = page.getByRole("region", { name: "Ausgewählte Raumsonde" })
	await expect(info).toContainText("James-Webb-Weltraumteleskop")
	await expect(info).toContainText("Raumsonde")
	await expect(info.locator("[data-fact=signal]")).toContainText(/^[\d,]+ s/)
	await expect(page.locator("span[data-craft=jwst]")).toHaveText(
		"James-Webb-Weltraumteleskop",
	)

	await openMenu(page)
	await page.getByRole("switch", { name: "Raumsonden" }).click()
	await page.keyboard.press("Escape")
	await page.waitForTimeout(600)
	await expect(page.locator("span[data-craft][data-visible=true]")).toHaveCount(
		0,
	)
	await expect(info).toHaveCount(0)
})

test("a craft's name is a click target, like its marker", async ({ page }) => {
	await ready(page, `/solar_system?t=${T_2026}&lang=en`)
	await pick(page, "voyager2")
	await panel(page).getByRole("button", { name: "Close" }).click()
	await expect(panel(page)).toHaveCount(0)
	const label = page.locator("span[data-craft=voyager2]")
	await expect(label).toHaveAttribute("data-visible", "true")
	const box = (await label.boundingBox())!
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await expect(page.locator("canvas")).toHaveCSS("cursor", "pointer")
	await page.mouse.down()
	await page.mouse.up()
	await expect(panel(page)).toContainText("Voyager 2")
})

test("hidden on a fresh visit; the Layers switch shows them, the link carries them, and both switches agree (#70)", async ({
	page,
	context,
}) => {
	await ready(page, `/solar_system?t=${T_2026}&paused=true&lang=en`)
	await page.waitForTimeout(600)
	await expect(namesShown(page)).toHaveCount(0)
	const layers = await layerSwitch(page)
	await expect(layers).not.toBeChecked()

	await layers.click()
	await expect(layers).toBeChecked()
	await expect(page).toHaveURL(/[?&]spacecraft=true/)
	await expect.poll(() => namesShown(page).count()).toBeGreaterThan(0)
	// the list's switch is the same layer
	const list = await listSwitch(page)
	await expect(list).toBeChecked()

	// the link opens with them shown
	const again = await context.newPage()
	await ready(again, page.url().replace(/^https?:\/\/[^/]+/, ""))
	await expect(await layerSwitch(again)).toBeChecked()
	await expect.poll(() => namesShown(again).count()).toBeGreaterThan(0)
	await again.close()

	// off in the list: off in Layers, gone from the address and the sky
	await list.click()
	await expect(list).not.toBeChecked()
	await expect(await layerSwitch(page)).not.toBeChecked()
	await expect(page).not.toHaveURL(/spacecraft=/)
	await expect(namesShown(page)).toHaveCount(0)
})

test("a spacecraft link shows the layer with the craft selected, and the address keeps it (#70)", async ({
	page,
}) => {
	await ready(page, `/solar_system?craft=voyager1&t=${T_2026}&lang=en`)
	await expect(panel(page)).toContainText("Voyager 1", { timeout: 30_000 })
	await settled(page)
	await expect(page.locator("span[data-craft=voyager1]")).toHaveAttribute(
		"data-selected",
		"true",
	)
	await expect(page.locator("span[data-craft=voyager1]")).toHaveAttribute(
		"data-visible",
		"true",
	)
	await expect(page).toHaveURL(/[?&]spacecraft=true/)
	await expect(page).not.toHaveURL(/[?&]craft=/)
	await expect(await layerSwitch(page)).toBeChecked()
})

test("a sky event about a spacecraft shows the layer, and leaving it hides it again (#70)", async ({
	page,
}) => {
	await ready(page, "/solar_system?tour=event-voyagerNeptune&stop=1&lang=en")
	await expect(panel(page)).toContainText("Voyager 2", { timeout: 30_000 })
	await expect(page).toHaveURL(/[?&]spacecraft=true/)
	// the event goes back to the scene before it: the spacecraft were hidden there
	await page.locator("[data-event-card]").getByTestId("event-leave").click()
	await expect(page).not.toHaveURL(/tour=/)
	await expect(page).not.toHaveURL(/spacecraft=/)
	await expect(panel(page)).toHaveCount(0)
})

test("Back to a spacecraft shows the layer again (#70)", async ({ page }) => {
	await ready(page, `/solar_system?t=${T_2026}&paused=true&lang=en`)
	await pick(page, "voyager1")
	await expect(panel(page)).toContainText("Voyager 1")
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setFocus("jupiter"),
	)
	await settled(page)
	await expect(panel(page)).toHaveCount(0)
	const layers = await layerSwitch(page)
	await layers.click()
	await expect(layers).not.toBeChecked()
	await expect(page).not.toHaveURL(/spacecraft=/)

	await page.getByTestId("back-button").click()
	await expect(panel(page)).toContainText("Voyager 1")
	await expect(await layerSwitch(page)).toBeChecked()
	await expect(page).toHaveURL(/[?&]spacecraft=true/)
})
