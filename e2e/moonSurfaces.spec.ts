import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest, nextFrames } from "./support/scene"
import { expandCard } from "./support/hud"

// Moon surfaces (#37) in the real browser: every moon has its own map, fetched
// only once it is near enough to show, and its card says where the surface
// comes from - a real map (and which part was never photographed), a painted
// surface, or Titan's haze.

test.describe.configure({ timeout: 180_000 })

/** Moon maps the page has requested so far. */
const watchMoonMaps = (page: Page): string[] => {
	const requested: string[] = []
	page.on("request", (request) => {
		const match = /\/assets\/textures\/\w+\/satellites\/(\w+)\.jpg/.exec(
			request.url(),
		)
		if (match !== null) requested.push(match[1])
	})
	return requested
}

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	await cameraAtRest(page)
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setPaused(true),
	)
	// the card starts small (#42): the surface note is in the unfolded part
	if (url.includes("focus=")) await expandCard(page)
}

const note = (page: Page) => page.getByTestId("surface-note")

test("the overview fetches no moon maps; a focused moon fetches its own", async ({
	page,
}) => {
	const requested = watchMoonMaps(page)
	await ready(page, "/solar_system?lang=en")
	await nextFrames(page, 5)
	expect(requested).toEqual([])

	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setFocus("callisto"),
	)
	await cameraAtRest(page)
	await expandCard(page)
	await expect.poll(() => requested).toContain("callisto")
	// its own map, not the Moon's
	expect(requested).not.toContain("moon")
	await expect(note(page)).toHaveAttribute("data-surface", "map")
	await expect(note(page)).toContainText("Surface map: Galileo, Voyager")
})

test("a Uranian moon's card says half of it was never photographed", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=miranda&lang=en")
	await expect(note(page)).toHaveAttribute("data-filled", "true")
	await expect(note(page)).toContainText("Voyager 2")
	await expect(note(page)).toContainText(
		"Part of Miranda has never been photographed",
	)
	await ready(page, "/solar_system?focus=miranda&lang=en&reading=simple")
	await expect(note(page)).toContainText("Nobody has ever seen all of Miranda")
})

test("a moon without a map says its surface is painted, Titan that it is haze", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=proteus&lang=en")
	await expect(note(page)).toHaveAttribute("data-surface", "painted")
	await expect(note(page)).toContainText("No spacecraft has mapped Proteus")

	await ready(page, "/solar_system?focus=titan&lang=de")
	await expect(note(page)).toHaveAttribute("data-surface", "haze")
	await expect(note(page)).toContainText("orangefarbenem Dunst")
})
