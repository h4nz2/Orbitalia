import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { openLayers, openScale } from "./support/hud"

// True scale and the scale presets (#21): one click to true scale, an animated
// switch, the honesty statement, the two separate lies, and the URL.

const screenshotDir = path.join("test-results", "scale-presets")

const ignoredConsoleErrors = [
	"WebGL",
	"GPU",
	"swiftshader",
	"GroupMarkerNotSet",
]

const collectErrors = (page: Page): string[] => {
	const errors: string[] = []
	page.on("pageerror", (error) => errors.push(error.message))
	page.on("console", (message) => {
		if (message.type() !== "error") return
		const text = message.text()
		if (ignoredConsoleErrors.some((needle) => text.includes(needle))) return
		errors.push(text)
	})
	return errors
}

const scalePanel = (page: Page) =>
	page.getByRole("region", { name: "Scale", exact: true })

/** Clicks a segment of a SegmentedControl by its visible label (the radio input itself is hidden). */
const pick = async (page: Page, group: string, label: string) => {
	await scalePanel(page)
		.getByRole("radiogroup", { name: group })
		.getByText(label, { exact: true })
		.click()
}

test("true scale is one click away, animates there and states that nothing is exaggerated", async ({
	page,
}) => {
	test.slow()
	const errors = collectErrors(page)
	await page.goto("/solar_system?t=2461308")
	await page.waitForLoadState("networkidle")
	await openScale(page)
	const canvas = page.locator("canvas").first()
	const panel = scalePanel(page)
	await expect(canvas).toHaveAttribute("data-scale-preset", "everythingVisible")
	// the default is labelled as the lie it is
	await expect(panel).toContainText("Not to scale!")
	await expect(panel).toContainText("Earth is drawn 10× too big.")
	await expect(panel).toContainText("Earth is drawn 13× too close to the Sun.")

	// every value the canvas passes through on the way
	await canvas.evaluate((element) => {
		const seen: string[] = []
		;(window as unknown as { scaleSeen: string[] }).scaleSeen = seen
		new MutationObserver(() =>
			seen.push(element.getAttribute("data-scale-preset") ?? ""),
		).observe(element, { attributeFilter: ["data-scale-preset"] })
	})
	await pick(page, "Scale preset", "True scale")
	// the choice is stated and linked at once, while the picture is still on its way
	await expect(panel).toContainText("Earth is drawn at its real size.")
	await expect(page).toHaveURL(/scale=trueScale/)
	// ... and lands on true scale
	await expect(canvas).toHaveAttribute("data-scale-preset", "trueScale", {
		timeout: 10_000,
	})
	// it was an animation, not a jump: the scale passed through in-between mixes
	expect(
		await page.evaluate(
			() => (window as unknown as { scaleSeen: string[] }).scaleSeen,
		),
	).toContain("custom")
	await expect(panel).toContainText(
		"Earth is drawn at its real distance from the Sun.",
	)
	// the aid: the dots are what finds the planets now
	await expect(panel).toContainText("The dots only mark where the planets are")
	await page.waitForTimeout(500)
	mkdirSync(screenshotDir, { recursive: true })
	await page.screenshot({ path: path.join(screenshotDir, "true-scale.png") })

	// a reload (or a shared link) opens straight in true scale, without animating
	await page.reload()
	await page.waitForLoadState("networkidle")
	await openScale(page)
	await expect(canvas).toHaveAttribute("data-scale-preset", "trueScale")
	await expect(
		panel.getByRole("radio", { name: "True scale", exact: true }),
	).toBeChecked()

	// and back again: the default is not written into the link
	await pick(page, "Scale preset", "Everything visible")
	await expect(page).not.toHaveURL(/scale=/)
	await expect(canvas).toHaveAttribute(
		"data-scale-preset",
		"everythingVisible",
		{
			timeout: 10_000,
		},
	)
	expect(errors).toEqual([])
})

test("sizes and distances are separate lies, each switchable on its own", async ({
	page,
}) => {
	const errors = collectErrors(page)
	await page.goto("/solar_system?t=2461308&focus=jupiter")
	await page.waitForLoadState("networkidle")
	await openScale(page)
	const canvas = page.locator("canvas").first()
	const panel = scalePanel(page)
	const preset = (name: string) =>
		panel.getByRole("radio", { name, exact: true })

	// real sizes, squeezed distances: the textbook picture
	await pick(page, "Sizes", "Real")
	await expect(preset("Textbook")).toBeChecked()
	await expect(panel).toContainText("Jupiter is drawn at its real size.")
	await expect(panel).toContainText(
		"Jupiter is drawn 192× too close to the Sun.",
	)
	await expect(canvas).toHaveAttribute("data-scale-preset", "textbook", {
		timeout: 10_000,
	})

	// enlarged sizes at real distances: no named preset button, but a named state
	await pick(page, "Sizes", "Enlarged")
	await pick(page, "Distances", "Real")
	await expect(page).toHaveURL(/scale=bigPlanets/)
	await expect(panel).toContainText("Big planets:")
	await expect(panel).toContainText("Jupiter is drawn 3.2× too big.")
	await expect(panel).toContainText(
		"Jupiter is drawn at its real distance from the Sun.",
	)
	for (const name of ["True scale", "Textbook", "Everything visible"]) {
		await expect(preset(name)).not.toBeChecked()
	}
	await expect(canvas).toHaveAttribute("data-scale-preset", "bigPlanets", {
		timeout: 10_000,
	})
	expect(errors).toEqual([])
})

test("the statement reads at every level, in German too", async ({ page }) => {
	const errors = collectErrors(page)
	await page.goto(
		"/solar_system?t=2461308&lang=de&reading=simple&scale=textbook",
	)
	await page.waitForLoadState("networkidle")
	await openScale(page)
	const panel = page.getByRole("region", { name: "Maßstab", exact: true })
	await expect(panel).toContainText(
		"Die Erde ist hier so groß wie in Wirklichkeit.",
	)
	await expect(panel).toContainText(
		"Die Erde ist hier 73-mal näher an der Sonne als in Wirklichkeit!",
	)
	await expect(
		panel.getByRole("radio", { name: "Schulbuch", exact: true }),
	).toBeChecked()
	expect(errors).toEqual([])
})

test("Poster: every planet a disc, beside the Sizes and Distances switches, the small moons hidden (#54)", async ({
	page,
}) => {
	test.slow()
	const errors = collectErrors(page)
	await page.setViewportSize({ width: 1366, height: 768 })
	await page.goto("/solar_system?t=2461308&paused=true")
	await page.waitForLoadState("networkidle")
	await openScale(page)
	const canvas = page.locator("canvas").first()
	const panel = scalePanel(page)
	const radio = (name: string) =>
		panel.getByRole("radio", { name, exact: true })

	await pick(page, "Scale preset", "Poster")
	await expect(page).toHaveURL(/scale=poster/)
	await expect(panel).toContainText("Sizes 5 to 60× too big")
	await expect(panel).toContainText("Earth is drawn 29× too big.")
	await expect(panel).toContainText("Earth is drawn 60× too close to the Sun.")
	await expect(canvas).toHaveAttribute("data-scale-preset", "poster", {
		timeout: 10_000,
	})
	await expect(radio("Poster")).toBeChecked()
	// beside the grid: the switches name none of their four cells
	for (const group of ["Sizes", "Distances"]) {
		await expect(
			panel
				.getByRole("radiogroup", { name: group })
				.getByRole("radio", { checked: true }),
		).toHaveCount(0)
	}
	mkdirSync(screenshotDir, { recursive: true })
	await page.screenshot({ path: path.join(screenshotDir, "poster.png") })

	// the long tail has no room: All moons waits, and says why
	const layers = await openLayers(page)
	const allMoons = layers.getByRole("switch", { name: "All moons" })
	await expect(allMoons).toBeDisabled()
	await expect(allMoons).toHaveAccessibleDescription(
		/Choose another scale to see them\.$/,
	)

	// a switch leaves Poster for the cell it picks: real sizes, squeezed distances
	await openScale(page)
	await pick(page, "Sizes", "Real")
	await expect(radio("Textbook")).toBeChecked()
	await expect(page).toHaveURL(/scale=textbook/)
	await expect(
		(await openLayers(page)).getByRole("switch", { name: "All moons" }),
	).toBeEnabled()
	expect(errors).toEqual([])
})
