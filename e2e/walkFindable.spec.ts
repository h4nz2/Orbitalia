/**
 * The walk is easy to find (#48): from the default view the basketball walk
 * (#25) is at most two actions away from Tools, from the Scale panel in every
 * preset and from a world's card, each named for the idea; the grand tour
 * offers it; and the first switch to True scale points at it, once, never
 * while presenting.
 */
import { expect, test, type Locator, type Page } from "@playwright/test"

import { expandCard, openScale } from "./support/hud"

const NUDGE_KEY = "orbitalia.walkNudgeShown"

const scalePresets = (panel: Locator) =>
	panel.getByRole("radiogroup", { name: "Scale preset" })

/** Clicks a segment of a SegmentedControl by its visible label (the radio input itself is hidden). */
const pick = (panel: Locator, group: string, label: string) =>
	panel
		.getByRole("radiogroup", { name: group })
		.getByText(label, { exact: true })
		.click()

const scalePreset = (page: Page) =>
	page.locator("canvas").first().getAttribute("data-scale-preset")

/** This browser has not seen the tip yet (every other test has, playwright.config.ts). */
async function firstTimeHere(page: Page, url: string): Promise<void> {
	await page.goto(url)
	await page.evaluate((key) => localStorage.removeItem(key), NUDGE_KEY)
	await page.reload()
}

test("Tools: “Walk the solar system”, right after Side by side, says what it does", async ({
	page,
}) => {
	await page.goto("/solar_system?lang=en")
	await page.getByTestId("tools-menu").click()
	const walk = page.locator('[data-tool="walk"]')
	await expect(walk).toBeVisible()
	const order = await page
		.locator("[data-tool]")
		.evaluateAll((items) => items.map((item) => item.getAttribute("data-tool")))
	expect(order.indexOf("walk")).toBe(order.indexOf("compare") + 1)
	await expect(walk).toContainText("Walk the solar system")
	await expect(walk).toContainText("Shrink the Sun to a basketball")
	await walk.click()
	await expect(page).toHaveURL(/\/solar_walk/)
})

test("the Scale panel offers the walk in every preset", async ({ page }) => {
	test.slow()
	await page.goto("/solar_system?lang=en")
	const panel = await openScale(page)
	const card = panel.getByTestId("walk-card")
	await expect(card).toBeVisible()
	await expect(card).toHaveText(
		"Shrink the Sun to a basketball and walk the solar system on a school field",
	)
	// every named preset the panel lists, whatever they are
	const labels = await scalePresets(panel).locator("label").allInnerTexts()
	expect(labels.length).toBeGreaterThanOrEqual(3)
	for (const label of labels) {
		await pick(panel, "Scale preset", label.trim())
		await expect(card, label).toBeVisible()
	}
	// and the fourth cell of the grid, reached through the lies
	await pick(panel, "Sizes", "Enlarged")
	await pick(panel, "Distances", "Real")
	await expect.poll(() => scalePreset(page)).toBe("bigPlanets")
	await expect(card).toBeVisible()
	await card.click()
	await expect(page).toHaveURL(/\/solar_walk/)
})

test("a world's comparison opens the walk on that world", async ({ page }) => {
	await page.goto("/solar_system?focus=jupiter&lang=en")
	await expandCard(page)
	const link = page.getByTestId("card-walk")
	await expect(link).toHaveText(
		"Shrink the Sun to a basketball and walk out to this world",
	)
	await link.click()
	await expect(page).toHaveURL(/\/solar_walk\?.*focus=jupiter/)
	const stop = page.locator('li[data-stop="jupiter"]')
	await expect(stop).toHaveAttribute("aria-current", "location")
	await expect(stop).toBeInViewport()
	// the way back is the solar system as it was left
	await page.getByRole("button", { name: "Back" }).click()
	await expect(page).toHaveURL(/\/solar_system\?.*focus=jupiter/)
})

test("a big moon opens on its planet's stop; a body the walk leaves out has no link", async ({
	page,
}) => {
	await page.goto("/solar_walk?focus=titan&view=table&lang=en")
	await expect(page.locator('tr[data-row="titan"]')).toHaveAttribute(
		"data-focused",
		"true",
	)
	await expect(page.locator('tr[data-row="titan"]')).toBeInViewport()
	await page.goto("/solar_walk?focus=titan&lang=en")
	await expect(page.locator('li[data-stop="saturn"]')).toHaveAttribute(
		"aria-current",
		"location",
	)
	await expect(page.locator('li[data-moon="titan"]')).toHaveAttribute(
		"data-focused",
		"true",
	)
	// an id the walk does not have is dropped, the walk opens at the Sun
	await page.goto("/solar_walk?focus=phobos&lang=en")
	await expect(page.locator("[aria-current]")).toHaveCount(0)

	await page.goto("/solar_system?focus=phobos&lang=en")
	await expandCard(page)
	await expect(page.getByTestId("body-card")).toBeVisible()
	await expect(page.getByTestId("card-walk")).toHaveCount(0)
})

test("the grand tour offers the walk where it says the planets are drawn too big", async ({
	page,
}) => {
	await page.goto("/solar_system?tour=grandTour&lang=en")
	const card = page.locator("[data-tour-card]")
	await expect(card).toHaveAttribute("data-stop", "system")
	await expect(
		card.getByRole("link", {
			name: /Shrink the Sun to a basketball and walk the solar system/,
		}),
	).toHaveAttribute("href", /\/solar_walk\?/)
})

test.describe("the one-time tip", () => {
	test("the first switch to True scale points at the walk, once", async ({
		page,
	}) => {
		test.slow()
		await firstTimeHere(page, "/solar_system?lang=en")
		const panel = await openScale(page)
		await pick(panel, "Scale preset", "True scale")
		const nudge = page.getByTestId("walk-nudge")
		await expect(nudge).toBeVisible()
		await expect(nudge).toContainText("Where did the planets go?")
		await expect(nudge.getByTestId("walk-card")).toBeVisible()
		expect(
			await page.evaluate((key) => localStorage.getItem(key), NUDGE_KEY),
		).toBe("1")
		// with the panel closed, it waits in the dock above the entry points
		await page.locator('[data-entry="scale"]').click()
		await expect(
			page.getByTestId("dock").getByTestId("walk-nudge"),
		).toBeVisible()
		await openScale(page)
		await nudge.getByRole("button", { name: "Close the tip" }).click()
		await expect(nudge).toHaveCount(0)
		// the card itself stays
		await expect(panel.getByTestId("walk-card")).toBeVisible()

		// not again: neither now nor on the next visit
		await pick(panel, "Scale preset", "Everything visible")
		await pick(panel, "Scale preset", "True scale")
		await expect.poll(() => scalePreset(page)).toBe("trueScale")
		await expect(nudge).toHaveCount(0)
		await page.goto("/solar_system?lang=en")
		const again = await openScale(page)
		await pick(again, "Scale preset", "True scale")
		await expect.poll(() => scalePreset(page)).toBe("trueScale")
		await expect(page.getByTestId("walk-nudge")).toHaveCount(0)
	})

	test("stays quiet in presentation mode", async ({ page }) => {
		await firstTimeHere(page, "/solar_system?present=true&lang=en")
		const panel = await openScale(page)
		await pick(panel, "Scale preset", "True scale")
		await expect.poll(() => scalePreset(page)).toBe("trueScale")
		await expect(page.getByTestId("walk-nudge")).toHaveCount(0)
		// it is still to come, outside the projector
		expect(
			await page.evaluate((key) => localStorage.getItem(key), NUDGE_KEY),
		).toBeNull()
	})
})
