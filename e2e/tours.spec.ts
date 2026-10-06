import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"

// Guided tours (#28) in the real browser: the menu starts a tour, the card
// steps through it with buttons and presenter keys, the visitor can wander
// off and come back, a link opens on a stop, and autoplay moves on by itself.

// software WebGL is slow and every step waits for real camera moves
test.describe.configure({ timeout: 180_000 })

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 30_000,
	})
	await cameraAtRest(page)
}

const card = (page: Page) => page.locator("[data-tour-card]")
const state = (page: Page) =>
	page.evaluate(() => {
		const s = window.__orbitalia!.store.getState()
		return {
			view: s.view,
			frameId: s.frameId,
			selectedId: s.selectedId,
			showMarkers: s.showMarkers,
		}
	})

test("the menu starts a tour, and the card steps through it", async ({
	page,
}) => {
	await ready(page, "/solar_system")
	await page.getByRole("button", { name: "Guided tours" }).click()
	await expect(page.getByRole("menuitem")).toHaveCount(4)
	await page.getByRole("menuitem", { name: /The Grand Tour/ }).click()

	await expect(card(page)).toBeVisible()
	await expect(card(page).getByTestId("tour-count")).toHaveText("Stop 1 of 11")
	await expect(
		card(page).getByRole("heading", { name: "Our solar system" }),
	).toBeVisible()
	await expect(page).toHaveURL(/tour=grandTour/)
	await expect(page).toHaveURL(/stop=1/)

	await card(page).getByRole("button", { name: "Next" }).click()
	await expect(card(page).getByTestId("tour-count")).toHaveText("Stop 2 of 11")
	await expect(
		card(page).getByRole("heading", { name: "The Sun" }),
	).toBeVisible()
	await expect(page).toHaveURL(/stop=2/)
	await cameraAtRest(page)
	expect((await state(page)).view).toEqual({ kind: "body", id: "sun" })

	// a clicker's Page Down and the arrow keys step it too
	await page.keyboard.press("PageDown")
	await expect(card(page).getByTestId("tour-count")).toHaveText("Stop 3 of 11")
	await page.keyboard.press("ArrowLeft")
	await expect(card(page).getByTestId("tour-count")).toHaveText("Stop 2 of 11")

	// a dot jumps to its stop
	await card(page).getByRole("button", { name: "Stop 5: Earth" }).click()
	await expect(card(page).getByTestId("tour-count")).toHaveText("Stop 5 of 11")

	await card(page).getByRole("button", { name: "End the tour" }).click()
	await expect(card(page)).toHaveCount(0)
	await expect(page).not.toHaveURL(/tour=/)
})

test("wandering off and coming back restores the stop", async ({ page }) => {
	await ready(page, "/solar_system?tour=howBig&stop=7")
	await expect(card(page)).toHaveAttribute("data-stop", "empty")
	expect((await state(page)).showMarkers).toBe(false)

	// a click on a body (here through the store, as the picker does) is exploring
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setFocus("jupiter"),
	)
	await expect(card(page)).toHaveAttribute("data-status", "exploring")
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setShowMarkers(true),
	)
	await card(page)
		.getByRole("status")
		.getByRole("button", { name: "Back to the tour" })
		.click()
	await expect(card(page)).toHaveAttribute("data-status", "playing")
	await cameraAtRest(page)
	const back = await state(page)
	expect(back.view).toEqual({ kind: "overview" })
	expect(back.showMarkers).toBe(false)

	// Escape is the way out of the view, not of the tour
	await page.keyboard.press("Escape")
	await expect(card(page)).toHaveAttribute("data-status", "left")
	await card(page)
		.getByRole("status")
		.getByRole("button", { name: "Back to the tour" })
		.click()
	await expect(card(page)).toHaveAttribute("data-status", "playing")
})

test("a link opens on a stop: the frame, the date and the language", async ({
	page,
}) => {
	await ready(
		page,
		"/solar_system?tour=earthMoves&stop=3&lang=de&reading=simple",
	)
	await expect(card(page).getByTestId("tour-count")).toHaveText(
		"Station 3 von 7",
	)
	await expect(
		card(page).getByRole("heading", { name: "Die Erde überholt Mars" }),
	).toBeVisible()
	const held = await state(page)
	expect(held.frameId).toBe("earth")
	expect(held.selectedId).toBe("mars")
	await expect(page.locator("time").first()).toHaveAttribute(
		"datetime",
		/^2025-01-16T12:00/,
	)
	// the stop is paused on its date
	expect(
		await page.evaluate(() => window.__orbitalia!.store.getState().paused),
	).toBe(true)

	// the next stop in German, and the frame follows the stops
	await page.keyboard.press("ArrowRight")
	await expect(card(page)).toHaveAttribute("data-stop", "epicycles")
	await page.keyboard.press("ArrowRight")
	await expect(card(page)).toHaveAttribute("data-stop", "copernicus")
	await expect.poll(async () => (await state(page)).frameId).toBe("sun")
})

test("autoplay moves on by itself", async ({ page }) => {
	await ready(page, "/solar_system?tour=howBig&stop=7&autoplay=true")
	await expect(card(page).getByTestId("tour-autoplay")).toHaveAttribute(
		"aria-pressed",
		"true",
	)
	await expect(card(page)).toHaveAttribute("data-stop", "basketball", {
		timeout: 90_000,
	})
	await expect(
		card(page).getByRole("link", { name: /Walk the model/ }),
	).toHaveAttribute("href", /\/solar_walk\?lang=en&reading=standard$/)
	// the last stop stays; Finish ends the tour
	await card(page).getByRole("button", { name: "Finish" }).click()
	await expect(card(page)).toHaveCount(0)
})
