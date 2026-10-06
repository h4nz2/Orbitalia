import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"

// #29's "back to the start" (R / Home) with a guided tour (#28) open: a tour
// opened after the lesson link ends with the rest of the wandering off, and a
// lesson link that was itself a tour link opens on its stop again. Neither
// leaves the card behind in the "left" state.

test.describe.configure({ timeout: 180_000 })

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 30_000,
	})
	await cameraAtRest(page)
}

const card = (page: Page) => page.locator("[data-tour-card]")

/** R from the page itself, not from the button that has the focus. */
const backToStart = async (page: Page) => {
	await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
	await page.keyboard.press("r")
}

test("R ends a tour opened after the lesson link and restores the link", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=saturn")
	await page.getByRole("button", { name: "Guided tours" }).click()
	await page.getByRole("menuitem", { name: /The Grand Tour/ }).click()
	await expect(card(page)).toBeVisible()
	await card(page).getByRole("button", { name: "Next" }).click()
	await expect(card(page).getByTestId("tour-count")).toHaveText("Stop 2 of 11")

	await backToStart(page)
	await expect(card(page)).toHaveCount(0)
	await expect(page).not.toHaveURL(/tour=/)
	await cameraAtRest(page)
	const view = await page.evaluate(
		() => window.__orbitalia!.store.getState().view,
	)
	expect(view).toEqual({ kind: "body", id: "saturn" })
})

test("R on a tour link opens the tour on the linked stop again", async ({
	page,
}) => {
	await ready(page, "/solar_system?tour=earthMoves&stop=2")
	await expect(card(page).getByTestId("tour-count")).toHaveText(/^Stop 2 of/)
	await card(page).getByRole("button", { name: "Next" }).click()
	await card(page).getByRole("button", { name: "Next" }).click()
	await expect(card(page).getByTestId("tour-count")).toHaveText(/^Stop 4 of/)

	await backToStart(page)
	await expect(card(page).getByTestId("tour-count")).toHaveText(/^Stop 2 of/)
	await expect(page).toHaveURL(/tour=earthMoves/)
	await expect(page).toHaveURL(/stop=2/)
	// the card is playing the stop, not offering "Back to the tour"
	await expect(
		card(page).getByRole("button", { name: "Back to the tour" }),
	).toHaveCount(0)
})
