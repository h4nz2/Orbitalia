import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"
import { openTool } from "./support/hud"
import { spoken, stubSpeech } from "./support/speech"

// The scavenger hunt (#34), in the real browser: pick a hunt, answer a clue by
// clicking the world in the scene (kind words on a miss, no penalty),
// escalating hints ending in "Show me", the share link, the finish, and the
// progress surviving a reload. For young explorers (#52): the difficulty as a
// real choice, and an Easy hunt played to the end with pictures, a voice
// (stubbed: headless Chromium has none), hints that show, stars and a
// certificate.

const screenshotDir = path.join("test-results", "hunt")

// software WebGL is slow and answers fly the camera to the body
test.describe.configure({ timeout: 180_000 })

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 30_000,
	})
	await cameraAtRest(page)
}

const panel = (page: Page) => page.locator("#hunt-panel")

const search = (page: Page) => new URL(page.url()).searchParams

/** A difficulty in the chooser's segmented control (a radio). */
const difficulty = (page: Page, name: string) =>
	page.getByTestId("hunt-difficulty").getByRole("radio", { name })

const chooseDifficulty = async (page: Page, name: string) => {
	// the radio itself is visually hidden behind its label
	await page
		.getByTestId("hunt-difficulty")
		.locator("label")
		.filter({ hasText: name })
		.click()
	await expect(difficulty(page, name)).toBeChecked()
}

/** Clicks a body where the scene draws it (it must not be under a HUD panel). */
const clickBody = async (page: Page, id: string) => {
	await cameraAtRest(page)
	const at = await page.evaluate((id) => window.__orbitalia!.screenOf(id), id)
	expect(at, `${id} on screen`).not.toBeNull()
	const onCanvas = await page.evaluate(
		([x, y]) => document.elementFromPoint(x, y)?.tagName,
		[at!.x, at!.y],
	)
	expect(onCanvas, `${id} is not under a panel`).toBe("CANVAS")
	await page.mouse.click(at!.x, at!.y)
}

test("pick a hunt, miss kindly, then answer by clicking the world", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	await ready(page, "/solar_system?hunt=true&lang=en&reading=standard")

	// the chooser: the standard reading level opens on Tricky (12+)
	await expect(panel(page)).toBeVisible()
	await expect(panel(page).getByText("Pick a hunt")).toBeVisible()
	await expect(difficulty(page, "Tricky")).toBeChecked()
	await expect(panel(page).locator("[data-hunt]")).toHaveCount(2)
	mkdirSync(screenshotDir, { recursive: true })
	await page.screenshot({ path: path.join(screenshotDir, "chooser.png") })
	await chooseDifficulty(page, "Medium")

	await panel(page).locator('[data-hunt="firstSteps"]').click()
	await expect.poll(() => search(page).get("hunt")).toBe("firstSteps")
	await expect(page.getByTestId("hunt-progress")).toHaveText("Clue 1 of 6")
	await expect(page.getByTestId("hunt-clue")).toHaveText(
		"Find the only world besides Earth where people have walked.",
	)

	// a miss is only kind words: the clue stays, nothing is counted
	await clickBody(page, "mars")
	await expect(panel(page)).toContainText("That is Mars. Not the one")
	await expect(page.getByTestId("hunt-progress")).toHaveText("Clue 1 of 6")

	// back to the overview; Earth is the Moon's planet: warm
	await page.keyboard.press("Escape")
	await clickBody(page, "earth")
	await expect(panel(page)).toContainText("Warm! The answer is close to Earth")

	// the answer, through the picker this time: every way of selecting counts
	const picker = page.getByRole("combobox", { name: "Focus body" })
	await picker.click()
	await picker.fill("Moon")
	await page.getByRole("option", { name: /^Moon/ }).click()
	await expect(panel(page).getByText("Found it!")).toBeVisible()
	await expect(panel(page)).toContainText("Twelve astronauts")
	await page.screenshot({ path: path.join(screenshotDir, "found.png") })

	await panel(page).getByRole("button", { name: "Next clue" }).click()
	await expect(page.getByTestId("hunt-progress")).toHaveText("Clue 2 of 6")
	await expect(page.getByTestId("hunt-clue")).toContainText("red planet")

	// closing the panel takes the hunt out of the link; the button brings it back
	await panel(page).getByRole("button", { name: "Close" }).click()
	await expect(panel(page)).toHaveCount(0)
	await expect.poll(() => search(page).has("hunt")).toBe(false)
	await openTool(page, "hunt")
	await expect(page.getByTestId("hunt-progress")).toHaveText("Clue 2 of 6")
})

test("hints escalate, and 'Show me' finds the moon", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	// a teacher's own hunt: two clues from the bank
	await ready(page, "/solar_system?hunt=geysers.nope.oceanMoon&lang=en")
	await expect(panel(page).getByRole("heading")).toHaveText("Your own hunt")
	await expect(page.getByTestId("hunt-progress")).toHaveText("Clue 1 of 2")
	await expect(page.getByTestId("hunt-clue")).toContainText(
		"geysers that spray water",
	)
	expect(search(page).get("hunt")).toBe("geysers.oceanMoon")

	await panel(page).getByRole("button", { name: "Need a hint?" }).click()
	await expect(panel(page)).toContainText("Hint 1")
	await panel(page).getByRole("button", { name: "Another hint" }).click()
	await panel(page).getByRole("button", { name: "Another hint" }).click()
	await expect(panel(page)).toContainText("It is Enceladus")
	await page.screenshot({ path: path.join(screenshotDir, "hints.png") })

	await panel(page).getByRole("button", { name: "Show me" }).click()
	await expect(panel(page).getByText("Found it!")).toBeVisible()
	await expect
		.poll(() =>
			page.evaluate(() => window.__orbitalia!.store.getState().selectedId),
		)
		.toBe("enceladus")
})

test("a shared link names the hunt in the teacher's language", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	await ready(page, "/solar_system?hunt=weirdWorlds&lang=de&reading=simple")
	await expect(panel(page).getByRole("heading")).toHaveText("Seltsame Welten")
	await expect(page.getByTestId("hunt-clue")).toHaveText(
		"Finde einen Planeten, der sich rückwärts dreht, also andersherum als die Erde.",
	)
	await panel(page).getByRole("button", { name: "Teilen" }).click()
	const link = new URL(await page.getByTestId("hunt-share-url").inputValue())
	expect(link.pathname).toBe("/solar_system")
	expect(link.searchParams.get("hunt")).toBe("weirdWorlds")
	expect(link.searchParams.get("lang")).toBe("de")
	expect(link.searchParams.get("reading")).toBe("simple")
	// only the hunt: the teacher's camera, selection and time stay behind
	expect([...link.searchParams.keys()].sort()).toEqual([
		"hunt",
		"lang",
		"reading",
	])
	await page.screenshot({ path: path.join(screenshotDir, "share-de.png") })
})

test("the finish, and progress that survives a reload", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	await ready(page, "/solar_system?hunt=walkedOn.redPlanet&lang=en")
	await expect(page.getByTestId("hunt-clue")).toBeVisible()
	// any way of selecting counts, the picker too
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setFocus("moon"),
	)
	await expect(panel(page).getByText("Found it!")).toBeVisible()
	await panel(page).getByRole("button", { name: "Next clue" }).click()
	await expect(page.getByTestId("hunt-progress")).toHaveText("Clue 2 of 2")

	await page.reload()
	await page.waitForFunction(() => window.__orbitalia !== undefined)
	await expect(page.getByTestId("hunt-progress")).toHaveText("Clue 2 of 2")

	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setFocus("mars"),
	)
	await panel(page).getByRole("button", { name: "Finish" }).click()
	await expect(page.getByTestId("hunt-done")).toBeVisible()
	await expect(panel(page)).toContainText("You solved all 2 clues.")
	await expect(panel(page).getByRole("button", { name: "Moon" })).toBeVisible()
	await expect(panel(page).getByRole("button", { name: "Mars" })).toBeVisible()
	await page.screenshot({ path: path.join(screenshotDir, "done.png") })

	await panel(page).getByRole("button", { name: "Play again" }).click()
	await expect(page.getByTestId("hunt-progress")).toHaveText("Clue 1 of 2")
})

test("the difficulty is a real choice, opening on the reader's age (#52)", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	await stubSpeech(page)
	await ready(page, "/solar_system?hunt=true&lang=en&reading=simple")
	// simple (ages 6–11) opens on Easy: two hunts, with their pictures
	await expect(difficulty(page, "Easy")).toBeChecked()
	const cards = panel(page).locator("[data-hunt]")
	await expect(cards).toHaveCount(2)
	await expect(panel(page).locator('[data-hunt="lookAndFind"]')).toBeVisible()
	await expect(
		panel(page).locator('[data-hunt="lookAndFind"] [data-picture]'),
	).toHaveCount(5)
	await expect(page.getByTestId("hunt-easy-note")).toContainText(
		"A voice reads the clues",
	)

	// Medium and Tricky show other hunts; the choice holds while the page is open
	await chooseDifficulty(page, "Medium")
	await expect(cards).toHaveCount(2)
	await expect(panel(page).locator('[data-hunt="firstSteps"]')).toBeVisible()
	await expect(page.getByTestId("hunt-easy-note")).toHaveCount(0)
	await chooseDifficulty(page, "Tricky")
	await expect(
		panel(page).locator('[data-hunt="lightAndMotion"]'),
	).toBeVisible()
	await panel(page).getByRole("button", { name: "Close" }).click()
	await openTool(page, "hunt")
	await expect(difficulty(page, "Tricky")).toBeChecked()

	// a teacher's own hunt lists every clue under its level, and may mix them
	await panel(page).getByText("Make your own hunt").click()
	await panel(page).getByLabel("Find the red planet.", { exact: true }).check()
	await panel(page)
		.getByLabel(
			"Find the only world where people have walked, apart from Earth.",
		)
		.check()
	await panel(page).getByRole("button", { name: "Start" }).click()
	await expect.poll(() => search(page).get("hunt")).toBe("seeRed.walkedOn")
	// the Easy clue keeps its picture
	await expect(panel(page).locator('[data-picture="mars"]')).toBeVisible()
})

test("an Easy hunt, played to the end: pictures, a voice, hints that show, stars and a certificate (#52)", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	await stubSpeech(page)
	await ready(page, "/solar_system?hunt=true&lang=en&reading=simple")
	const sound = page.getByRole("button", { name: "Sound", exact: true })
	await expect(sound).toHaveAttribute("aria-pressed", "false")

	// the click that starts it asks for the voice: sound on, the clue read out
	await panel(page).locator('[data-hunt="lookAndFind"]').click()
	await expect(page.getByTestId("hunt-clue")).toHaveText(
		"Find the planet we live on.",
	)
	await expect(panel(page).locator('[data-picture="earth"]')).toBeVisible()
	await expect(sound).toHaveAttribute("aria-pressed", "true")
	await expect.poll(() => spoken(page)).toContain("Find the planet we live on.")
	await expect(page.getByTestId("hunt-stars").locator("svg")).toHaveCount(5)

	// asked from the overview, with the names on and a picture beside each
	await cameraAtRest(page)
	expect(
		await page.evaluate(() => window.__orbitalia!.store.getState().view.kind),
	).toBe("overview")
	await expect(
		page.locator('[data-label-layer] [data-body="earth"] [data-picture]'),
	).toBeVisible()

	// the hints show: the area of the sky, then the answer blinks, each read out
	const spot = page.getByTestId("hunt-spot")
	await expect(spot).toBeHidden()
	await panel(page).getByRole("button", { name: "Need a hint?" }).click()
	await expect(spot).toHaveAttribute("data-kind", "area")
	await expect(spot).toBeVisible()
	await expect
		.poll(() => spoken(page))
		.toContain("Look inside the yellow circle for a blue and white planet.")
	await panel(page).getByRole("button", { name: "Another hint" }).click()
	await expect(spot).toHaveAttribute("data-kind", "pulse")
	await page.screenshot({ path: path.join(screenshotDir, "easy-hint.png") })

	// the speaker reads it again on demand
	const before = (await spoken(page)).length
	await panel(page)
		.getByRole("button", { name: "Read it aloud" })
		.first()
		.click()
	await expect.poll(async () => (await spoken(page)).length).toBe(before + 1)

	// a click on the world (forgiving at Easy): a star, a sticker, its words read
	await clickBody(page, "earth")
	await expect(page.getByTestId("hunt-found")).toBeVisible()
	await expect(spot).toBeHidden()
	await expect(page.getByTestId("hunt-sticker")).toBeVisible()
	await expect
		.poll(() => spoken(page))
		.toContain("Yes, that is Earth, our home!")
	await expect(
		page.getByTestId("hunt-stars").locator('[data-state="found"]'),
	).toHaveCount(1)
	await page.screenshot({ path: path.join(screenshotDir, "easy-found.png") })

	// the moon clue first takes the camera to Earth
	const answers = ["mars", "jupiter", "saturn", "moon"]
	for (const answer of answers) {
		await panel(page).getByRole("button", { name: "Next clue" }).click()
		await expect(page.getByTestId("hunt-found")).toHaveCount(0)
		if (answer === "moon") {
			await expect(page.getByTestId("hunt-arrival")).toHaveText(
				"We are at Earth.",
			)
			await expect
				.poll(() => spoken(page))
				.toContain("We are at Earth. Find the Moon!")
			await cameraAtRest(page)
			const view = await page.evaluate(
				() => window.__orbitalia!.store.getState().view,
			)
			expect(view).toEqual({ kind: "body", id: "earth" })
			// the Moon is on screen, clear of the panel
			await clickBody(page, "moon")
		} else {
			await page.evaluate(
				(id) => window.__orbitalia!.store.getState().setFocus(id),
				answer,
			)
		}
		await expect(page.getByTestId("hunt-found")).toBeVisible()
	}

	// muting stops the voice, and nothing turns it back on
	const cancels = await page.evaluate(() => window.__speech!.cancels)
	await page.keyboard.press("m")
	await expect(sound).toHaveAttribute("aria-pressed", "false")
	expect(await page.evaluate(() => window.__speech!.cancels)).toBeGreaterThan(
		cancels,
	)
	const heard = (await spoken(page)).length
	await panel(page).getByRole("button", { name: "Finish" }).click()
	await expect(page.getByTestId("hunt-done")).toBeVisible()
	expect((await spoken(page)).length).toBe(heard)
	await expect(panel(page)).toContainText("You did it: all 5 found!")
	await expect(
		panel(page).getByRole("img", { name: "5 stars" }).locator("svg"),
	).toHaveCount(5)
	// no pictures beside the names once the hunt is over
	await expect(page.locator("[data-label-layer] [data-picture]")).toHaveCount(0)
	await page.screenshot({ path: path.join(screenshotDir, "easy-done.png") })

	// the certificate: the postcard of the view with the worlds found
	await page.getByTestId("hunt-certificate").click()
	const dialog = page.getByRole("dialog")
	await expect(dialog).toBeVisible()
	await expect(dialog.getByRole("textbox", { name: "Caption" })).toHaveValue(
		"Look and find: you found all 5!",
	)
	await expect(
		dialog.getByRole("button", { name: "Save picture" }),
	).toBeVisible()
	await page.screenshot({
		path: path.join(screenshotDir, "easy-certificate.png"),
	})
})

test("an Easy clue on the projector (#29): large, read out, clear of the panel", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1366, height: 768 })
	await stubSpeech(page)
	await ready(
		page,
		"/solar_system?hunt=seeFarthest.seeBiggestMoon&present=true&lang=en&reading=simple",
	)
	await expect(page.getByTestId("hunt-clue")).toHaveText(
		"Find the planet farthest from the Sun.",
	)
	// the hunt's way in was a link, not a click: no voice until asked
	expect(await spoken(page)).toEqual([])
	await panel(page).getByRole("button", { name: "Read it aloud" }).click()
	await expect
		.poll(() => spoken(page))
		.toEqual(["Find the planet farthest from the Sun."])
	await cameraAtRest(page)
	// Neptune's whole orbit is framed clear of the hunt panel
	const neptune = await page.evaluate(() =>
		window.__orbitalia!.screenOf("neptune"),
	)
	const box = await panel(page).boundingBox()
	expect(neptune!.x).toBeLessThan(box!.x)
	// with its name and picture beside it
	const label = page.locator('[data-label-layer] [data-body="neptune"]')
	await expect(label).toHaveAttribute("data-visible", "true")
	await expect(label.locator("[data-picture]")).toBeVisible()
	await page.screenshot({
		path: path.join(screenshotDir, "easy-projector.png"),
	})
	await clickBody(page, "neptune")
	await expect(page.getByTestId("hunt-found")).toBeVisible()
	await panel(page).getByRole("button", { name: "Next clue" }).click()
	await expect(page.getByTestId("hunt-arrival")).toHaveText("We are at Saturn.")
	await expect
		.poll(() => spoken(page))
		.toContain("We are at Saturn. Find Saturn's biggest moon!")
	await cameraAtRest(page)
	await clickBody(page, "titan")
	await expect(page.getByTestId("hunt-found")).toBeVisible()
})

test("an Easy clue in Poster (#54), and its start view a step of Back (#46)", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	await stubSpeech(page)
	await ready(
		page,
		"/solar_system?scale=poster&focus=jupiter&hunt=true&lang=en&reading=simple",
	)
	await expect(page.locator("canvas")).toHaveAttribute(
		"data-scale-preset",
		"poster",
	)
	const view = () =>
		page.evaluate(() => window.__orbitalia!.store.getState().view)

	// the clue takes the camera from Jupiter to the overview: one step
	await panel(page).locator('[data-hunt="sunAndMoons"]').click()
	await expect(page.getByTestId("hunt-clue")).toHaveText("Find the Sun.")
	await cameraAtRest(page)
	expect(await view()).toEqual({ kind: "overview" })
	// Poster keeps its discs, every planet named with its picture
	await expect(
		page.locator('[data-label-layer] [data-body="saturn"] [data-picture]'),
	).toBeVisible()

	// Back returns to where we were before the clue; the clue stays
	await page.getByTestId("back-button").click()
	await cameraAtRest(page)
	expect(await view()).toEqual({ kind: "body", id: "jupiter" })
	await expect(page.getByTestId("hunt-clue")).toHaveText("Find the Sun.")

	// answered; the next clue is asked from the overview again
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setFocus("sun"),
	)
	await expect(page.getByTestId("hunt-found")).toBeVisible()
	await panel(page).getByRole("button", { name: "Next clue" }).click()
	await cameraAtRest(page)
	expect(await view()).toEqual({ kind: "overview" })
	await clickBody(page, "mercury")
	await expect(page.getByTestId("hunt-found")).toBeVisible()
	await panel(page).getByRole("button", { name: "Next clue" }).click()
	await expect(page.getByTestId("hunt-clue")).toHaveText(
		"Find the planet farthest from the Sun.",
	)
	await cameraAtRest(page)
	// Neptune and its name are clear of the panel, the planets as big as before
	const neptune = await page.evaluate(() =>
		window.__orbitalia!.screenOf("neptune"),
	)
	const box = await panel(page).boundingBox()
	expect(neptune!.x < box!.x || neptune!.y < box!.y).toBe(true)
	await expect(
		page.locator('[data-label-layer] [data-body="neptune"]'),
	).toHaveAttribute("data-visible", "true")
	expect(neptune!.discPx).toBeGreaterThan(2)
	await page.screenshot({ path: path.join(screenshotDir, "easy-poster.png") })
	await clickBody(page, "neptune")
	await expect(page.getByTestId("hunt-found")).toBeVisible()
})
