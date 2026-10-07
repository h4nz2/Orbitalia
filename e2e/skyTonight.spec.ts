/**
 * "What is in the sky tonight" (issue #36): the panel asks where you are
 * before it says anything (a suggestion from the time zone, a country and
 * city list, the device location only after an explanation and a second
 * tap), then lists tonight's Moon and planets with local times and
 * directions, says which are hidden and why, and shows the geometry in 3D.
 *
 * The wall clock is fixed to the afternoon of 25 September 2026 (a full moon,
 * Saturn and Neptune at opposition, Venus low in the evening twilight) and the
 * browser to Zurich's time zone, so the sky is known.
 */
import { expect, test, type Page } from "@playwright/test"
import { openTool } from "./support/hud"

// every test drives the software-rendered scene and opens a lazy panel: slow under a full parallel run
test.describe.configure({ timeout: 120_000 })
test.use({ timezoneId: "Europe/Zurich", locale: "en-GB" })

const NOW = new Date("2026-09-25T12:00:00Z")

/**
 * Sets the date the panel reads (the clock runs on from there, so the page
 * animates) and replaces the browser's geolocation with
 * a fake that counts its calls and answers as told (`window.__geo`).
 *
 * Only `Date` is shifted. Playwright's `page.clock` would also replace
 * `requestAnimationFrame` with timers, so the WebGL scene draws on a timer
 * instead of with the display, as often as the machine lets it: under a full
 * parallel run the page then took 10-25 s per action and timed out.
 */
async function setup(page: Page, answer: "grant" | "deny" = "grant") {
	await page.addInitScript((nowMs) => {
		const RealDate = Date
		const offset = nowMs - RealDate.now()
		class ShiftedDate extends RealDate {
			constructor(...args: unknown[]) {
				if (args.length === 0) super(RealDate.now() + offset)
				else super(...(args as [string | number | Date]))
			}
			static now() {
				return RealDate.now() + offset
			}
		}
		window.Date = ShiftedDate as DateConstructor
	}, NOW.getTime())
	await page.addInitScript((answer) => {
		const geo = { calls: 0 }
		Object.assign(window, { __geo: geo })
		Object.defineProperty(navigator, "geolocation", {
			value: {
				getCurrentPosition: (
					ok: (position: unknown) => void,
					fail: (error: unknown) => void,
				) => {
					geo.calls += 1
					if (answer === "grant")
						ok({ coords: { latitude: 47.3769, longitude: 8.5417 } })
					else fail({ code: 1, PERMISSION_DENIED: 1 })
				},
			},
		})
	}, answer)
}

const geoCalls = (page: Page) =>
	page.evaluate(
		() => (window as unknown as { __geo: { calls: number } }).__geo.calls,
	)

const panel = (page: Page, name = "What's in the sky tonight") =>
	page.getByRole("region", { name })

test("asks first, then lists tonight's sky over Zurich with local times", async ({
	page,
}) => {
	await setup(page)
	await page.goto("/solar_system?lang=en")
	await openTool(page, "sky")
	const sky = panel(page)
	await expect(sky).toBeVisible({ timeout: 15_000 })

	// nothing is assumed: a question, a suggestion from the time zone, no location request
	await expect(sky).toContainText("Where will you look from?")
	await expect(sky).toContainText("Are you near Zurich, Switzerland?")
	await expect(sky.getByTestId("sky-visible")).toHaveCount(0)
	expect(await geoCalls(page)).toBe(0)

	await sky.getByRole("button", { name: "Yes, show me the sky there" }).click()
	await expect(sky.getByTestId("sky-place")).toHaveText("Zurich, Switzerland")
	await expect(sky).toContainText("Tonight in Zurich")
	// sunset 19:18 CEST, to five minutes, in the place's time zone
	await expect(sky.getByTestId("sky-sun")).toContainText("Sunset 19:20")

	// the full moon, up all evening
	const moon = sky.locator('[data-sky-body="moon"]')
	await expect(moon).toHaveAttribute("data-phase", "full")
	await expect(moon).toContainText("Full moon")

	// Saturn at opposition: naked eye, rising in the east after dusk
	const saturn = sky
		.getByTestId("sky-visible")
		.locator('[data-sky-body="saturn"]')
	await expect(saturn).toContainText("Eyes only")
	await expect(saturn).toContainText(/From about 20:\d\d until dawn/)
	await expect(saturn).toContainText("low in the east")
	// Neptune: honest about the telescope
	await expect(
		sky.getByTestId("sky-visible").locator('[data-sky-body="neptune"]'),
	).toContainText("Telescope")
	// Venus: hidden in the evening twilight, and why
	await expect(
		sky.getByTestId("sky-hidden").locator('[data-sky-body="venus"]'),
	).toContainText("Venus sets soon after the Sun")

	// the place never reaches the URL or storage
	expect(page.url()).not.toContain("zurich")
	const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }))
	expect(stored.toLowerCase()).not.toContain("zurich")
	expect(await geoCalls(page)).toBe(0)
})

test("a German child picks a country and a city from lists", async ({
	page,
}) => {
	await setup(page)
	await page.goto("/solar_system?lang=de&reading=simple")
	await openTool(page, "sky")
	const sky = panel(page, "Der Himmel heute Nacht")
	await expect(sky).toContainText("Wo bist du?", { timeout: 15_000 })

	await sky.getByRole("combobox", { name: "Land" }).click()
	await sky.getByRole("option", { name: "Australien" }).click()
	await sky.getByRole("combobox", { name: "Stadt" }).click()
	await sky.getByRole("option", { name: "Sydney" }).click()
	await sky.getByRole("button", { name: "Zeig es mir" }).click()

	await expect(sky.getByTestId("sky-place")).toHaveText("Sydney, Australien")
	await expect(sky).toContainText("Die Zeiten sind Ortszeit dort.")
	// from Sydney, evening Venus stands high enough: low in the west after sunset
	const venus = sky
		.getByTestId("sky-visible")
		.locator('[data-sky-body="venus"]')
	await expect(venus).toContainText("Westen")
	await expect(venus).toContainText("Nur mit den Augen")
})

test("the device location is asked for only after an explanation and a second tap", async ({
	page,
}) => {
	await setup(page, "grant")
	await page.goto("/solar_system?lang=en&sky=true")
	const sky = panel(page)
	await expect(sky).toBeVisible({ timeout: 15_000 })

	await sky.getByRole("button", { name: "Use my device's location" }).click()
	await expect(sky).toContainText("it is rounded to about 10 km, never saved")
	expect(await geoCalls(page)).toBe(0)

	await sky.getByRole("button", { name: "OK, ask my browser" }).click()
	await expect(sky.getByTestId("sky-place")).toHaveText(
		"Your location, near Zurich",
	)
	expect(await geoCalls(page)).toBe(1)
	await expect(sky.locator('[data-sky-body="saturn"]')).toContainText(
		"Eyes only",
	)

	// change place: back to the question, the location forgotten
	await sky.getByRole("button", { name: "Change place" }).click()
	await expect(sky).toContainText("Where will you look from?")
})

test("a refused location leaves the city list", async ({ page }) => {
	await setup(page, "deny")
	await page.goto("/solar_system?lang=en&sky=true")
	const sky = panel(page)
	await sky.getByRole("button", { name: "Use my device's location" }).click()
	await sky.getByRole("button", { name: "OK, ask my browser" }).click()
	await expect(sky.getByRole("status")).toHaveText(
		"No location shared. No problem: choose a city instead.",
	)
	await expect(sky.getByRole("combobox", { name: "City" })).toBeVisible()
})

test("'Why can I see it?' holds Earth still at that moment, seen from above", async ({
	page,
}) => {
	await setup(page)
	await page.goto("/solar_system?lang=en&sky=true")
	const sky = panel(page)
	await sky.getByRole("button", { name: "Yes, show me the sky there" }).click()

	const saturn = sky
		.getByTestId("sky-visible")
		.locator('[data-sky-body="saturn"]')
	await saturn.getByRole("button", { name: "Why can I see it?" }).click()
	await expect(saturn).toContainText(
		"Tonight Earth is between the Sun and Saturn",
	)
	await saturn.getByRole("button", { name: "Show me in space" }).click()
	// the panel steps aside for the 3D view
	await expect(sky).toHaveCount(0)

	await expect(page).toHaveURL(/frame=earth/, { timeout: 20_000 })
	await expect(page).toHaveURL(/sel=saturn/)
	await expect(
		page.getByRole("button", { name: "Pause", pressed: true }),
	).toBeVisible()
	// the clock lands on the evening of 25 September (the moment to look), paused
	await expect(page.locator("time").first()).toHaveAttribute(
		"datetime",
		/^2026-09-25T(18|19)/,
		{ timeout: 20_000 },
	)
	await expect(
		page.getByRole("button", { name: "Back to Sun-centred" }),
	).toBeVisible()

	// and comes back with the place kept
	await openTool(page, "sky")
	await expect(sky.getByTestId("sky-place")).toHaveText("Zurich, Switzerland")
})

test("opens from a link and gives way to the birthday panel", async ({
	page,
}) => {
	await setup(page)
	await page.goto("/solar_system?sky=true&lang=en")
	await expect(panel(page)).toBeVisible({ timeout: 15_000 })
	await openTool(page, "birthday")
	await expect(panel(page)).toHaveCount(0)
	await expect(
		page.getByRole("region", { name: "Your birthday in space" }),
	).toBeVisible()
})
