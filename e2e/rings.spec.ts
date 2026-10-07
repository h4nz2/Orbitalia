/**
 * Planetary rings (issue #12), judged from the picture: a ringed planet shows
 * lit ring pixels round its disc, a planet without rings shows none, the
 * rings stay drawn in "Always lit" and survive being seen edge-on.
 */
import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest, nextFrames } from "./support/scene"
import { openLayers } from "./support/hud"

const screenshotDir = path.join("test-results", "rings")

// headless chromium noise that is not an app bug
const ignoredConsoleErrors = [
	"WebGL",
	"GPU",
	"swiftshader",
	"GroupMarkerNotSet",
]

const collectErrors = (page: Page): string[] => {
	const errors: string[] = []
	page.on("pageerror", (error) => errors.push(error.message))
	page.on("console", (message) => {
		if (message.type() !== "error") return
		const text = message.text()
		if (ignoredConsoleErrors.some((needle) => text.includes(needle))) return
		errors.push(text)
	})
	return errors
}

const HUD_HIDDEN =
	"body * { visibility: hidden !important } canvas { visibility: visible !important }"

// only the focused planet: no moons, orbits, markers or names round it
const bare = "moons=false&orbits=false&markers=false&labels=false"

/**
 * Share of the pixels in the ring zone round the focused planet (outside its
 * disc: 1.3 to 2.3 drawn radii at the 6-radii framing, within 0.3 of the
 * height of the centre line) that differ visibly
 * from the background, counted in the page itself so no image library is needed.
 */
const ringZoneLit = async (page: Page, name: string): Promise<number> => {
	mkdirSync(screenshotDir, { recursive: true })
	const png = await page.screenshot({
		path: path.join(screenshotDir, `${name}.png`),
		// the scene alone: HUD panels and names hidden for the picture
		style: HUD_HIDDEN,
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
		const cx = width / 2
		const cy = height / 2
		// the disc's radius is about 0.2 of the height at the 6-radii framing
		const disc = 0.2 * height
		let lit = 0
		let total = 0
		// a band round the centre line: clear of the HUD panels above and below
		for (let y = Math.round(cy - 0.3 * height); y < cy + 0.3 * height; y++) {
			for (let x = Math.round(cx - 2.3 * disc); x < cx + 2.3 * disc; x++) {
				const r = Math.hypot(x - cx, y - cy)
				if (r < 1.3 * disc || r > 2.3 * disc) continue
				total++
				const o = (y * width + x) * 4
				const d =
					Math.abs(data[o] - 0x0b) +
					Math.abs(data[o + 1] - 0x0d) +
					Math.abs(data[o + 2] - 0x12)
				if (d > 40) lit++
			}
		}
		return lit / total
	}, png.toString("base64"))
}

const focusOn = async (page: Page, query: string, name: string) => {
	await page.goto(`/solar_system?${query}&${bare}`)
	await expect(page.getByRole("combobox", { name: "Focus body" })).toHaveValue(
		name,
	)
	await cameraAtRest(page)
}

test("ringed planets show their rings and a planet without rings shows none", async ({
	page,
}) => {
	test.slow()
	const errors = collectErrors(page)

	await focusOn(page, "focus=mars", "Mars")
	await nextFrames(page)
	expect(await ringZoneLit(page, "mars")).toBeLessThan(0.002)

	for (const [query, name] of [
		["focus=saturn", "Saturn"],
		["focus=uranus", "Uranus"],
		// true scale: the rings keep their true size next to the planet
		["focus=saturn&scale=trueScale", "Saturn"],
	]) {
		await focusOn(page, query, name)
		// the ring textures load after the planet: wait for them to be drawn
		await expect
			.poll(() => ringZoneLit(page, query.replace(/[=&]/g, "-")), {
				timeout: 20_000,
			})
			.toBeGreaterThan(0.05)
	}
	expect(errors).toEqual([])
})

test("rings stay drawn in Always lit and survive an edge-on view", async ({
	page,
}) => {
	test.slow()
	const errors = collectErrors(page)
	await focusOn(page, "focus=saturn", "Saturn")
	await expect
		.poll(() => ringZoneLit(page, "saturn-honest"), { timeout: 20_000 })
		.toBeGreaterThan(0.05)

	// a click on the rings is a click on Saturn (already framed: it is selected again, the
	// camera stays), never a click on empty space, which would only clear the selection
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().select("jupiter"),
	)
	const size = page.viewportSize()
	if (size === null) throw new Error("no viewport")
	await page.mouse.click(size.width / 2 - 0.37 * size.height, size.height / 2)
	await nextFrames(page)
	expect(
		await page.evaluate(() => {
			const { view, selectedId } = window.__orbitalia!.store.getState()
			return { view, selectedId }
		}),
	).toEqual({ view: { kind: "body", id: "saturn" }, selectedId: "saturn" })

	await openLayers(page)
	const alwaysLit = page.getByRole("switch", { name: "Always lit" })
	await alwaysLit.click({ force: true })
	await expect(alwaysLit).toBeChecked()
	await nextFrames(page)
	expect(await ringZoneLit(page, "saturn-always-lit")).toBeGreaterThan(0.05)

	// exactly in Saturn's ring plane (its pole points to azimuth 169.5 deg, 62 deg up):
	// the sheet covers no pixel, the rings are still a line across the view
	await focusOn(page, "focus=saturn&cam=79.53_0_1", "Saturn")
	await expect
		.poll(() => ringZoneLit(page, "saturn-edge-on"), { timeout: 20_000 })
		.toBeGreaterThan(0.002)
	expect(errors).toEqual([])
})
