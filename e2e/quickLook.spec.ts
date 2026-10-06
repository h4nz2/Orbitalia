/**
 * The quick look (#44): asked once after a first visit's opening, never over
 * a shared link or in presentation mode; yes shows five features working in
 * the scene, a step for teachers and the help page, and every way out ends
 * in a calm view; it can be replayed from the Help menu and a link.
 */
import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"

test.describe.configure({ timeout: 120_000 })

const firstVisit = { storageState: { cookies: [], origins: [] } }

const question = (page: Page) => page.getByTestId("quick-look-ask")
const card = (page: Page) => page.getByTestId("quick-look")
const html = (page: Page) => page.locator("html")
const canvas = (page: Page) => page.locator("canvas").first()

const asked = (page: Page) =>
	page.evaluate(() => localStorage.getItem("orbitalia.quickLookAsked"))

/** A first visit: the opening plays; Skip hands over at once. */
async function arriveAndSkip(page: Page, search = "") {
	await page.goto(`/solar_system${search}`)
	await page.getByTestId("intro-skip").click({ timeout: 60_000 })
}

test.describe("a first visit", () => {
	test.use(firstVisit)

	test("the question follows the opening; no is remembered, and a reload shows neither", async ({
		page,
	}) => {
		await arriveAndSkip(page, "?lang=en")
		await expect(question(page)).toBeVisible()
		await expect(question(page)).toContainText(
			"Want a quick look at what you can do here?",
		)
		expect(await asked(page)).toBe("1")
		await question(page)
			.getByRole("button", { name: "No, let me explore" })
			.click()
		await expect(question(page)).toHaveCount(0)
		await expect(card(page)).toHaveCount(0)

		await page.reload()
		await page.waitForFunction(() => window.__orbitalia !== undefined)
		await cameraAtRest(page)
		await expect(page.getByTestId("intro-skip")).toHaveCount(0)
		await expect(question(page)).toHaveCount(0)
	})

	test("yes shows five features working, a step for teachers and the help page, then a calm view", async ({
		page,
	}) => {
		await arriveAndSkip(page, "?lang=en")
		await question(page).getByRole("button", { name: "Yes, show me" }).click()
		await expect(card(page)).toBeVisible()
		await expect(page.getByTestId("quick-look-count")).toHaveText("1 of 7")
		// it moves on by itself; take it by hand here
		const auto = page.getByTestId("quick-look-auto")
		await expect(auto).toHaveAttribute("aria-pressed", "true")
		await auto.click()
		await expect(auto).toHaveAttribute("aria-pressed", "false")

		// 1: fly to a planet, the picker glows
		await expect(card(page)).toHaveAttribute("data-step", "fly")
		await expect(html(page)).toHaveAttribute("data-quick-look-spot", "picker")
		await expect
			.poll(() =>
				page.evaluate(() => window.__orbitalia!.store.getState().focusId),
			)
			.toBe("saturn")

		const next = card(page).getByRole("button", { name: "Next" })
		// 2: true scale, the Scale button glows
		await next.click()
		await expect(card(page)).toHaveAttribute("data-step", "trueScale")
		await expect(html(page)).toHaveAttribute("data-quick-look-spot", "scale")
		await expect(canvas(page)).toHaveAttribute(
			"data-scale-preset",
			"trueScale",
			{
				timeout: 15_000,
			},
		)
		// 3: time races
		await next.click()
		await expect(card(page)).toHaveAttribute("data-step", "time")
		await expect(page.getByTestId("time-menu")).toHaveAccessibleName(
			/1 month\/s$/,
		)
		// 4: the Sun beside Earth
		await next.click()
		await expect(card(page)).toHaveAttribute("data-step", "compare")
		await expect(page.getByTestId("quick-look-compare")).toBeVisible()
		await expect(html(page)).toHaveAttribute("data-quick-look-spot", "compare")
		// 5: a flash of light leaves the Sun
		await next.click()
		await expect(card(page)).toHaveAttribute("data-step", "light")
		await expect(page.locator("[data-light-front-label]")).toBeAttached()
		// 6: for teachers: where Present is, without switching it on
		await next.click()
		await expect(card(page)).toHaveAttribute("data-step", "teachers")
		await expect(html(page)).toHaveAttribute("data-quick-look-spot", "present")
		await expect(html(page)).not.toHaveAttribute("data-presenting", "")
		// 7: there is more: the help page
		await next.click()
		await expect(card(page)).toHaveAttribute("data-step", "more")
		await expect(page.getByTestId("quick-look-help")).toHaveAttribute(
			"href",
			/\/help/,
		)
		await card(page).getByRole("button", { name: "Finish" }).click()

		// a calm view: the overview, 1x, everything visible, no flash, no glow
		await expect(card(page)).toHaveCount(0)
		await expect(html(page)).not.toHaveAttribute("data-quick-look-spot", /.+/)
		await expect(page.locator("[data-light-front-label]")).toHaveCount(0)
		await expect(canvas(page)).toHaveAttribute(
			"data-scale-preset",
			"everythingVisible",
			{ timeout: 15_000 },
		)
		await expect(page.getByTestId("time-menu")).toHaveAccessibleName(/1x$/)
		await expect
			.poll(() =>
				page.evaluate(() => window.__orbitalia!.store.getState().view.kind),
			)
			.toBe("overview")
	})

	test("a shared link never asks", async ({ page }) => {
		await page.goto("/solar_system?focus=mars&lang=en")
		await page.waitForFunction(() => window.__orbitalia !== undefined)
		await cameraAtRest(page)
		await expect(page.getByTestId("intro-skip")).toHaveCount(0)
		await expect(question(page)).toHaveCount(0)
		expect(await asked(page)).toBeNull()
	})

	test("presentation mode never asks", async ({ page }) => {
		await page.goto("/solar_system?present=true&lang=en")
		await page.waitForFunction(() => window.__orbitalia !== undefined)
		await cameraAtRest(page)
		await expect(question(page)).toHaveCount(0)
		expect(await asked(page)).toBeNull()
	})

	test.describe("on a phone, in German", () => {
		test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

		test("the question and the card fit the screen", async ({ page }) => {
			await arriveAndSkip(page, "?lang=de&reading=simple")
			await expect(question(page)).toBeInViewport({ ratio: 1 })
			await expect(question(page)).toContainText("Willst du kurz sehen")
			await question(page)
				.getByRole("button", { name: "Ja, zeig es mir" })
				.click()
			await expect(card(page)).toBeInViewport({ ratio: 1 })
			await expect(card(page)).toContainText("Ein kurzer Blick")
			await card(page)
				.getByRole("button", { name: "Den Rest überspringen" })
				.click()
			await expect(card(page)).toHaveCount(0)
		})
	})
})

test("replayed from the Help menu, and left with Escape", async ({ page }) => {
	await page.goto("/solar_system?lang=en")
	await page.waitForFunction(() => window.__orbitalia !== undefined)
	await page.getByTestId("intro-menu").click()
	await page.getByTestId("quick-look-replay").click()
	await expect(card(page)).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(card(page)).toHaveCount(0)
	await expect(html(page)).not.toHaveAttribute("data-quick-look-spot", /.+/)
})

test("replayed from the help page's link, which is only an instruction", async ({
	page,
}) => {
	await page.goto("/solar_system?look=play&lang=en")
	await expect(card(page)).toBeVisible()
	await expect(page).not.toHaveURL(/look=/)
	// the arrow keys step it, like any tour
	await page.getByTestId("quick-look-auto").click()
	await page.keyboard.press("ArrowRight")
	await expect(page.getByTestId("quick-look-count")).toHaveText("2 of 7")
})
