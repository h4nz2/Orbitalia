/**
 * The postcard (issue #33): one click takes the view without any HUD, stamps
 * it and offers it to save, copy or share; everything happens on the device.
 */
import { readFileSync } from "node:fs"

import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"
import { openTool } from "./support/hud"

// software WebGL renders the scene (and the picture) slowly
test.describe.configure({ timeout: 120_000 })

// 2026-09-25T00:00Z, paused: a fixed moment, so the file name is known
const JUPITER = "/solar_system?focus=jupiter&t=2461308.5"

async function ready(page: Page, url: string): Promise<void> {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	// hold the moment still, exactly on the day, so the date and file name are known
	await page.evaluate(() => {
		const store = window.__orbitalia!.store.getState()
		store.setPaused(true)
		store.setSimTime(2461308.5)
	})
	await cameraAtRest(page)
	// the planets' names fade in over 0.2 s
	await expect(
		page.locator('[data-body="jupiter"][data-visible="true"]'),
	).toBeVisible()
}

const dialog = (page: Page) =>
	page.getByRole("dialog", { name: "Your postcard from space" })

/**
 * Width, height and a few pixel statistics of the postcard preview. The
 * preview is repainted whenever an option changes (a new PNG, and the old
 * one's URL revoked), so a decode can fail because the picture it was
 * decoding has just been replaced: then the new one is read instead.
 */
const pictureStats = (page: Page) =>
	page.getByTestId("postcard-image").evaluate(async (element) => {
		const image = element as HTMLImageElement
		for (;;) {
			const src = image.src
			try {
				await image.decode()
				if (image.src === src) break
			} catch (error) {
				// a real decoding failure of the picture still shown is a failure
				if (image.src === src) throw error
			}
		}
		const canvas = document.createElement("canvas")
		canvas.width = image.naturalWidth
		canvas.height = image.naturalHeight
		const ctx = canvas.getContext("2d")!
		ctx.drawImage(image, 0, 0)
		const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
		let bright = 0
		let sum = 0
		for (let i = 0; i < data.length; i += 4) {
			const luma =
				0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
			sum += luma
			if (luma > 60) bright++
		}
		return {
			src: image.src,
			width: image.naturalWidth,
			height: image.naturalHeight,
			bright: bright / (data.length / 4),
			sum,
		}
	})

test("one click takes the view, stamps it and saves it on the device", async ({
	page,
}) => {
	const requests: string[] = []
	page.on("request", (request) => {
		if (request.method() !== "GET") requests.push(request.url())
	})
	await ready(page, JUPITER)
	const viewport = page.viewportSize()!

	await openTool(page, "postcard")
	await expect(dialog(page)).toBeVisible()
	await expect(page.getByTestId("postcard-image")).toBeVisible({
		timeout: 20_000,
	})
	const stats = await pictureStats(page)
	// a clean resolution: at least 1920 px of scene along the long side, plus the frame
	expect(stats.width).toBeGreaterThan(1920)
	expect(stats.height).toBeGreaterThan(
		(1920 * viewport.height) / viewport.width,
	)
	// Jupiter and the stamp are in it
	expect(stats.bright).toBeGreaterThan(0.01)

	// the suggested caption is the body's tagline, and can be changed
	const caption = dialog(page).getByRole("textbox", { name: "Caption" })
	await expect(caption).not.toHaveValue("")
	await caption.fill("Our homework: count the moons")
	await expect
		.poll(async () => (await pictureStats(page)).src, { timeout: 10_000 })
		.not.toBe(stats.src)

	// the names are painted onto the picture (labels are DOM, not WebGL)
	const withNames = await pictureStats(page)
	await dialog(page)
		.getByRole("switch", { name: "Names on the picture" })
		.click()
	await expect
		.poll(async () => (await pictureStats(page)).src, { timeout: 10_000 })
		.not.toBe(withNames.src)
	const withoutNames = await pictureStats(page)
	expect(withoutNames.sum).toBeLessThan(withNames.sum)

	const download = page.waitForEvent("download")
	await dialog(page).getByRole("button", { name: "Save picture" }).click()
	const file = await download
	expect(file.suggestedFilename()).toBe("orbitalia-jupiter-2026-09-25.png")
	const png = readFileSync(await file.path())
	expect(png.subarray(1, 4).toString()).toBe("PNG")
	expect(png.readUInt32BE(16)).toBe(withoutNames.width)

	await expect(dialog(page)).toContainText("Nothing is uploaded")
	expect(requests).toEqual([])
})

test("copies the picture and the link to the clipboard", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"])
	await ready(page, JUPITER)
	await openTool(page, "postcard")
	await expect(page.getByTestId("postcard-image")).toBeVisible({
		timeout: 20_000,
	})

	await dialog(page).getByRole("button", { name: "Copy picture" }).click()
	await expect(dialog(page)).toContainText("Picture copied")
	const types = await page.evaluate(async () => {
		const items = await navigator.clipboard.read()
		return items.flatMap((item) => [...item.types])
	})
	expect(types).toContain("image/png")

	await dialog(page).getByRole("button", { name: "Copy link" }).click()
	await expect(dialog(page)).toContainText("Link copied")
	const link = new URL(
		await page.evaluate(() => navigator.clipboard.readText()),
	)
	expect(link.pathname).toBe("/solar_system")
	expect(link.searchParams.get("focus")).toBe("jupiter")
	expect(link.searchParams.get("t")).toBe("2461308.5")
})

test("Escape closes the postcard and keeps the view", async ({ page }) => {
	await ready(page, JUPITER)
	await openTool(page, "postcard")
	await expect(dialog(page)).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(dialog(page)).toBeHidden()
	const view = await page.evaluate(
		() => window.__orbitalia!.store.getState().view,
	)
	expect(view).toEqual({ kind: "body", id: "jupiter" })
})

test("speaks German", async ({ page }) => {
	await ready(page, `${JUPITER}&lang=de`)
	await openTool(page, "postcard")
	const german = page.getByRole("dialog", {
		name: "Deine Postkarte aus dem All",
	})
	await expect(german).toBeVisible()
	await expect(
		german.getByRole("button", { name: "Bild speichern" }),
	).toBeVisible()
	await expect(german).toContainText("Nichts wird hochgeladen")
})

test("works from the comparison: the pair at true relative size with its facts", async ({
	page,
}) => {
	await page.goto("/compare?bodies=earth,jupiter&t=2461308.5")
	await expect(page.getByTestId("compare-stage")).toBeVisible()
	await page.getByRole("button", { name: "Take a picture" }).click()
	await expect(dialog(page)).toBeVisible({ timeout: 20_000 })
	await expect(page.getByTestId("postcard-image")).toBeVisible({
		timeout: 20_000,
	})
	// the size comparison is the caption
	await expect(
		dialog(page).getByRole("textbox", { name: "Caption" }),
	).toHaveValue(/Jupiter/)
	const stats = await pictureStats(page)
	expect(stats.width).toBeGreaterThan(1920)
	expect(stats.bright).toBeGreaterThan(0.01)
	const download = page.waitForEvent("download")
	await dialog(page).getByRole("button", { name: "Save picture" }).click()
	expect((await download).suggestedFilename()).toBe(
		"orbitalia-earth-jupiter.png",
	)
})
