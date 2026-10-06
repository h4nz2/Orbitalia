import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"
import { openTool } from "./support/hud"

// The scavenger hunt (#34), in the real browser: pick a hunt, answer a clue by
// clicking the world in the scene (kind words on a miss, no penalty),
// escalating hints ending in "Show me", the share link, the finish, and the
// progress surviving a reload.

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

	// the chooser: the ready-made hunts with their difficulty
	await expect(panel(page)).toBeVisible()
	await expect(panel(page).getByText("Pick a hunt")).toBeVisible()
	await expect(panel(page).locator("[data-hunt]")).toHaveCount(4)
	mkdirSync(screenshotDir, { recursive: true })
	await page.screenshot({ path: path.join(screenshotDir, "chooser.png") })

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
