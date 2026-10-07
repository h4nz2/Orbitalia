/**
 * Languages and reading levels (issue #11): the locale lives in the URL, the
 * switcher changes it and is remembered, every page, number and date follows
 * it, and the page metadata tells the browser which language it is reading.
 */
import { expect, test } from "@playwright/test"
import { expandCard, openLayers, openTime } from "./support/hud"

test("the URL always states the language and reading level, and links keep them", async ({
	page,
}) => {
	test.slow()
	await page.goto("/solar_dictionary?reading=simple")
	// a missing language is written into the URL at once
	await expect(page).toHaveURL(/[?&]lang=en(&|$)/)
	await expect(page.locator("html")).toHaveAttribute("lang", "en")

	await page.goto("/solar_dictionary?lang=de&reading=simple")
	await page.getByRole("button", { name: "Zurück" }).click()
	await expect(page).toHaveURL(/\/solar_system\?/, { timeout: 20_000 })
	await expect(page).toHaveURL(/[?&]lang=de(&|$)/)
	await expect(page).toHaveURL(/[?&]reading=simple(&|$)/)
})

test("the solar system renders completely in German", async ({ page }) => {
	await page.goto("/solar_system?focus=jupiter&lang=de")
	const focus = page.getByRole("combobox", { name: "Himmelskörper im Fokus" })
	await expect(focus).toHaveValue("Jupiter")
	await openLayers(page)
	await expect(page.getByRole("switch", { name: "Umlaufbahnen" })).toBeVisible()
	await expect(page.getByRole("button", { name: "Pause" })).toBeVisible()
	await openTime(page)
	await expect(page.getByRole("radio", { name: "1 Tag/s" })).toHaveCount(1)
	await expandCard(page)
	await expect(page.getByText("Das Sonnenlicht braucht")).toBeVisible()
	await expect(page.getByText("Der Riese des Sonnensystems")).toBeVisible()
	// German date order and number format
	await expect(page.locator("time")).toHaveText(
		/^\d{1,2}\. \S+ \d{4}, \d{2}:\d{2} UTC$/,
	)
	await expect(
		page
			.getByRole("region", { name: "Himmelskörper im Fokus" })
			.getByText("139.822 km Durchmesser", { exact: true }),
	).toBeVisible()

	// the planet's name is translated in the picker, a provisional designation is not
	await focus.fill("Erde")
	await expect(page.getByRole("option", { name: /^Erde/ })).toBeVisible()
})

test("the switcher changes the language everywhere and is remembered", async ({
	page,
}) => {
	await page.goto("/solar_system?focus=earth")
	await expect(page.locator("html")).toHaveAttribute("lang", "en")
	await page
		.getByRole("button", { name: "Language and reading level (EN)" })
		.click()
	await page.getByRole("menuitem", { name: "Deutsch" }).click()

	await expect(page).toHaveURL(/[?&]lang=de(&|$)/)
	await expect(page).toHaveURL(/[?&]focus=earth(&|$)/)
	await expect(
		page.getByRole("combobox", { name: "Himmelskörper im Fokus" }),
	).toHaveValue("Erde")
	await expect(page.locator("html")).toHaveAttribute("lang", "de")
	await expect(page).toHaveTitle("Orbitalia – unser Sonnensystem")

	// the installed-app manifest follows too
	const manifest = await page
		.locator('link[rel="manifest"]')
		.getAttribute("href")
	expect(manifest).toMatch(/^data:application\/manifest\+json,/)
	const parsed = JSON.parse(
		decodeURIComponent(manifest!.replace(/^data:[^,]*,/, "")),
	) as { name: string; lang: string; start_url: string }
	expect(parsed.lang).toBe("de")
	expect(parsed.name).toBe("Orbitalia – Unser Sonnensystem")
	expect(parsed.start_url).toMatch(/[?&]lang=de/)

	// a fresh visit without ?lang= comes back in German
	await page.goto("/solar_dictionary")
	await expect(page).toHaveURL(/[?&]lang=de(&|$)/)
	await expect(page.getByText("Durchmesser", { exact: true })).toBeVisible()
})

test("the reading level changes the sentences, not the language", async ({
	page,
}) => {
	await page.goto("/solar_dictionary?entity=4&lang=en&reading=standard")
	await expect(
		page.getByText("You would weigh only 38% of your weight on Earth."),
	).toBeVisible()
	// °C at the standard level, no kelvin (#51)
	await expect(page.getByText("-63 °C", { exact: true })).toBeVisible()
	await page
		.getByRole("button", { name: "Language and reading level (EN)" })
		.click()
	await page.getByRole("menuitem", { name: /^Simple/ }).click()

	await expect(page).toHaveURL(/[?&]reading=simple(&|$)/)
	await expect(
		page.getByText(
			"If you weigh 30 kg on Earth, you would weigh only 11 kg there!",
		),
	).toBeVisible()
	// the simple level: Earth as the yardstick and temperatures in words (#51)
	await expect(
		page.getByText("So small that 2 of them would fit across Earth"),
	).toBeVisible()
	await expect(page.getByText("Colder than any freezer")).toBeVisible()
	await expect(page.getByText(/^Mars is called the red planet/)).toBeVisible()
})

test.describe("with a Swiss German browser", () => {
	test.use({ locale: "de-CH" })

	test("starts in German with Swiss number formatting", async ({ page }) => {
		await page.goto("/solar_system?focus=jupiter")
		await expect(page).toHaveURL(/[?&]lang=de(&|$)/)
		await expect(page.locator("html")).toHaveAttribute("lang", "de")
		await expandCard(page)
		const swissGroup = await page.evaluate(() =>
			new Intl.NumberFormat("de-CH").format(1000).charAt(1),
		)
		await expect(
			page
				.getByRole("region", { name: "Himmelskörper im Fokus" })
				.getByText(`139${swissGroup}822 km Durchmesser`, { exact: true }),
		).toBeVisible()
	})

	test("an explicit link still wins over the browser", async ({ page }) => {
		await page.goto("/solar_system?lang=en")
		await expect(
			page.getByRole("combobox", { name: "Focus body" }),
		).toBeVisible()
	})
})

test("unknown languages and levels fall back instead of breaking", async ({
	page,
}) => {
	await page.goto("/does-not-exist?lang=xx&reading=nope")
	await expect(
		page.getByRole("heading", { name: "Lost in space" }),
	).toBeVisible()
	await expect(page).toHaveURL(/\/does-not-exist\?/)
	await expect(page).toHaveURL(/[?&]lang=en(&|$)/)
	await expect(page).toHaveURL(/[?&]reading=standard(&|$)/)
})
