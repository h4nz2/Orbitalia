/**
 * No main menu (#45): the bare address opens the solar system, every place the
 * old start page led to is at most two actions away from it, and every other
 * page leads back into it, to where the visitor left.
 */
import { expect, test, type Page } from "@playwright/test"

import { openTool } from "./support/hud"

const focusPicker = (page: Page) =>
	page.getByRole("combobox", { name: "Focus body" })

test("the bare address opens the solar system, in the link's language and reading level", async ({
	page,
}) => {
	await page.goto("/?lang=de&reading=simple")
	await expect(page).toHaveURL(/\/solar_system\?/)
	await expect(page).toHaveURL(/[?&]lang=de(&|$)/)
	await expect(page).toHaveURL(/[?&]reading=simple(&|$)/)
	await expect(
		page.getByRole("combobox", { name: "Himmelskörper im Fokus" }),
	).toHaveValue("Sonne")
})

test.describe("a first visit", () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test("gets the opening at the bare address", async ({ page }) => {
		test.slow()
		await page.goto("/")
		await expect(page).toHaveURL(/\/solar_system/)
		await expect(page.getByTestId("intro-skip")).toBeVisible({
			timeout: 60_000,
		})
	})
})

test("every place of the old menu is two actions away", async ({ page }) => {
	await page.goto("/solar_system?lang=en")
	await expect(focusPicker(page)).toBeVisible()
	// Tours is an entry point of its own
	await expect(page.getByTestId("tour-menu")).toBeVisible()
	await page.getByTestId("tools-menu").click()
	for (const tool of [
		"sky",
		"birthday",
		"hunt",
		"compare",
		"walk",
		"dictionary",
	]) {
		await expect(page.locator(`[data-tool="${tool}"]`), tool).toBeVisible()
	}
})

test("the walk and the dictionary lead back to where the visitor left", async ({
	page,
}) => {
	test.slow()
	await page.goto("/solar_system?focus=mars&lang=en")
	await expect(focusPicker(page)).toHaveValue("Mars")
	const left = new URL(page.url()).searchParams.get("focus")

	await openTool(page, "walk")
	await expect(page).toHaveURL(/\/solar_walk/)
	// the URL changes before the walk is drawn, and until then the scene's own
	// Back (#46) and "Back to overview" answer to the name too
	await expect(page.locator("li[data-stop]").first()).toBeVisible()
	await page.getByRole("button", { name: "Back" }).click()
	await expect(page).toHaveURL(/\/solar_system\?/)
	await expect(focusPicker(page)).toHaveValue("Mars")

	// the dictionary opens on the world in view
	await openTool(page, "dictionary")
	await expect(page).toHaveURL(/\/solar_dictionary\?.*entity=4/)
	await page.getByTestId("dictionary-back").click()
	await expect(page).toHaveURL(/\/solar_system\?/)
	expect(new URL(page.url()).searchParams.get("focus")).toBe(left)
	await expect(focusPicker(page)).toHaveValue("Mars")
})

test("a page opened from a link leads into the solar system", async ({
	page,
}) => {
	await page.goto("/solar_dictionary?entity=5&lang=en")
	await page.getByTestId("dictionary-back").click()
	await expect(page).toHaveURL(/\/solar_system\?.*focus=jupiter/)

	await page.goto("/solar_walk?lang=en")
	await page.getByRole("button", { name: "Back" }).click()
	await expect(page).toHaveURL(/\/solar_system\?.*scale=trueScale/)
})

test("what the start page said lives on the help page", async ({ page }) => {
	await page.goto("/help?topic=about&lang=en")
	const about = page.getByTestId("help-about")
	await expect(about).toBeInViewport()
	await expect(about).toContainText("To the stars!")
	await expect(about).toContainText("Made with love by odi and hrj.")
})
