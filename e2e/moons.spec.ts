import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"
import { expandCard, openLayers } from "./support/hud"

// Moons (#17) in the real browser: the featured moons by default, the long
// tail on request, a planet's moon system in its card, focusing a moon and
// reading its story, and the whole-system shot.

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
	// the card starts small (#42): its moons are in the unfolded part
	if (url.includes("focus=")) await expandCard(page)
}

const card = (page: Page) => page.getByTestId("body-card")

test("a planet's card lists its featured moons and a click flies to one", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=jupiter&lang=en")
	const moons = page.getByTestId("moon-system")
	await expect(moons.getByRole("heading", { name: "Moons" })).toBeVisible()
	await expect(moons.locator("[data-moon]")).toHaveText([
		"Io",
		"Europa",
		"Ganymede",
		"Callisto",
	])
	// the long tail is off by default: no small moon is named or dotted
	await expect(
		page.locator('[data-body="metis"][data-visible="true"]'),
	).toHaveCount(0)
	expect(
		await page.evaluate(
			() => window.__orbitalia!.store.getState().showAllMoons,
		),
	).toBe(false)

	await moons.locator('[data-moon="europa"]').click()
	await expect(page).toHaveURL(/focus=europa/)
	await expect(card(page)).toHaveAttribute("data-card-body", "europa")
	await expect(card(page).getByText("An ocean under the ice")).toBeVisible()
	await cameraAtRest(page)

	// the story, then back to the planet
	const story = page.getByTestId("moon-story")
	await story.getByRole("button", { name: "Read its story" }).click()
	await expect(page.getByTestId("moon-description")).toContainText(
		"Europa Clipper",
	)
	await story.getByRole("button", { name: "Moon of Jupiter" }).click()
	await expect(page).toHaveURL(/focus=jupiter/)
	await expect(card(page)).toHaveAttribute("data-card-body", "jupiter")
})

test("the smaller moons are revealed deliberately, and a link keeps them", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=saturn&lang=en")
	const toggle = page.getByTestId("toggle-other-moons")
	await expect(toggle).toHaveText(/^Show \d+ smaller moons$/)
	await toggle.click()
	await expect(toggle).toHaveText("Hide the smaller moons")
	await expect(page).toHaveURL(/allMoons=true/)
	await openLayers(page)
	await expect(page.getByRole("switch", { name: "All moons" })).toBeChecked()

	// the switch turns them off again, and the URL follows
	await page.getByRole("switch", { name: "All moons" }).click({ force: true })
	await expect(page).not.toHaveURL(/allMoons/)
	await expect(toggle).toHaveText(/^Show \d+ smaller moons$/)

	// a link opens with all moons, and the switch needs the moons layer
	await ready(page, "/solar_system?focus=saturn&allMoons=true&lang=en")
	await openLayers(page)
	await expect(page.getByRole("switch", { name: "All moons" })).toBeChecked()
	await page
		.getByRole("switch", { name: "Moons", exact: true })
		.click({ force: true })
	await expect(page.getByRole("switch", { name: "All moons" })).toBeDisabled()
})

test("See the whole moon system steps back to fit every orbit", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=uranus&lang=en")
	const before = await page.evaluate(
		() => window.__orbitalia!.camera().distance,
	)
	await page.getByRole("button", { name: "See the whole moon system" }).click()
	await page.waitForFunction(
		() => window.__orbitalia!.store.getState().transition === null,
	)
	await cameraAtRest(page)
	const after = await page.evaluate(() => window.__orbitalia!.camera())
	expect(after.distance).toBeGreaterThan(before * 2)
	// still Uranus, and every featured moon is on screen
	await expect(page).toHaveURL(/focus=uranus/)
	for (const id of ["miranda", "ariel", "umbriel", "titania", "oberon"]) {
		const place = await page.evaluate(
			(id) => window.__orbitalia!.screenOf(id),
			id,
		)
		expect(place, id).not.toBeNull()
	}
})

test("moon stories are translated and a moonless planet says so", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=titan&lang=de&reading=simple")
	await expect(
		card(page).getByText("Der Mond mit Regen und Seen"),
	).toBeVisible()
	await expect(
		page.getByRole("button", { name: "Die ganze Geschichte lesen" }),
	).toBeVisible()

	await ready(page, "/solar_system?focus=venus&lang=en")
	await expect(page.getByTestId("moon-system")).toHaveText(
		"Venus has no moons.",
	)
})
