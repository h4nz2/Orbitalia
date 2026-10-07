import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"

// Back (#46): return to where you just were. Choosing a body is a step that
// Back (the arrow next to the house, Backspace, the browser's and the phone's
// back) undoes, flying back to the view as it was left; dragging and zooming
// in between add no steps; Forward re-applies a step; during a tour Back is
// the stop before. Steps go through the picker or a click; never through an
// empty click, which moves nothing (#47).

// software WebGL is slow and every step waits for real flights to land
test.describe.configure({ timeout: 240_000 })

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 30_000,
	})
	await cameraAtRest(page)
}

const backButton = (page: Page) => page.getByTestId("back-button")
const focusPicker = (page: Page) =>
	page.getByRole("combobox", { name: "Focus body" })

const state = (page: Page) =>
	page.evaluate(() => {
		const { view, selectedId, shot } = window.__orbitalia!.store.getState()
		const { index } = window.__orbitalia!.history.getState()
		return { view, selectedId, shot, index }
	})

/** Chooses a body in the picker, as a visitor searching for it does. */
const choose = async (page: Page, name: string) => {
	await focusPicker(page).click()
	await focusPicker(page).fill(name)
	await page.getByRole("option", { name: new RegExp(`^${name}`) }).click()
	await expect(focusPicker(page)).toHaveValue(name)
}

/** Waits until the view is `id` and the camera has landed there. */
const landedOn = async (page: Page, id: string) => {
	await expect
		.poll(async () => (await state(page)).view)
		.toEqual({ kind: "body", id })
	await cameraAtRest(page)
}

test("Back flies to the view before as it was left, step by step, and the browser's back does the same", async ({
	page,
}) => {
	test.slow()
	await page.setViewportSize({ width: 1280, height: 720 })
	// focused on Earth, far enough out to see the Moon go round it
	await ready(page, "/solar_system?focus=earth&cam=0_70_20&lang=en")
	// nothing to go back to yet: shown, but disabled
	await expect(backButton(page)).toBeVisible()
	await expect(backButton(page)).toHaveAttribute("aria-disabled", "true")
	const start = (await state(page)).index

	// click the Moon
	const moon = await page.evaluate(() => window.__orbitalia!.screenOf("moon"))
	expect(moon, "the Moon on screen").not.toBeNull()
	await page.mouse.click(moon!.x, moon!.y)
	await landedOn(page, "moon")
	await expect(backButton(page)).toHaveAttribute("aria-disabled", "false")

	// zoom out a little, and turn: no steps
	await page.mouse.move(640, 400)
	await page.mouse.wheel(0, 400)
	await cameraAtRest(page)
	await page.mouse.move(700, 400)
	await page.mouse.down()
	await page.mouse.move(820, 380, { steps: 8 })
	await page.mouse.up()
	await cameraAtRest(page)
	const left = await state(page)
	expect(left.index).toBe(start + 1)
	expect(left.shot!.distance).toBeGreaterThan(1.2)

	// then Mars
	await choose(page, "Mars")
	await landedOn(page, "mars")
	expect((await state(page)).index).toBe(start + 2)

	// Back flies to the Moon, at the distance and angle it was left at
	await backButton(page).click()
	await expect
		.poll(async () => (await state(page)).view)
		.toEqual({ kind: "body", id: "moon" })
	expect(
		await page.evaluate(
			() => window.__orbitalia!.store.getState().transition?.profile,
		),
	).toBe("fly")
	await cameraAtRest(page)
	const back = await state(page)
	expect(back.shot).toEqual(left.shot)
	expect(back.selectedId).toBe("moon")
	await expect(page).toHaveURL(/[?&]focus=moon(&|$)/)
	await expect(focusPicker(page)).toHaveValue("Moon")

	// Back again: Earth; then there is nothing left
	await backButton(page).click()
	await landedOn(page, "earth")
	await expect(backButton(page)).toHaveAttribute("aria-disabled", "true")
	await expect(page).toHaveURL(/[?&]focus=earth(&|$)/)
	// pressing it now does nothing (it is aria-disabled, so the click is forced)
	await backButton(page).click({ force: true })
	expect((await state(page)).index).toBe(start)
	await expect(page).toHaveURL(/\/solar_system\?/)

	// Forward re-applies the steps
	await page.goForward()
	await landedOn(page, "moon")
	expect((await state(page)).shot).toEqual(left.shot)
	await page.goForward()
	await landedOn(page, "mars")

	// the browser's back is Back, and so is Backspace
	await page.goBack()
	await landedOn(page, "moon")
	// from the page itself, not from a text field
	await page.evaluate(() =>
		(document.activeElement as HTMLElement | null)?.blur(),
	)
	await page.keyboard.press("Backspace")
	await landedOn(page, "earth")
	await expect(backButton(page)).toHaveAttribute("aria-disabled", "true")
})

test("the way out is one step too, and Backspace in the search box is only typing", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=saturn&lang=en")
	await page
		.getByRole("button", { name: "Back to overview", exact: true })
		.click()
	await expect
		.poll(async () => (await state(page)).view)
		.toEqual({ kind: "overview" })
	await cameraAtRest(page)

	// typing in the picker keeps its Backspace
	await focusPicker(page).click()
	await focusPicker(page).fill("Mar")
	await page.keyboard.press("Backspace")
	await expect(focusPicker(page)).toHaveValue("Ma")
	expect((await state(page)).view).toEqual({ kind: "overview" })
	await page.keyboard.press("Escape")

	// Back returns to Saturn
	await backButton(page).click()
	await landedOn(page, "saturn")
	expect((await state(page)).selectedId).toBe("saturn")
})

test("during a tour Back is the stop before, through the browser's history too", async ({
	page,
}) => {
	test.slow()
	await ready(page, "/solar_system?tour=grandTour&stop=1&lang=en")
	const card = page.locator("[data-tour-card]")
	const count = card.getByTestId("tour-count")
	await expect(count).toHaveText("Stop 1 of 11")
	await card.getByRole("button", { name: "Next" }).click()
	await expect(count).toHaveText("Stop 2 of 11")
	await card.getByRole("button", { name: "Next" }).click()
	await expect(count).toHaveText("Stop 3 of 11")
	await cameraAtRest(page)

	await backButton(page).click()
	await expect(count).toHaveText("Stop 2 of 11")
	await expect(page).toHaveURL(/[?&]stop=2(&|$)/)
	await cameraAtRest(page)
	await page.goBack()
	await expect(count).toHaveText("Stop 1 of 11")
	await expect(page).toHaveURL(/[?&]stop=1(&|$)/)
	await page.goForward()
	await expect(count).toHaveText("Stop 2 of 11")
	// the link opened on the first stop: nothing before it in the solar system
	await page.goBack()
	await expect(count).toHaveText("Stop 1 of 11")
	await expect(backButton(page)).toHaveAttribute("aria-disabled", "true")
})

test("Back is in the shortcut list", async ({ page }) => {
	await ready(page, "/solar_system?lang=en")
	await page.keyboard.press("?")
	const list = page.getByRole("dialog")
	await expect(list).toContainText("Backspace")
	await expect(list).toContainText("Back to where you just were")
})

test("the arrow sits beside the house, on a laptop and on a phone", async ({
	page,
}) => {
	const dir = path.join("test-results", "back")
	mkdirSync(dir, { recursive: true })
	for (const [name, width, height] of [
		["laptop", 1366, 768],
		["phone", 390, 844],
	] as const) {
		await page.setViewportSize({ width, height })
		await ready(page, "/solar_system?focus=mars&lang=en")
		const where = page.getByTestId("where")
		const back = (await backButton(page).boundingBox())!
		const home = (await where
			.getByRole("button", { name: "Back to overview", exact: true })
			.boundingBox())!
		const picker = (await focusPicker(page).boundingBox())!
		// in one row, left to right: Back, the way out, the name
		expect(Math.abs(back.y - home.y), name).toBeLessThan(2)
		expect(back.x + back.width, name).toBeLessThanOrEqual(home.x + 1)
		expect(home.x + home.width, name).toBeLessThanOrEqual(picker.x + 1)
		expect(picker.width, name).toBeGreaterThan(80)
		await page.screenshot({ path: path.join(dir, `${name}.png`) })
	}
})
