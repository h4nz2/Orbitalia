import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"
import { openScale } from "./support/hud"

// The basketball solar system (#25): choose what the Sun is, walk the planets,
// see the shock at the end, take it out of the app on paper, and go back to
// the same model in 3D at true scale.

const screenshotDir = path.join("test-results", "solar-walk")

const collectErrors = (page: Page): string[] => {
	const errors: string[] = []
	page.on("pageerror", (error) => errors.push(error.message))
	page.on("console", (message) => {
		if (message.type() !== "error") return
		const text = message.text()
		if (
			["WebGL", "GPU", "swiftshader", "GroupMarkerNotSet"].some((n) =>
				text.includes(n),
			)
		)
			return
		errors.push(text)
	})
	return errors
}

/** Clicks a segment of a SegmentedControl by its visible label (the radio input itself is hidden). */
const pick = async (page: Page, group: string, label: string) => {
	await page
		.getByRole("radiogroup", { name: group })
		.getByText(label, { exact: true })
		.click()
}

const stop = (page: Page, id: string) => page.locator(`li[data-stop="${id}"]`)

test("the basketball walk: every planet as an everyday thing, the landmark and the shock", async ({
	page,
}) => {
	const errors = collectErrors(page)
	await page.setViewportSize({ width: 1280, height: 900 })
	await page.goto("/solar_walk")
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "If the Sun were a basketball…",
		}),
	).toBeVisible()
	await expect(
		page.getByText("…Earth would be a pinhead, 26 m away."),
	).toBeVisible()
	await expect(stop(page, "earth")).toContainText(
		"2.2 mm across – about the size of a pinhead",
	)
	await expect(stop(page, "earth")).toContainText("26 m from the Sun")
	await expect(stop(page, "earth")).toContainText(
		"Moon: 0.6 mm, about the size of a grain of sugar, 6.6 cm from the planet",
	)
	await expect(stop(page, "mercury")).toContainText("10 m from the Sun")
	await expect(stop(page, "neptune")).toContainText("776 m from the Sun")
	await expect(stop(page, "neptune")).toContainText("7.4 football pitches")
	// the pitch ends between Mars and Jupiter
	const items = page.locator("ol > li")
	const order = await items.evaluateAll((lis) =>
		lis.map(
			(li) => li.getAttribute("data-stop") ?? li.getAttribute("data-landmark"),
		),
	)
	expect(order.indexOf("pitch")).toBe(order.indexOf("jupiter") - 1)
	await expect(
		page.getByText(
			"The whole walk to Neptune: 776 m, about 12 minutes on foot.",
		),
	).toBeVisible()
	await expect(
		page.getByText(
			/nearest star after the Sun, Proxima Centauri, is 6,900 km away/,
		),
	).toBeVisible()

	mkdirSync(screenshotDir, { recursive: true })
	await page.screenshot({
		path: path.join(screenshotDir, "walk-basketball.png"),
		fullPage: false,
	})
	await stop(page, "jupiter").scrollIntoViewIfNeeded()
	await page.screenshot({ path: path.join(screenshotDir, "walk-jupiter.png") })
	await page
		.getByRole("heading", { name: "The nearest star" })
		.scrollIntoViewIfNeeded()
	await page.screenshot({ path: path.join(screenshotDir, "walk-star.png") })
	expect(errors).toEqual([])
})

test("choosing the Sun and the landmark recomputes the walk and goes into the link", async ({
	page,
}) => {
	await page.goto("/solar_walk")
	await pick(page, "The Sun is", "Orange")
	await expect(page).toHaveURL(/sun=orange/)
	await expect(
		page.getByRole("heading", { level: 1, name: "If the Sun were an orange…" }),
	).toBeVisible()
	// an orange's walk ends at Neptune, 259 m away: less than one lap of a track
	await expect(stop(page, "neptune")).toContainText("259 m from the Sun")
	await pick(page, "Compare with", "Running track (400 m a lap)")
	await expect(page).toHaveURL(/landmark=track/)
	await expect(page.locator("li[data-landmark]")).toHaveCount(0)
	await expect(stop(page, "neptune")).toContainText("0.6 laps of the track")

	await pick(page, "The Sun is", "Exercise ball")
	await expect(stop(page, "earth")).toContainText("108 m from the Sun")
	await expect(stop(page, "earth")).toContainText("about the size of a pea")
	await expect(page.locator('li[data-landmark="track"]')).toHaveCount(1)

	await pick(page, "Compare with", "Metres only")
	await expect(page).toHaveURL(/landmark=none/)
	await expect(stop(page, "earth")).not.toContainText("lap")

	// a link or a reload opens the same walk
	await page.reload()
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "If the Sun were an exercise ball…",
		}),
	).toBeVisible()
	await expect(stop(page, "earth")).not.toContainText("lap")

	// the default leaves the URL
	await pick(page, "The Sun is", "Basketball")
	await expect(page).not.toHaveURL(/sun=/)
})

test("the table projects and prints as the hand-out", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 })
	await page.goto("/solar_walk")
	await pick(page, "Show as", "Table")
	await expect(page).toHaveURL(/view=table/)
	const table = page.getByRole("table")
	await expect(table).toBeVisible()
	await expect(page.locator("ol").first()).toBeHidden()
	const earthRow = table.locator('tr[data-row="earth"]')
	await expect(earthRow).toContainText("Earth")
	await expect(earthRow).toContainText("2.2 mm")
	await expect(earthRow).toContainText("a pinhead")
	await expect(earthRow).toContainText("26 m")
	await expect(table.locator('tr[data-row="nearestStar"]')).toContainText(
		"6,900 km",
	)
	mkdirSync(screenshotDir, { recursive: true })
	await page.screenshot({
		path: path.join(screenshotDir, "table.png"),
		fullPage: true,
	})

	// on paper: the table, whichever view is on screen; no controls
	await pick(page, "Show as", "Walk")
	await page.emulateMedia({ media: "print" })
	await expect(table).toBeVisible()
	await expect(page.locator("ol").first()).toBeHidden()
	await expect(
		page.getByRole("radiogroup", { name: "The Sun is" }),
	).toBeHidden()
	await expect(
		page.getByText("The circles are printed at their size in the model."),
	).toBeVisible()
	await page.screenshot({
		path: path.join(screenshotDir, "print.png"),
		fullPage: true,
	})
	await page.pdf({
		path: path.join(screenshotDir, "handout.pdf"),
		format: "A4",
	})
})

test("German, simple reading level", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto("/solar_walk?lang=de&reading=simple")
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "Wenn die Sonne ein Basketball wäre …",
		}),
	).toBeVisible()
	await expect(stop(page, "earth")).toContainText(
		"Etwa so groß wie ein Stecknadelkopf",
	)
	await expect(stop(page, "earth")).toContainText("26 m von der Sonne")
	await expect(
		page.getByText(/Sogar ein Flugzeug bräuchte etwa 7,5 Stunden/),
	).toBeVisible()
	mkdirSync(screenshotDir, { recursive: true })
	await page.screenshot({
		path: path.join(screenshotDir, "de-simple-phone.png"),
	})
	await page.locator('li[data-landmark="pitch"]').scrollIntoViewIfNeeded()
	await page.screenshot({
		path: path.join(screenshotDir, "de-simple-phone-pitch.png"),
	})
})

test("true scale in 3D and the walk lead to each other", async ({ page }) => {
	test.slow()
	await page.goto("/solar_system?scale=trueScale")
	// the walk's card is in the Scale panel (#42, #48)
	await openScale(page)
	const link = page.getByRole("link", {
		name: /Shrink the Sun to a basketball/,
	})
	await expect(link).toBeVisible()
	await link.click()
	await expect(page).toHaveURL(/\/solar_walk/)
	await page
		.getByRole("link", { name: "See Earth in 3D at true scale" })
		.click()
	await expect(page).toHaveURL(/\/solar_system\?.*focus=earth/)
	await expect(page).toHaveURL(/scale=trueScale/)
	await expect(page.locator("canvas").first()).toHaveAttribute(
		"data-scale-preset",
		"trueScale",
	)
})
