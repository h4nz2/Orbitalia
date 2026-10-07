/**
 * Watch light crawl (issue #27): a flash sent from a body travels at the true
 * speed of light in simulation time, with a running clock and arrivals
 * announced as they happen; the signal delay from Earth for any body; the
 * exit ramp beyond the solar system; English and German.
 */
import { expect, test, type Page } from "@playwright/test"

import { nextFrames } from "./support/scene"
import { openTool, setSpeed, speedButton, speedName } from "./support/hud"

// every test clicks through the panel while swiftshader renders the scene at a few fps
test.describe.configure({ timeout: 60_000 })

const button = (page: Page, name: string | RegExp) =>
	page.getByRole("button", { name, exact: typeof name === "string" })

async function open(page: Page, search = ""): Promise<void> {
	await page.goto(`/solar_system?${search}`)
	await page.waitForLoadState("networkidle")
	await expect(page.locator("time")).toBeVisible()
}

const elapsed = async (page: Page): Promise<number> =>
	Number(
		await page
			.locator("[data-light-elapsed]")
			.getAttribute("data-light-elapsed"),
	)

test("a flash from the Sun runs in real time, counts, and announces each planet", async ({
	page,
}) => {
	// start fast: sending the flash must bring the clock back to real time
	await open(page, "warp=86400")
	await openTool(page, "light")
	const panel = page.locator("[data-light-panel]")
	await expect(panel).toBeVisible()
	await expect(
		panel.getByRole("combobox", { name: "Send light from" }),
	).toHaveValue("Sun")
	await panel.getByRole("button", { name: "Send a flash" }).click()

	await expect(button(page, "Play")).toHaveAttribute("aria-pressed", "true")
	await expect(speedButton(page)).toHaveAccessibleName(speedName("1x"))
	await expect(panel.locator("[data-light-clock=realTime]")).toBeVisible()
	// the running clock counts real seconds
	await expect.poll(() => elapsed(page), { timeout: 15_000 }).toBeGreaterThan(1)
	const arrivals = panel.locator("[data-body]")
	await expect(arrivals).toHaveCount(8)
	await expect(arrivals.first()).toHaveAttribute("data-body", "mercury")
	await expect(arrivals.first()).toHaveAttribute("data-reached", "false")
	await expect(arrivals.nth(2)).toContainText(/Earth\s*8 min \d+ s/)
	// the front carries the clock in the scene
	await expect(page.locator("[data-light-front-label]")).toHaveCSS(
		"visibility",
		"visible",
	)

	// fast-forward is a deliberate choice, and the true travel time still counts
	await setSpeed(page, "1 min/s")
	await expect(panel.locator("[data-light-clock=changed]")).toContainText(
		"Sped up to 1 min/s",
	)
	await expect(arrivals.first()).toHaveAttribute("data-reached", "true", {
		timeout: 20_000,
	})
	await expect(panel.locator("[aria-live]")).toHaveText(
		/^Reached Mercury after \d min( \d+ s)?\.$/,
	)
	expect(await elapsed(page)).toBeGreaterThan(150)
	await panel.getByRole("button", { name: "Back to real time" }).click()
	await expect(speedButton(page)).toHaveAccessibleName(speedName("1x"))

	// paused, the light stops; reversed, it shrinks back and un-arrives
	await button(page, "Pause").click()
	await expect(panel.locator("[data-light-clock=changed]")).toContainText(
		"paused",
	)
	// let the 10 Hz readout catch up with the last frame before the pause
	await nextFrames(page, 5)
	const paused = await elapsed(page)
	await nextFrames(page, 5)
	expect(await elapsed(page)).toBe(paused)
	await setSpeed(page, "1 min/s")
	await button(page, "Reverse").click()
	await expect(arrivals.first()).toHaveAttribute("data-reached", "false", {
		timeout: 20_000,
	})
	await expect.poll(() => elapsed(page)).toBeLessThan(paused)
})

test("the signal delay from Earth, for a picked or a selected body", async ({
	page,
}) => {
	await open(page)
	await openTool(page, "light")
	const panel = page.locator("[data-light-panel]")
	await panel.getByText("Signal delay", { exact: true }).click()
	const target = panel.getByRole("combobox", { name: "Message from Earth to" })
	await expect(target).toHaveValue("Mars")
	const oneWay = panel.locator("[data-light-delay]")
	const marsSeconds = Number(await oneWay.getAttribute("data-light-delay"))
	expect(marsSeconds / 60).toBeGreaterThan(3)
	expect(marsSeconds / 60).toBeLessThan(22.5)
	await expect(panel).toContainText("steering")
	await expect(panel).toContainText("rovers on Mars drive themselves")

	await target.click()
	await page.getByRole("option", { name: "Moon" }).click()
	await expect(oneWay).toHaveText(/^1\.\d s$/)
	await expect(panel).toContainText("Lunokhod")

	// selecting a body in the scene makes it the destination: any body, moons too
	await page.evaluate(() => window.__orbitalia!.store.getState().select("io"))
	await expect(target).toHaveValue("Io")
	await expect(oneWay).toHaveText(/\d+ min \d+ s/)

	// watching it: a flash from Earth reaches the Moon in 1.2 to 1.4 s, as its distance changes
	await panel
		.getByRole("button", { name: "Send a signal from Earth and watch" })
		.click()
	await expect(panel.locator("[data-body=moon]")).toHaveAttribute(
		"data-reached",
		"true",
		{ timeout: 15_000 },
	)
	await expect(panel.locator("[aria-live]")).toHaveText(
		/^Reached the Moon after 1\.\d s\.$/,
	)
})

test("beyond the solar system, and in German", async ({ page }) => {
	await open(page, "lang=de&reading=simple")
	await openTool(page, "light")
	const panel = page.locator("[data-light-panel]")
	await panel.getByText("Noch weiter", { exact: true }).click()
	await expect(panel.locator("[data-beyond=proximaCentauri]")).toContainText(
		"4 Jahre",
	)
	// no number above 100 at the simple level (#51)
	await expect(panel.locator("[data-beyond=galacticCentre]")).toContainText(
		"länger, als es die Pyramiden gibt",
	)
	await panel.getByText("Lichtblitz", { exact: true }).click()
	await panel.getByRole("button", { name: "Lichtblitz senden" }).click()
	await expect(panel).toContainText("So lange ist das Licht schon unterwegs")
	await expect(panel.locator("[data-body=earth]")).toContainText(
		/Erde\s*8 Minuten und \d+ Sekunden/,
	)
	await panel.getByRole("button", { name: "Schließen" }).click()
	// closed, the button keeps the running clock
	await expect(button(page, /Wie schnell ist Licht\?.*Sekunde/)).toBeVisible()
})
