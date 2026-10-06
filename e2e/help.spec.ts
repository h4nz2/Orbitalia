import { readFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { nextFrames } from "./support/scene"

// The help page (#43): one click away from every screen, every feature with a
// "try it" link that opens the app with the feature ready. The last tests
// click every link, so an entry whose link rots fails here.

const helpData = JSON.parse(
	readFileSync(path.join("src", "data", "help.json"), "utf8"),
) as { entries: { id: string; group: string; try: string }[] }

// headless chromium noise that is not an app bug (as in smoke.spec.ts)
const ignoredConsoleErrors = [
	"WebGL",
	"GPU",
	"swiftshader",
	"GroupMarkerNotSet",
]

function collectErrors(page: Page): string[] {
	const errors: string[] = []
	page.on("console", (message) => {
		if (message.type() !== "error") return
		const text = message.text()
		if (ignoredConsoleErrors.some((needle) => text.includes(needle))) return
		errors.push(text)
	})
	page.on("pageerror", (error) => errors.push(error.message))
	return errors
}

const helpHeading = (page: Page) =>
	page.getByRole("heading", { level: 1, name: "Everything Orbitalia can do" })

test("the help page is one click away from every page, in the same place", async ({
	page,
}) => {
	test.slow()
	const errors = collectErrors(page)
	for (const path of [
		"/",
		"/solar_dictionary",
		"/solar_walk",
		"/compare?bodies=earth,sun",
		"/no-such-page",
		"/solar_system",
	]) {
		await page.goto(`${path}${path.includes("?") ? "&" : "?"}lang=en`)
		const button = page.getByTestId("help-button")
		await expect(button, path).toBeVisible()
		// top right, beside the language menu
		const box = (await button.boundingBox())!
		const viewport = page.viewportSize()!
		expect(box.x + box.width, path).toBeGreaterThan(viewport.width * 0.7)
		expect(box.y, path).toBeLessThan(80)
		await button.click()
		await expect(page).toHaveURL(/\/help\?/)
		await expect(helpHeading(page)).toBeVisible()
		expect(new URL(page.url()).searchParams.get("lang")).toBe("en")
	}
	// back returns to where the viewer came from
	await page.getByRole("button", { name: "Back" }).click()
	await expect(page).toHaveURL(/\/solar_system/)
	expect(errors).toEqual([])
})

test("entries are grouped, explained, searchable and scroll into view by topic", async ({
	page,
}) => {
	await page.goto("/help?lang=en&reading=standard")
	await expect(helpHeading(page)).toBeVisible()
	for (const group of [
		"Looking around",
		"Time",
		"Size and distance",
		"Light",
		"Comparing",
		"For teachers",
		"Games",
		"Controls and shortcuts",
		"Credits and sources",
	]) {
		await expect(
			page.getByRole("heading", { level: 2, name: group }),
		).toBeVisible()
	}
	await expect(page.locator("[data-entry]")).toHaveCount(
		helpData.entries.length,
	)
	const scale = page.locator("[data-entry=scale]")
	await expect(scale.getByRole("heading", { level: 3 })).toHaveText(
		"True scale and the scale presets",
	)
	await expect(scale).toContainText("Why")
	await expect(scale.getByRole("listitem")).not.toHaveCount(0)
	await expect(scale.getByRole("link", { name: /^Try it/ })).toBeVisible()
	// the controls table: mouse, touch and keyboard
	const controls = page.locator("#help-controls table")
	await expect(controls.getByRole("columnheader")).toHaveText([
		"To do this",
		"Mouse",
		"Touch",
		"Keyboard",
	])
	await expect(page.locator("[data-control=pause]")).toContainText("Space")
	// credits with licences
	await expect(page.locator("[data-credit=three]")).toContainText(
		"Licence: MIT licence",
	)

	// search: accents and case do not matter, the URL keeps the query
	const box = page.getByRole("searchbox", { name: "Search the help" })
	await box.fill("ECLIPSE")
	await expect(page.locator("[data-entry=eclipses]")).toBeVisible()
	await expect(page.locator("[data-entry=scale]")).toHaveCount(0)
	await expect(page.getByTestId("help-results")).toContainText("match")
	await expect(page).toHaveURL(/q=ECLIPSE/)
	await box.fill("xyzzy")
	await expect(page.locator("[data-entry]")).toHaveCount(0)
	await expect(page.getByTestId("help-results")).toContainText(
		"Nothing matches",
	)
	await page.getByRole("button", { name: "Clear the search" }).click()
	await expect(page.locator("[data-entry]")).toHaveCount(
		helpData.entries.length,
	)

	// ?topic= lands on an entry (for onboarding, #44)
	await page.goto("/help?lang=en&topic=lightFlash")
	const flash = page.locator("[data-entry=lightFlash]")
	await expect(flash).toBeInViewport()
	await expect(flash).toHaveAttribute("data-highlight", "true")
})

test("the page scrolls with the mouse wheel", async ({ page }) => {
	await page.goto("/help?lang=en&reading=standard")
	await expect(helpHeading(page)).toBeVisible()
	const lastCredit = page.locator("[data-credit]").last()
	await expect(lastCredit).not.toBeInViewport()
	await page.mouse.move(400, 400)
	for (let i = 0; i < 100; i++) await page.mouse.wheel(0, 2000)
	await expect(lastCredit).toBeInViewport()
})

test("every language and the simple reading level", async ({ page }) => {
	await page.goto("/help?lang=de&reading=simple")
	await expect(
		page.getByRole("heading", { level: 1, name: "Was kann ich hier machen?" }),
	).toBeVisible()
	for (const lang of ["cs", "es", "fr"]) {
		await page.goto(`/help?lang=${lang}`)
		await expect(page.locator("html")).toHaveAttribute("lang", lang)
		await expect(page.locator("[data-entry]")).toHaveCount(
			helpData.entries.length,
		)
	}
})

test("the shortcut list links to the help page", async ({ page }) => {
	test.slow()
	await page.goto("/solar_system?lang=en")
	await expect(page.getByRole("button", { name: "Pause" })).toBeVisible()
	await page.keyboard.press("?")
	await page
		.getByRole("link", { name: /Every feature and how to use it/ })
		.click()
	await expect(page.locator("#help-controls")).toBeInViewport()
})

test("a light link opens the panel with a flash on its way", async ({
	page,
}) => {
	test.slow()
	await page.goto("/solar_system?light=flash&lang=en")
	await expect(page.getByText("Light has been travelling for")).toBeVisible()
	// an instruction only: the address no longer sends a flash on reload
	await expect(page).not.toHaveURL(/light=/)
	await page.goto("/solar_system?light=delay&lang=en")
	await expect(page.getByText("Message from Earth to")).toBeVisible()
})

test("a spacecraft link selects the craft and shows its panel", async ({
	page,
}) => {
	test.slow()
	await page.goto("/solar_system?craft=voyager1&lang=en")
	await expect(
		page.getByRole("region", { name: "Selected spacecraft" }),
	).toContainText("Voyager 1", { timeout: 30_000 })
	await expect(page).not.toHaveURL(/craft=/)
})

// every "try it" link, clicked on the page, opens its page without errors;
// four tests so four browsers share the scenes
const CHUNKS = 4
for (let chunk = 0; chunk < CHUNKS; chunk += 1) {
	const entries = helpData.entries.filter(
		(_, index) => index % CHUNKS === chunk,
	)
	test(`try it links open without errors (${chunk + 1} of ${CHUNKS}: ${entries.map((entry) => entry.id).join(", ")})`, async ({
		page,
	}) => {
		test.setTimeout(60_000 + entries.length * 30_000)
		const errors = collectErrors(page)
		await page.goto("/help?lang=en&reading=standard")
		await expect(helpHeading(page)).toBeVisible()
		for (const entry of entries) {
			await page.locator(`[data-try=${entry.id}]`).click()
			const expected = new URL(entry.try, "http://x")
			await expect(page, entry.id).toHaveURL(
				(url) => url.pathname === expected.pathname,
			)
			// the page is up: every page but help has the help button
			await expect(page.getByTestId("help-button"), entry.id).toBeVisible()
			if (expected.pathname === "/solar_system") {
				await page.waitForFunction(() => window.__orbitalia !== undefined)
				await nextFrames(page, 3)
			}
			// the viewer's language came along
			expect(new URL(page.url()).searchParams.get("lang"), entry.id).toBe("en")
			expect(errors, entry.id).toEqual([])
			// and leaving it again is clean too
			await page.goBack()
			await expect(helpHeading(page)).toBeVisible()
			expect(errors, `leaving ${entry.id}`).toEqual([])
		}
	})
}
