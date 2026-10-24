import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { openLayers } from "./support/hud"
import { cameraAtRest, nextFrames } from "./support/scene"

// The spacecraft as themselves (#73): following Voyager 1 shows its model,
// drawn larger on purpose, and its card says by how much; in cruise its core
// is at least 48 px and really on the canvas, and a tap on its core selects
// it; beside Neptune a tap on the planet past the core is Neptune's; true
// scale keeps the diamond and the card explains why; a
// visit that never shows a craft downloads neither the models nor the
// trajectories; and on a phone the model and the statement are there too, the
// statement in the sheet. Every date is pinned in the links.

// software WebGL is slow, and the model must arrive and fade in first
test.describe.configure({ timeout: 240_000 })

/** 25 September 2026, 00:00 UTC. */
const T_2026 = 2461308.5
/** Voyager 1 at Jupiter, 5 March 1979 (its closest approach). */
const T_JUPITER = 2443938.0
const FOLLOW = `/solar_system?craft=voyager1&follow=true&focus=jupiter&t=${T_JUPITER}&paused=true&lang=en`
/** Voyager 1 between Jupiter and Saturn, 1 January 1980: no planet near enough to hold its model smaller. */
const T_CRUISE = 2444239.5
/** Voyager 2 at Neptune, 25 August 1989 (its closest approach): drawn in front of the planet's disc. */
const T_NEPTUNE = 2447763.66
const screenshotDir = path.join("test-results", "spacecraftModels")
const HUD_HIDDEN =
	"body * { visibility: hidden !important } canvas { visibility: visible !important }"

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	await cameraAtRest(page)
}

/** How a craft is drawn (./src/features/solarSystem/spacecraft/modelProbe.ts). */
const probe = (page: Page, id: string) =>
	page.locator(`[data-craft-model=${id}]`)

const panel = (page: Page) =>
	page.getByRole("region", { name: "Selected spacecraft" })

/** Waits until the craft's model is drawn, and returns its height on screen (px). */
async function modelShown(page: Page, id: string): Promise<number> {
	await expect(probe(page, id)).toHaveAttribute("data-state", "model", {
		timeout: 60_000,
	})
	return Number(await probe(page, id).getAttribute("data-px"))
}

/** The craft's model at rest: its whole length and its core on screen (px), and where it is on the canvas. */
async function modelAtRest(page: Page, id: string) {
	await modelShown(page, id)
	// the probe is written a few times a second: let it catch up
	await nextFrames(page, 10)
	await page.waitForTimeout(400)
	const at = await page.evaluate(
		(craft) => window.__orbitalia!.craftScreenOf(craft),
		id,
	)
	return {
		px: Number(await probe(page, id).getAttribute("data-px")),
		corePx: Number(await probe(page, id).getAttribute("data-core-px")),
		x: at!.x,
		y: at!.y,
	}
}

/**
 * Share of the pixels in a square `side` px wide round (`x`, `y`) on the
 * canvas that differ visibly from the background, counted in the page itself
 * (as ./rings.spec.ts does), with the HUD and the names hidden.
 */
const litAround = async (
	page: Page,
	name: string,
	x: number,
	y: number,
	side: number,
): Promise<number> => {
	mkdirSync(screenshotDir, { recursive: true })
	const canvas = (await page.locator("canvas").first().boundingBox())!
	const png = await page.screenshot({
		path: path.join(screenshotDir, `${name}.png`),
		style: HUD_HIDDEN,
		clip: {
			x: canvas.x + x - side / 2,
			y: canvas.y + y - side / 2,
			width: side,
			height: side,
		},
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
		const data = context.getImageData(0, 0, image.width, image.height).data
		let lit = 0
		for (let o = 0; o < data.length; o += 4) {
			const d =
				Math.abs(data[o] - 0x0b) +
				Math.abs(data[o + 1] - 0x0d) +
				Math.abs(data[o + 2] - 0x12)
			if (d > 40) lit++
		}
		return lit / (data.length / 4)
	}, png.toString("base64"))
}

test("following Voyager 1 shows its model, drawn far bigger than it is, and the card says so", async ({
	page,
}) => {
	await ready(page, FOLLOW)
	// its whole length, booms included, comfortably more than the floor of 48 px
	expect(await modelShown(page, "voyager1")).toBeGreaterThanOrEqual(48)
	const statement = panel(page).locator("[data-drawn=model]")
	await expect(statement).toContainText(
		/^Drawn about [\d.,]+( million| billion)? times bigger than it is\./,
	)
	await expect(statement).toContainText(
		"At its real size it would be far smaller than a pixel.",
	)
})

test("in cruise the followed craft's core is at least 48 px, drawn on the canvas, and a tap on it selects the craft", async ({
	page,
}) => {
	await ready(
		page,
		`/solar_system?craft=voyager1&follow=true&t=${T_CRUISE}&paused=true&lang=en`,
	)
	const model = await modelAtRest(page, "voyager1")
	// the floor holds: between the planets nothing holds it smaller
	expect(model.corePx).toBeGreaterThanOrEqual(48)
	expect(model.px).toBeGreaterThan(model.corePx)
	// and it is really drawn: dish, bus and panels light up much of the core's
	// square (the 9 px diamond and the path through it are under a tenth)
	expect(
		await litAround(page, "voyager1-cruise", model.x, model.y, model.corePx),
	).toBeGreaterThan(0.15)

	// a tap on the core, off its centre and beyond the diamond's 12 px,
	// selects the craft, as the diamond did
	await panel(page).getByRole("button", { name: "Close" }).click()
	await expect(panel(page)).toHaveCount(0)
	const canvas = (await page.locator("canvas").first().boundingBox())!
	const off = 0.75 * (model.corePx / 2)
	expect(off).toBeGreaterThan(12)
	await page.mouse.click(canvas.x + model.x + off, canvas.y + model.y)
	await expect(panel(page)).toContainText("Voyager 1")

	// beyond the core, on a boom's reach, it does not: that is space
	await panel(page).getByRole("button", { name: "Close" }).click()
	await expect(panel(page)).toHaveCount(0)
	const boom = (model.corePx / 2 + model.px / 2) / 2
	await page.mouse.click(canvas.x + model.x, canvas.y + model.y - boom)
	await nextFrames(page, 5)
	await expect(panel(page)).toHaveCount(0)
})

test("beside Neptune a tap on the planet past the model's core selects Neptune, one on the core the craft", async ({
	page,
}) => {
	await ready(
		page,
		`/solar_system?craft=voyager2&follow=true&t=${T_NEPTUNE}&paused=true&lang=en`,
	)
	const model = await modelAtRest(page, "voyager2")
	const neptune = (await page.evaluate(() =>
		window.__orbitalia!.screenOf("neptune"),
	))!
	// from the craft towards Neptune's centre: the model is drawn over the disc
	const gap = Math.hypot(neptune.x - model.x, neptune.y - model.y)
	const toward = (px: number) => ({
		x: model.x + ((neptune.x - model.x) / gap) * px,
		y: model.y + ((neptune.y - model.y) / gap) * px,
	})
	const core = Math.max(12, model.corePx / 2)
	const canvas = (await page.locator("canvas").first().boundingBox())!
	const click = (at: { x: number; y: number }) =>
		page.mouse.click(canvas.x + at.x, canvas.y + at.y)

	// on the core, beyond the diamond's 12 px: the craft, drawn in front of
	// Neptune, takes it
	expect(core).toBeGreaterThan(14)
	await panel(page).getByRole("button", { name: "Close" }).click()
	await expect(panel(page)).toHaveCount(0)
	await click(toward((12 + core) / 2))
	await expect(panel(page)).toContainText("Voyager 2")

	// past the core but within the whole model (its boom reaches that far), on
	// Neptune's disc: Neptune's
	const past = (core + model.px / 2) / 2
	expect(past).toBeLessThan(model.px / 2)
	expect(gap - past).toBeLessThan(neptune.discPx)
	await click(toward(past))
	await expect
		.poll(() =>
			page.evaluate(() => window.__orbitalia!.store.getState().selectedId),
		)
		.toBe("neptune")
})

test("true scale shows the diamond, and the card explains why", async ({
	page,
}) => {
	await ready(page, `${FOLLOW}&scale=trueScale`)
	await page.waitForFunction(
		() => window.__orbitalia?.craftScreenOf("voyager1") != null,
		null,
		{ timeout: 60_000 },
	)
	await nextFrames(page, 10)
	await expect(probe(page, "voyager1")).toHaveAttribute("data-state", "diamond")
	await expect(panel(page).locator("[data-drawn=marker]")).toHaveText(
		"Shown as a marker: at its real size it would be far too small to see.",
	)
	// back to Everything visible: the model returns
	await page.evaluate(() =>
		window.__orbitalia!.scale.getState().setPreset("everythingVisible"),
	)
	await modelShown(page, "voyager1")
})

test("a visit that never shows a craft fetches neither models nor trajectories", async ({
	page,
}) => {
	const fetched: string[] = []
	page.on("request", (request) => fetched.push(request.url()))
	await ready(page, `/solar_system?t=${T_2026}&paused=true&lang=en`)
	await nextFrames(page, 30)
	const spacecraftFiles = () =>
		fetched.filter((url) => /\.glb$|spacecraftTrajectories/.test(url))
	expect(spacecraftFiles()).toEqual([])

	// the layer on, in the overview: the trajectories come, but no model (every
	// craft is a diamond from out there)
	await (
		await openLayers(page)
	)
		.getByRole("switch", { name: "Spacecraft" })
		.click()
	await expect
		.poll(() => fetched.some((url) => url.includes("spacecraftTrajectories")))
		.toBe(true)
	await expect
		.poll(() => page.locator("span[data-craft][data-visible=true]").count())
		.toBeGreaterThan(0)
	await nextFrames(page, 10)
	expect(fetched.filter((url) => url.endsWith(".glb"))).toEqual([])
	await expect(
		page.locator("[data-craft-model][data-state=model]"),
	).toHaveCount(0)
})

for (const viewport of [
	{ width: 390, height: 844 },
	{ width: 360, height: 640 },
]) {
	test.describe(`a phone held upright, ${viewport.width}x${viewport.height}`, () => {
		test.use({ viewport, hasTouch: true, isMobile: true })

		test("following Voyager 1 shows its model, and the card in the sheet says how much bigger it is drawn", async ({
			page,
		}) => {
			await ready(page, FOLLOW)
			expect(await modelShown(page, "voyager1")).toBeGreaterThanOrEqual(48)
			// the card is in the sheet (#60): raised, it shows the statement, whole
			await page.getByTestId("sheet-handle").tap()
			const sheet = page.getByTestId("sheet")
			await expect(sheet).not.toHaveAttribute("data-sheet-height", "small")
			const statement = panel(page).locator("[data-drawn=model]")
			await statement.scrollIntoViewIfNeeded()
			await expect(statement).toBeVisible()
			await expect(statement).toContainText("times bigger than it is")
			const box = (await statement.boundingBox())!
			const within = (await sheet.boundingBox())!
			expect(box.x).toBeGreaterThanOrEqual(within.x)
			expect(box.x + box.width).toBeLessThanOrEqual(within.x + within.width)
			expect(box.y).toBeGreaterThanOrEqual(within.y)
			expect(box.y + box.height).toBeLessThanOrEqual(within.y + within.height)
		})
	})
}
