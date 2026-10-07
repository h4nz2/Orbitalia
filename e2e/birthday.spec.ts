/**
 * "Your birthday in space" (issue #26): reachable from Tools and from a link,
 * a birthday picked in the calendar (never typed), the planets
 * flown to that day, ages / days / weights on other worlds, the next birthday
 * on Mars as a trip, a picture saved on the device, and the birth date kept
 * out of the URL until it is forgotten.
 */
import { expect, test, type Page } from "@playwright/test"

import { openTool } from "./support/hud"

// the calendar and the glides run while swiftshader renders the scene at a few fps
test.describe.configure({ timeout: 60_000 })

const panel = (page: Page) =>
	page.getByRole("region", { name: "Your birthday in space" })

/** Picks 25 September 2014 in the birthday calendar (it opens on the decades). */
async function pickBirthday(page: Page): Promise<void> {
	const calendar = panel(page)
	// back from the decade it opens on (ten years ago) to the 2010s if needed
	const year = calendar.getByRole("button", { name: "2014", exact: true })
	for (let i = 0; i < 3 && !(await year.isVisible()); i++) {
		await calendar.getByRole("button", { name: "Previous decade" }).click()
	}
	await year.click()
	await calendar.getByRole("button", { name: "Sep", exact: true }).click()
	await calendar
		.getByRole("button", { name: "Thursday, September 25, 2014" })
		.click()
}

/** Whole calendar years between 2014-09-25 and the browser's today. */
const expectedEarthAge = (page: Page) =>
	page.evaluate(() => {
		const now = new Date()
		const had =
			now.getMonth() > 8 || (now.getMonth() === 8 && now.getDate() >= 25)
		return now.getFullYear() - 2014 - (had ? 0 : 1)
	})

test("from a link to the ages on every planet, without the date in the URL", async ({
	page,
}) => {
	await page.goto("/solar_system?birthday=true")
	await expect(panel(page)).toBeVisible({ timeout: 15_000 })
	await expect(panel(page)).toContainText("Nothing is saved or sent anywhere")

	await pickBirthday(page)

	// the planets fly to the birth date and stop there
	const clock = page.locator("time")
	await expect(clock).toHaveAttribute("datetime", "2014-09-25T12:00Z", {
		timeout: 20_000,
	})
	await expect(
		page.getByRole("button", { name: "Pause", pressed: true }),
	).toBeVisible()
	await expect(page.getByTestId("birthday-born")).toHaveText(
		"Born on Sep 25, 2014",
	)

	const age = await expectedEarthAge(page)
	await expect(panel(page).locator('[data-world="earth"]')).toContainText(
		`${age} years old`,
	)
	await expect(panel(page).locator('[data-world="mars"]')).toContainText(
		/\d+ years old/,
	)
	await expect(panel(page)).toContainText(/billion kilometres around the Sun/)

	// paused on the birth date, yet no `t` goes into the link
	await page.waitForTimeout(1500)
	expect(new URL(page.url()).searchParams.has("t")).toBe(false)

	// days and weights
	await panel(page).getByText("Days", { exact: true }).click()
	await expect(panel(page).locator('[data-world="earth"]')).toContainText(
		/days lived/,
	)
	await panel(page).getByText("Weight", { exact: true }).click()
	await expect(panel(page).locator('[data-world="mars"]')).toContainText(
		"15.1 kg",
	)
	await expect(panel(page).locator('[data-world="moon"]')).toContainText(
		"6.6 kg",
	)
	const slider = panel(page).getByRole("slider", { name: "Weight on Earth" })
	await slider.focus()
	await page.keyboard.press("ArrowRight")
	await expect(panel(page)).toContainText("41 kg on Earth")
	// the arrow key moved the slider, not the camera to a neighbouring planet
	await expect(page).not.toHaveURL(/[?&]focus=/)

	// forgetting brings the time back into the link
	await panel(page).getByRole("button", { name: "Forget my birthday" }).click()
	await expect(page).toHaveURL(/[?&]t=/)
	await expect(panel(page)).toContainText("Pick the day you were born")
})

test("travels to the next birthday on Mars and saves a picture", async ({
	page,
}) => {
	await page.goto("/solar_system")
	await page.waitForLoadState("networkidle")
	await openTool(page, "birthday")
	await expect(panel(page)).toBeVisible({ timeout: 15_000 })
	await pickBirthday(page)
	const clock = page.locator("time")
	await expect(clock).toHaveAttribute("datetime", "2014-09-25T12:00Z", {
		timeout: 20_000,
	})

	const mars = panel(page).locator('[data-world="mars"]')
	const next = await mars.getByText(/^(Next|First) birthday: /).textContent()
	await mars
		.getByRole("button", { name: "Travel to your next birthday on Mars" })
		.click()
	// the clock glides to that day (in the future) and stops there
	const day = new Date(`${next?.replace(/^(Next|First) birthday: /, "")} UTC`)
		.toISOString()
		.slice(0, 10)
	expect(Date.parse(day)).toBeGreaterThan(Date.now() - 86_400_000)
	await expect(clock).toHaveAttribute("datetime", new RegExp(`^${day}T`), {
		timeout: 20_000,
	})
	await expect(
		page.getByRole("button", { name: "Pause", pressed: true }),
	).toBeVisible()

	// the picture is the postcard of the view (#33), with the ages and without the birth date
	await panel(page).getByRole("button", { name: "Save as picture" }).click()
	const postcard = page.getByRole("dialog", {
		name: "Your postcard from space",
	})
	await expect(postcard).toContainText("your birthday stays private")
	await expect(postcard.getByTestId("postcard-image")).toBeVisible({
		timeout: 20_000,
	})
	const download = page.waitForEvent("download")
	await postcard.getByRole("button", { name: "Save picture" }).click()
	const file = await download
	expect(file.suggestedFilename()).toBe("my-age-on-the-planets.png")
	await postcard.getByRole("button", { name: "Close" }).click()
	await expect(postcard).toBeHidden()

	// closing keeps the birthday in memory for this visit
	await panel(page).getByRole("button", { name: "Close" }).click()
	await expect(panel(page)).toBeHidden()
	await openTool(page, "birthday")
	await expect(page.getByTestId("birthday-born")).toBeVisible()
})

test("speaks German, with the calendar in German", async ({ page }) => {
	await page.goto("/solar_system?lang=de&birthday=true")
	const region = page.getByRole("region", {
		name: "Dein Geburtstag im Weltall",
	})
	await expect(region).toBeVisible({ timeout: 15_000 })
	await expect(region).toContainText("Nichts wird gespeichert")
	const year = region.getByRole("button", { name: "2014", exact: true })
	for (let i = 0; i < 3 && !(await year.isVisible()); i++) {
		await region.getByRole("button", { name: "Vorheriges Jahrzehnt" }).click()
	}
	await year.click()
	// the calendar's labels come from Intl, so ask Intl for them
	const [month, day] = await page.evaluate(() => {
		const date = Date.UTC(2014, 8, 25)
		const format = (options: Intl.DateTimeFormatOptions) =>
			new Intl.DateTimeFormat("de", { ...options, timeZone: "UTC" }).format(
				date,
			)
		return [format({ month: "short" }), format({ dateStyle: "full" })]
	})
	await region.getByRole("button", { name: month, exact: true }).click()
	await region.getByRole("button", { name: day }).click()
	await expect(page.getByTestId("birthday-born")).toHaveText(
		"Geboren am 25.09.2014",
	)
	await expect(region.locator('[data-world="mars"]')).toContainText(
		/\d+ Jahre alt/,
	)
})
