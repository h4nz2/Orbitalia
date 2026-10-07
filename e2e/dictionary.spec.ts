/**
 * The dictionary's stories (#53): what each world is made of, how hot it gets
 * and its names, in sections the reader opens one at a time, with the open
 * section in the address so a teacher can link straight to it.
 */
import { expect, test } from "@playwright/test"

test("the story sections open one at a time and stay open from world to world", async ({
	page,
}) => {
	await page.goto("/solar_dictionary?entity=6&lang=en&reading=standard")
	const madeOf = page.getByRole("button", { name: "Made of" })
	const weather = page.getByRole("button", { name: "Weather" })
	const names = page.getByRole("button", { name: "Names" })
	await expect(madeOf).toHaveAttribute("aria-expanded", "false")
	await expect(page.getByRole("img", { name: "Inside Saturn" })).toHaveCount(0)

	await madeOf.click()
	await expect(page).toHaveURL(/[?&]section=madeOf(&|$)/)
	await expect(page.getByRole("img", { name: "Inside Saturn" })).toBeVisible()
	// the cut-away is drawn from the layer data: one wedge per layer
	await expect(page.locator("[data-layer]")).toHaveCount(3)
	await expect(
		page.getByText(/big enough bathtub it would float/),
	).toBeVisible()

	await weather.click()
	await expect(page).toHaveURL(/[?&]section=weather(&|$)/)
	await expect(madeOf).toHaveAttribute("aria-expanded", "false")
	// Saturn: no published core temperature, so its clouds and the air above them
	await expect(page.getByText("In the clouds", { exact: true })).toBeVisible()
	await expect(page.getByText("Higher up", { exact: true })).toBeVisible()

	await names.click()
	await expect(
		page.getByText("Jewel of the solar system", { exact: true }),
	).toBeVisible()
	await expect(
		page.getByText("Where the name comes from", { exact: true }),
	).toBeVisible()
	await expect(
		page.getByRole("link", { name: /nasa\.gov/ }).first(),
	).toBeVisible()

	// another world keeps the open section
	await page.getByRole("button", { name: "Show Mars" }).click()
	await expect(page).toHaveURL(/[?&]entity=4(&|$)/)
	await expect(page).toHaveURL(/[?&]section=names(&|$)/)
	await expect(page.getByText("The Red Planet", { exact: true })).toBeVisible()

	await names.click()
	await expect(names).toHaveAttribute("aria-expanded", "false")
	await expect(page).not.toHaveURL(/section=/)
})

test("temperatures follow the reading level: words, °C, kelvin", async ({
	page,
}) => {
	await page.goto(
		"/solar_dictionary?entity=1&section=weather&lang=en&reading=simple",
	)
	await expect(
		page.getByRole("button", { name: "Hot or cold?" }),
	).toHaveAttribute("aria-expanded", "true")
	const simple = page.getByRole("region", { name: "Hot or cold?" })
	await expect(
		simple.getByText("Hotter than an oven", { exact: true }),
	).toBeVisible()
	await expect(
		simple.getByText("Colder than anywhere on Earth", { exact: true }),
	).toBeVisible()
	// no degrees anywhere on the page, the sidebar's average included
	await expect(page.locator("body")).not.toContainText("°C")

	await page.goto(
		"/solar_dictionary?entity=1&section=weather&lang=en&reading=standard",
	)
	const standard = page.getByRole("region", { name: "Weather" })
	await expect(standard.getByText("430 °C", { exact: true })).toBeVisible()
	await expect(standard.getByText("-180 °C", { exact: true })).toBeVisible()
	await expect(standard).not.toContainText(" K")

	await page.goto(
		"/solar_dictionary?entity=1&section=weather&lang=en&reading=advanced",
	)
	await expect(
		page
			.getByRole("region", { name: "Temperatures" })
			.getByText("703 K (430 °C)", { exact: true }),
	).toBeVisible()
})

test("at the simple level each section leads with a picture", async ({
	page,
}) => {
	await page.goto(
		"/solar_dictionary?entity=3&section=madeOf&lang=en&reading=simple",
	)
	const panel = page.getByRole("region", { name: "What is inside?" })
	// the picture comes before the words
	const first = panel.locator("figure, svg, p").first()
	await expect(first).toHaveJSProperty("tagName", "FIGURE")
	await expect(panel.getByRole("img", { name: "Inside Earth" })).toBeVisible()

	await page.getByRole("button", { name: "Its names" }).click()
	const names = page.getByRole("region", { name: "Its names" })
	await expect(names.locator("svg").first()).toBeVisible()
	await expect(
		names.getByText("The Blue Marble", { exact: true }),
	).toBeVisible()
})

test("a language with its own name for the world tells its story", async ({
	page,
}) => {
	await page.goto("/solar_dictionary?entity=3&section=names&lang=de")
	await expect(page.getByText("Auf Deutsch")).toBeVisible()
	await expect(
		page.getByRole("region", { name: "Namen" }).getByText(/Erde/).first(),
	).toBeVisible()
	await page.goto("/solar_dictionary?entity=3&section=names&lang=cs")
	await expect(page.getByText("V češtině")).toBeVisible()
})

test.describe("on a phone", () => {
	test.use({ viewport: { width: 390, height: 844 } })

	test("the sections sit under the globe and open there", async ({ page }) => {
		await page.goto("/solar_dictionary?entity=4&lang=en")
		const madeOf = page.getByRole("button", { name: "Made of" })
		await expect(madeOf).toBeInViewport()
		await madeOf.click()
		const picture = page.getByRole("img", { name: "Inside Mars" })
		await expect(picture).toBeVisible()
		await expect(picture).toBeInViewport()
	})
})
