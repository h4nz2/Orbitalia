/**
 * Anchored reference frame (#31): "Seen from Earth" holds Earth still, Mars
 * draws its retrograde loop as a trail, the badge names the frame and reads
 * the sky, and "Back to Sun-centred" (or Escape) is one action away.
 */
import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest, nextFrames } from "./support/scene"

const screenshotDir = path.join("test-results", "referenceFrame")

// software WebGL is slow and every step waits for the camera to come to rest
test.describe.configure({ timeout: 180_000 })

/** 16 January 2025: Mars at opposition, in the middle of its retrograde loop. */
const MARS_OPPOSITION = 2460691.5

const ready = async (page: Page, url: string) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 30_000,
	})
}

const settled = async (page: Page) => {
	await cameraAtRest(page)
	// the frame blend (1.2 s of real time), then a few frames drawn after it
	await page.waitForTimeout(1300)
	await nextFrames(page, 3)
}

const state = (page: Page) =>
	page.evaluate(() => {
		const s = window.__orbitalia!.store.getState()
		return {
			frameId: s.frameId,
			selectedId: s.selectedId,
			timeWarp: s.timeWarp,
			paused: s.paused,
			mode: window.__orbitalia!.camera().mode,
		}
	})

/** Pixels of the Mars trail's orange (red well above green and blue) in the canvas. */
const orangePixels = async (page: Page, name: string): Promise<number> => {
	mkdirSync(screenshotDir, { recursive: true })
	const png = await page.screenshot({
		path: path.join(screenshotDir, `${name}.png`),
	})
	return page.evaluate(async (base64) => {
		const image = new Image()
		image.src = `data:image/png;base64,${base64}`
		await image.decode()
		const canvas = document.createElement("canvas")
		canvas.width = image.width
		canvas.height = image.height
		const context = canvas.getContext("2d")
		if (context === null) return -1
		context.drawImage(image, 0, 0)
		const { width, height } = canvas
		const data = context.getImageData(0, 0, width, height).data
		let count = 0
		// the scene between the HUD rows
		for (let y = Math.round(height * 0.2); y < height * 0.75; y++) {
			for (let x = 0; x < width; x++) {
				const o = (y * width + x) * 4
				const [r, g, b] = [data[o], data[o + 1], data[o + 2]]
				if (r > 90 && r > 1.8 * g && r > 2.2 * b) count++
			}
		}
		return count
	}, png.toString("base64"))
}

test("'Seen from Earth' holds Earth still and draws Mars's loop; one click goes back", async ({
	page,
}) => {
	await ready(page, `/solar_system?t=${MARS_OPPOSITION}`)
	await settled(page)
	const before = await orangePixels(page, "sun-centred")

	const menu = page.getByTestId("frame-menu")
	await expect(menu).toHaveAccessibleName("Point of view: Sun-centred")
	await menu.click()
	await page
		.getByRole("menuitem", { name: /Seen from Earth: the planets/ })
		.click()
	// hold the moment still for the picture
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setPaused(true),
	)

	const badge = page.getByTestId("frame-badge")
	await expect(badge).toBeVisible()
	await expect(badge).toContainText("Seen from Earth")
	await expect(menu).toHaveAccessibleName("Point of view: Seen from Earth")
	expect(await state(page)).toMatchObject({
		frameId: "earth",
		selectedId: "mars",
		timeWarp: 2629800,
	})
	await expect(page).toHaveURL(/frame=earth/)
	await settled(page)
	expect(await state(page)).toMatchObject({ mode: "focused" })

	// the loop: Mars is going backwards right now, and its trail is on screen
	await expect(page.getByTestId("frame-sky-status")).toHaveAttribute(
		"data-motion",
		"retrograde",
	)
	await expect(page.getByTestId("frame-inset")).toBeVisible()
	const after = await orangePixels(page, "seen-from-earth")
	expect(after).toBeGreaterThan(before + 150)

	// one action back
	await badge.getByRole("button", { name: "Back to Sun-centred" }).click()
	await expect(badge).toBeHidden()
	await expect(page).not.toHaveURL(/frame=/)
	expect((await state(page)).frameId).toBe("sun")
	await settled(page)
	expect(await state(page)).toMatchObject({ mode: "overview" })
})

test("a link opens held still; Escape is a way out too", async ({ page }) => {
	await ready(
		page,
		`/solar_system?focus=earth&frame=earth&sel=venus&t=2460756.5`,
	)
	await settled(page)
	const badge = page.getByTestId("frame-badge")
	await expect(badge).toBeVisible()
	// Venus turned retrograde on 2 March 2025
	await expect(page.getByTestId("frame-sky-status")).toHaveAttribute(
		"data-motion",
		"retrograde",
	)
	await expect(page.getByTestId("frame-sky-status")).toContainText("Venus")
	await page.keyboard.press("Escape")
	await expect(badge).toBeHidden()
	expect((await state(page)).frameId).toBe("sun")
})

test("'Seen from Earth: the Moon' reads the phase, in German too", async ({
	page,
}) => {
	// the full moon of 14 March 2025
	await ready(page, `/solar_system?t=2460748.79&lang=de`)
	await settled(page)
	await page.getByTestId("frame-menu").click()
	await page
		.getByRole("menuitem", { name: /Von der Erde aus: der Mond/ })
		.click()
	await page.evaluate(() => {
		const store = window.__orbitalia!.store.getState()
		store.setPaused(true)
		store.setSimTime(2460748.79)
	})
	const badge = page.getByTestId("frame-badge")
	await expect(badge).toContainText("Von der Erde aus gesehen")
	await expect(page.getByTestId("frame-sky-status")).toHaveAttribute(
		"data-phase",
		"full",
	)
	await expect(page.getByTestId("frame-sky-status")).toContainText("Vollmond")
	expect(await state(page)).toMatchObject({
		frameId: "earth",
		selectedId: "moon",
		timeWarp: 86400,
	})
	await settled(page)
	mkdirSync(screenshotDir, { recursive: true })
	await page.screenshot({ path: path.join(screenshotDir, "moon-de.png") })
	await expect(
		badge.getByRole("button", { name: "Zurück: Sonne im Zentrum" }),
	).toBeVisible()
})

test("'Hold <focus> still' anchors whatever is at the centre", async ({
	page,
}) => {
	await ready(page, `/solar_system?focus=jupiter&t=${MARS_OPPOSITION}`)
	await settled(page)
	await page.getByTestId("frame-menu").click()
	await page.getByRole("menuitem", { name: /Hold Jupiter still/ }).click()
	await expect(page.getByTestId("frame-badge")).toContainText(
		"Jupiter held still",
	)
	expect((await state(page)).frameId).toBe("jupiter")
	// the home button releases it with everything else
	await page.getByRole("button", { name: "Back to overview" }).click()
	await expect(page.getByTestId("frame-badge")).toBeHidden()
	expect((await state(page)).frameId).toBe("sun")
})
