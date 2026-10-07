import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"
import { expandCard } from "./support/hud"

// Sound (#32), in the real browser: silent until asked, one click or M to turn
// it on and off, 'on' remembered for the tab only, the settings remembered,
// and real recordings on the bodies' cards with their honest explanation.

test.describe.configure({ timeout: 120_000 })

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(
		() =>
			window.__orbitalia !== undefined && window.__orbitaliaSound !== undefined,
		null,
		{ timeout: 30_000 },
	)
	await cameraAtRest(page)
}

const contextState = (page: Page) =>
	page.evaluate(() => window.__orbitaliaSound!.contextState())

const waitForContext = (page: Page, state: string) =>
	page.waitForFunction(
		(state) => window.__orbitaliaSound!.contextState() === state,
		state,
		{ timeout: 10_000 },
	)

test("silent until asked; one click or M switches it; 'on' lasts for the tab only", async ({
	page,
	context,
}) => {
	await ready(page, "/solar_system")
	const toggle = page.getByRole("button", { name: "Sound", exact: true })
	await expect(toggle).toHaveAttribute("aria-pressed", "false")
	// no audio at all before the viewer asks: not even a suspended context
	expect(await contextState(page)).toBe("none")

	await toggle.click()
	await expect(toggle).toHaveAttribute("aria-pressed", "true")
	await waitForContext(page, "running")

	// M mutes at once, and the audio thread stops
	await page.keyboard.press("m")
	await expect(toggle).toHaveAttribute("aria-pressed", "false")
	await waitForContext(page, "suspended")
	await page.keyboard.press("m")
	await expect(toggle).toHaveAttribute("aria-pressed", "true")
	await waitForContext(page, "running")

	// a reload keeps it on, but nothing plays before the first click
	await ready(page, "/solar_system")
	await expect(toggle).toHaveAttribute("aria-pressed", "true")
	expect(await contextState(page)).toBe("none")
	await page.getByRole("button", { name: "Sound settings" }).click()
	await waitForContext(page, "running")

	// a new tab (tomorrow's lesson) starts silent again
	const other = await context.newPage()
	await ready(other, "/solar_system")
	await expect(
		other.getByRole("button", { name: "Sound", exact: true }),
	).toHaveAttribute("aria-pressed", "false")
	expect(await contextState(other)).toBe("none")
})

test("the settings: volume, layers and the recordings, remembered without turning sound on", async ({
	page,
	context,
}) => {
	await ready(page, "/solar_system")
	await page.getByRole("button", { name: "Sound settings" }).click()
	const settings = page.getByTestId("sound-settings")
	await expect(settings.getByText(/Space is silent/)).toBeVisible()
	await expect(
		settings.getByRole("switch", { name: "Sound on" }),
	).not.toBeChecked()
	await expect(settings.getByRole("button", { name: /^Listen: / })).toHaveCount(
		4,
	)

	const hum = settings.getByRole("switch", { name: "Background hum" })
	await expect(hum).toBeChecked()
	await hum.click({ force: true })
	await expect(hum).not.toBeChecked()
	const volume = settings.getByRole("slider", { name: "Volume" })
	await expect(volume).toHaveAttribute("aria-valuenow", "50")
	await volume.focus()
	await page.keyboard.press("ArrowRight")
	await expect(volume).toHaveAttribute("aria-valuenow", "55")
	// choosing a volume never switches sound on
	await expect(
		page.getByRole("button", { name: "Sound", exact: true }),
	).toHaveAttribute("aria-pressed", "false")
	expect(await contextState(page)).toBe("none")

	const other = await context.newPage()
	await ready(other, "/solar_system?lang=de")
	await other.getByRole("button", { name: "Toneinstellungen" }).click()
	const einstellungen = other.getByTestId("sound-settings")
	await expect(
		einstellungen.getByRole("switch", { name: "Hintergrundklang" }),
	).not.toBeChecked()
	await expect(
		einstellungen.getByRole("slider", { name: "Lautstärke" }),
	).toHaveAttribute("aria-valuenow", "55")
	await expect(einstellungen.getByText(/Im All ist es still/)).toBeVisible()
})

test("Jupiter's card carries a real recording with its honest explanation", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=jupiter")
	await expandCard(page)
	const card = page.getByTestId("body-card")
	const recording = card.getByTestId("body-recording")
	// the words are there with sound off: nothing depends on hearing it
	await expect(
		recording.getByText(/^Not sound: radio waves from lightning/),
	).toBeVisible()
	await expect(
		recording.getByText(/Voyager 1, 1979 · NASA \/ University of Iowa/),
	).toBeVisible()
	await expect(
		recording.getByRole("link", { name: "CC BY 4.0" }),
	).toHaveAttribute("href", /space-audio\.org/)

	const fetched = page.waitForResponse(/jupiter-whistlers\.mp3/)
	await recording
		.getByRole("button", { name: "Listen: Lightning on Jupiter" })
		.click()
	expect((await fetched).status()).toBeLessThan(400)
	// listening is asking for sound: the speaker turns on with it
	await expect(
		page.getByRole("button", { name: "Sound", exact: true }),
	).toHaveAttribute("aria-pressed", "true")
	await waitForContext(page, "running")
	const stop = recording.getByRole("button", {
		name: "Stop: Lightning on Jupiter",
	})
	await expect(stop).toHaveAttribute("aria-pressed", "true")
	await stop.click()
	await expect(
		recording.getByRole("button", { name: "Listen: Lightning on Jupiter" }),
	).toHaveAttribute("aria-pressed", "false")

	// Mars has none
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setFocus("mars"),
	)
	await expect(page.locator('[data-card-body="mars"]')).toBeVisible()
	await expect(page.getByTestId("body-recording")).toHaveCount(0)
})

test("the Sun's recording in German at the simple level", async ({ page }) => {
	await ready(page, "/solar_system?focus=sun&lang=de&reading=simple")
	await expandCard(page)
	const recording = page.getByTestId("body-recording")
	await expect(
		recording.getByRole("button", { name: "Anhören: Radioblitze der Sonne" }),
	).toBeVisible()
	// no years at the simple level (#51)
	await expect(
		recording.getByText(/^Einmal gab es auf der Sonne/),
	).toBeVisible()
})
