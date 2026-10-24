/**
 * The dictionary's stories (#53): what each world is made of, how hot it gets
 * and its names, in sections the reader opens one at a time, with the open
 * section in the address so a teacher can link straight to it.
 */
import { expect, test, type Page } from "@playwright/test"

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

	// one column that scrolls (#75): the globe, the facts, then the sections in the page's flow
	test("the sections follow the facts and open there", async ({ page }) => {
		await page.goto("/solar_dictionary?entity=4&lang=en")
		const madeOf = page.getByRole("button", { name: "Made of" })
		await expect(madeOf).toBeAttached()
		const [facts, section] = await Promise.all([
			page.locator("[data-fact-key]").last().boundingBox(),
			madeOf.boundingBox(),
		])
		expect(section!.y).toBeGreaterThanOrEqual(facts!.y + facts!.height)
		await madeOf.click()
		const picture = page.getByRole("img", { name: "Inside Mars" })
		await expect(picture).toBeVisible()
		await expect(picture).toBeInViewport()
	})
})

/** Where the page has scrolled to, and where its first fact and first section are on screen. */
const scrolled = (page: Page) =>
	page.evaluate(() => ({
		scroll: document.querySelector("[data-testid=dictionary-page]")!.scrollTop,
		fact: document.querySelector("[data-fact-key]")!.getBoundingClientRect()
			.top,
		section: document
			.querySelector("[data-testid=dictionary-section-madeOf]")!
			.getBoundingClientRect().top,
	}))

/** A finger moving `dy` px up the screen from (x, y), in small steps, as a real swipe does. */
async function swipeUp(page: Page, x: number, y: number, dy: number) {
	const cdp = await page.context().newCDPSession(page)
	const at = (yy: number) => [{ x, y: yy, id: 1 }]
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: at(y),
	})
	for (let i = 1; i <= 10; i++) {
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: at(y - (dy * i) / 10),
		})
		await page.waitForTimeout(16)
	}
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	})
	await cdp.detach()
}

// the page scrolls itself (#75): the body never does, so without a scroller of
// its own nothing moved, with a finger or a wheel; nothing here clicks, so no
// scrolling of Playwright's own can help it along
for (const viewport of [
	{ width: 390, height: 844 },
	{ width: 360, height: 640 },
	{ width: 844, height: 390 },
])
	test.describe(`on a phone, ${viewport.width}x${viewport.height}`, () => {
		test.use({ viewport, hasTouch: true, isMobile: true })

		test("the page scrolls with a finger and with a wheel", async ({
			page,
		}) => {
			await page.goto("/solar_dictionary?entity=4&lang=en")
			await expect(page.getByTestId("dictionary-section-madeOf")).toBeAttached()
			// the facts have slid in: the page holds still
			let last = ""
			await expect
				.poll(
					async () => {
						const now = JSON.stringify(await scrolled(page))
						const same = now === last
						last = now
						return same
					},
					{ intervals: [300] },
				)
				.toBe(true)
			const start = await scrolled(page)
			expect(start.scroll).toBe(0)
			expect(start.section).toBeGreaterThan(viewport.height)

			// a wheel over the facts
			const x = viewport.width / 2
			const y = viewport.height * 0.8
			await page.mouse.move(x, y)
			await page.mouse.wheel(0, 300)
			await expect.poll(async () => (await scrolled(page)).scroll).toBe(300)
			const wheeled = await scrolled(page)
			expect(start.fact - wheeled.fact).toBeCloseTo(300, 0)
			expect(start.section - wheeled.section).toBeCloseTo(300, 0)

			// a finger swiping up from low on the screen
			await swipeUp(page, x, y, viewport.height * 0.4)
			await expect
				.poll(async () => (await scrolled(page)).scroll)
				.toBeGreaterThan(wheeled.scroll + 50)
			const swiped = await scrolled(page)
			expect(wheeled.section - swiped.section).toBeCloseTo(
				swiped.scroll - wheeled.scroll,
				0,
			)
			// the body itself never moved
			expect(
				await page.evaluate(() => [window.scrollY, document.body.scrollTop]),
			).toEqual([0, 0])
		})
	})
