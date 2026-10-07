import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"
import { expandCard } from "./support/hud"

// The simple reading level for ages 6–11 (#51): the world card says it with
// Earth and everyday things, never with big numbers or scientific units.

test.describe.configure({ timeout: 180_000 })

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	await cameraAtRest(page)
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setPaused(true),
	)
	await expandCard(page)
}

const card = (page: Page) => page.getByTestId("body-card")

test("the world card compares instead of counting", async ({ page }) => {
	await ready(page, "/solar_system?focus=jupiter&lang=en&reading=simple")
	const facts = card(page).locator("[data-fact]")
	await expect(card(page).locator("[data-fact=size]")).toContainText(
		"11 Earths wide",
	)
	await expect(card(page).locator("[data-fact=size]")).toContainText(
		"If Earth were as small as an orange, Jupiter would be as big as an exercise ball",
	)
	for (const text of await facts.allTextContents()) {
		expect(text).not.toMatch(/\d{3}|\bkm\b|\bAU\b|m\/s²|million/)
	}

	// the standard level keeps the exact numbers
	await ready(page, "/solar_system?focus=jupiter&lang=de&reading=standard")
	await expect(card(page).locator("[data-fact=size]")).toContainText(
		"139.822 km",
	)
})
