import { expect, test, type Page } from "@playwright/test"

import { expandCard } from "./support/hud"
import { cameraAtRest } from "./support/scene"

// The Sun's and the planets' textures in the real browser: every texture the
// page asks for exists, each card's last line says where the picture comes
// from (a real map, the Sun in ultraviolet, painted bands, Venus's clouds), and
// the help page credits every source with its licence.

test.describe.configure({ timeout: 180_000 })

/** Texture requests that failed so far. */
const watchBrokenTextures = (page: Page): string[] => {
	const broken: string[] = []
	page.on("response", (response) => {
		if (
			response.url().includes("/assets/textures/") &&
			response.status() >= 400
		)
			broken.push(`${response.status()} ${response.url()}`)
	})
	return broken
}

const focus = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	await cameraAtRest(page)
	// the note is the last line of the card's details (#42: the card opens on demand)
	await expandCard(page)
}

const note = (page: Page) => page.getByTestId("world-surface-note")

test("each world's card says where its picture comes from", async ({
	page,
}) => {
	const broken = watchBrokenTextures(page)

	await focus(page, "/solar_system?focus=earth")
	await expect(note(page)).toHaveAttribute("data-surface", "map")
	await expect(note(page)).toHaveText("Surface map: Blue Marble · NASA.")

	await focus(page, "/solar_system?focus=saturn")
	await expect(note(page)).toHaveAttribute("data-surface", "painted")
	await expect(note(page)).toContainText("painted after spacecraft photos")

	await focus(page, "/solar_system?focus=sun")
	await expect(note(page)).toContainText("SDO · NASA, in ultraviolet light")

	await focus(page, "/solar_system?focus=venus&lang=de")
	await expect(note(page)).toHaveAttribute("data-surface", "haze")
	await expect(note(page)).toContainText("Dichte Wolken verbergen den Boden")

	expect(broken).toEqual([])
})

test("the help page credits the planets' maps with their licences", async ({
	page,
}) => {
	await page.goto("/help?topic=credits")
	const blueMarble = page.locator("[data-credit=image-nasa-blue-marble]")
	await expect(blueMarble).toContainText("Blue Marble Next Generation")
	await expect(blueMarble).toContainText("public domain")
	await expect(
		page.locator("[data-credit=image-orbitalia-painted-bands]"),
	).toContainText("MIT")
	await expect(page.locator("[data-credits=maps]")).not.toContainText(
		"source unknown",
	)
})
