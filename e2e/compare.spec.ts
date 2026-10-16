import { expect, test, type Page } from "@playwright/test"

import { menuAtRest } from "./support/scene"

// Side by side (#24): bodies at true relative size with plain-language
// comparisons, reached in one click from the focused body's card, chosen with
// pickers and ready-made ideas (never typed), in every language and reading
// level, on a projector and on a phone. The page itself draws with plain DOM,
// so only the first test (which starts in the 3D solar system) is slow.

/** The drawn radius of every body on the stage, px, by id. */
const drawnRadii = (page: Page) =>
	page.evaluate(() =>
		Object.fromEntries(
			[...document.querySelectorAll<HTMLElement>("[data-radius-px]")].map(
				(slot) => [slot.dataset.body, Number(slot.dataset.radiusPx)],
			),
		),
	)

const slots = (page: Page) =>
	page.locator("[data-testid=compare-stage] [data-body]")

test("the focused body's card opens the comparison in one click, and back", async ({
	page,
}) => {
	test.slow()
	await page.goto("/solar_system?focus=saturn&lang=en&reading=standard")
	const card = page.getByTestId("body-card")
	await expect(card).toHaveAttribute("data-card-body", "saturn")
	await card.getByRole("button", { name: "Compare with…" }).click()

	await expect(page).toHaveURL(/\/compare\?/)
	expect(new URL(page.url()).searchParams.get("bodies")).toBe("saturn,earth")
	await expect(slots(page)).toHaveCount(2)
	// one scale for all: the drawn radii keep the true ratio
	const radii = await drawnRadii(page)
	expect(radii.saturn / radii.earth).toBeCloseTo(58_232 / 6371.0084, 3)

	const facts = page.getByTestId("compare-facts")
	await expect(facts.getByRole("heading", { level: 2 })).toHaveText(
		"Saturn and Earth",
	)
	await expect(facts.locator("[data-fact]")).not.toHaveCount(0)
	expect(await facts.locator("[data-fact]").count()).toBeGreaterThanOrEqual(3)
	await expect(facts.locator("[data-fact=size]")).toContainText(
		"Saturn is 9.1 times as wide as Earth.",
	)
	await expect(facts.locator("[data-fact=volume]")).toContainText(
		"Earths would fit inside Saturn.",
	)

	await page.getByRole("button", { name: "Back to the solar system" }).click()
	await expect(page).toHaveURL(/\/solar_system\?.*focus=saturn/)
	await expect(page.getByTestId("body-card")).toHaveAttribute(
		"data-card-body",
		"saturn",
	)
})

test("the scene changing while the comparison loads does not bring the solar system back", async ({
	page,
}) => {
	test.slow()
	// the comparison's code is held back, so the solar system is still on screen
	// under the new address, as on a slow network or a busy machine
	let release!: () => void
	const held = new Promise<void>((resolve) => (release = resolve))
	await page.route(/\/assets\/compare-[\w-]+\.js$/, async (route) => {
		await held
		await route.continue()
	})
	await page.goto("/solar_system?focus=saturn&lang=en&reading=standard")
	const card = page.getByTestId("body-card")
	await expect(card).toHaveAttribute("data-card-body", "saturn")
	await card.getByRole("button", { name: "Compare with…" }).click()
	await expect(page).toHaveURL(/\/compare\?/)
	expect(
		await page.evaluate(() => window.__orbitalia !== undefined),
		"the solar system is still on screen",
	).toBe(true)
	// the scene writes its changes into the address (the clock does, every few seconds)
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setTimeWarp(60),
	)
	release()
	await expect(slots(page)).toHaveCount(2)
	await expect(page).toHaveURL(/\/compare\?bodies=saturn%2Cearth/)
})

test("Earth beside the Sun: too small to see, circled, and the numbers that land", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 720 })
	await page.goto("/compare?bodies=earth,sun&lang=en&reading=standard")
	await expect(slots(page)).toHaveCount(2)
	// drawn in the order of the system: the Sun first
	await expect(slots(page).first()).toHaveAttribute("data-body", "sun")
	const radii = await drawnRadii(page)
	expect(radii.sun / radii.earth).toBeCloseTo(695_508 / 6371.0084, 3)
	// a few pixels across: circled, and the caption says why
	await expect(page.locator("[data-body=earth]")).toHaveAttribute(
		"data-tiny",
		"true",
	)
	await expect(page.getByTestId("compare-tiny")).toContainText(
		"Earth is so small at this scale that it is circled.",
	)

	const facts = page.getByTestId("compare-facts")
	await expect(facts.locator("[data-fact=size]")).toContainText(
		"The Sun is 109 times as wide as Earth.",
	)
	await expect(facts.locator("[data-fact=volume]")).toContainText(
		"About 1.3 million Earths would fit inside the Sun.",
	)
	await expect(facts.locator("[data-fact=weight]")).toContainText(
		"On the Sun you would weigh 28 times as much as on Earth.",
	)
	await expect(facts.locator("[data-fact=distance]")).toContainText(
		"Distance right now",
	)
	await expect(facts.locator("[data-fact=distance]")).toContainText(
		"Light needs 8.",
	)
	await expect(page.getByTestId("compare-scale")).toContainText(
		"One scale for all: 1 pixel =",
	)
})

test("bodies are picked, swapped, added from ideas and promoted by a click", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	await page.goto("/compare?bodies=earth,jupiter&lang=en&reading=standard")
	const heading = page.getByTestId("compare-facts").getByRole("heading", {
		level: 2,
	})
	await expect(heading).toHaveText("Earth and Jupiter")

	// pick the second body from the list
	const second = page.getByRole("combobox", { name: "Compared with" })
	await second.click()
	// narrowed so the option is in view without scrolling the long list
	await second.fill("Mars")
	await page.getByRole("option", { name: "Mars", exact: true }).click()
	await expect(heading).toHaveText("Earth and Mars")
	await expect(page).toHaveURL(/bodies=earth%2Cmars|bodies=earth,mars/)

	await page.getByRole("button", { name: "Swap the two" }).click()
	await expect(heading).toHaveText("Mars and Earth")

	// a ready-made idea for the lesson
	await page.getByTestId("compare-presets").click()
	await menuAtRest(page)
	await page.getByRole("menuitem", { name: "All eight planets" }).click()
	await expect(slots(page)).toHaveCount(8)
	await expect(heading).toHaveText("Earth and Jupiter")
	await expect(
		page.getByText("Click another body to compare it instead."),
	).toBeVisible()

	// a click on a drawn body makes it the second of the pair
	await page
		.getByTestId("compare-stage")
		.getByRole("button", { name: "Compare with Saturn" })
		.click()
	await expect(heading).toHaveText("Earth and Saturn")
	await expect(
		page.locator("[data-body=saturn][data-role=second]"),
	).toBeVisible()

	// and a chip removes one
	await page.getByRole("button", { name: "Remove Neptune" }).click()
	await expect(slots(page)).toHaveCount(7)
})

test("speaks German at the simple reading level", async ({ page }) => {
	await page.goto("/compare?bodies=earth,jupiter&lang=de&reading=simple")
	const facts = page.getByTestId("compare-facts")
	await expect(facts.getByRole("heading", { level: 2 })).toHaveText(
		"Erde und Jupiter",
	)
	await expect(facts.locator("[data-fact=weight]")).toContainText(
		"Wer auf der Erde 30 kg wiegt, würde auf dem Jupiter 76 kg wiegen.",
	)
	await expect(facts.locator("[data-fact=size]")).toContainText("Wie groß")
	await expect(
		page.getByRole("button", { name: "Zurück zum Sonnensystem" }),
	).toBeVisible()
})

test("fits a phone: the drawing and the facts, no sideways page scroll", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto("/compare?bodies=earth,mars&lang=en&reading=simple")
	await expect(slots(page)).toHaveCount(2)
	const stage = await page.getByTestId("compare-stage").boundingBox()
	expect(stage!.height).toBeGreaterThan(180)
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	)
	expect(overflow).toBeLessThanOrEqual(0)
	await expect(
		page.getByTestId("compare-facts").locator("[data-fact=size]"),
	).toBeVisible()
	// taller than the phone: the page scrolls down to its end
	const end = page.locator("[data-testid=compare-page] > *").last()
	await expect(end).not.toBeInViewport()
	await page.mouse.move(200, 400)
	for (let i = 0; i < 50; i++) await page.mouse.wheel(0, 2000)
	await expect(end).toBeInViewport()
})
