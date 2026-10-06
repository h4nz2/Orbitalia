/**
 * Comets, asteroids and the outer belts (issue #23): the small bodies stay out of the
 * planets' overview until their layer is switched on, Pluto is findable and focusable by
 * name, and a comet grows a tail that points away from the Sun near perihelion and has
 * none far out.
 */
import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"
import { expandCard, openLayers } from "./support/hud"

const screenshotDir = path.join("test-results", "smallBodies")

const HALLEY_PERIHELION = 2446469.97

const state = (page: Page) =>
	page.evaluate(() => {
		const s = window.__orbitalia!.store.getState()
		return {
			focusId: s.focusId,
			selectedId: s.selectedId,
			showSmallBodies: s.showSmallBodies,
			timeWarp: s.timeWarp,
			paused: s.paused,
			simTimeJD: s.simTimeJD,
		}
	})

const ready = async (page: Page, query: string) => {
	await page.goto(`/solar_system?${query}`)
	await expect(page.locator("canvas").first()).toBeVisible()
	await page.waitForFunction(() => window.__orbitalia !== undefined)
	await cameraAtRest(page)
}

const HUD_HIDDEN =
	"body * { visibility: hidden !important } canvas { visibility: visible !important }"

/** Pixels of the scene alone that are clearly blue: the comet's gas tail and coma. */
const bluePixels = async (page: Page, name: string): Promise<number> => {
	mkdirSync(screenshotDir, { recursive: true })
	const png = await page.screenshot({
		path: path.join(screenshotDir, `${name}.png`),
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
		const data = context.getImageData(0, 0, canvas.width, canvas.height).data
		let blue = 0
		for (let o = 0; o < data.length; o += 4) {
			const [r, g, b] = [data[o], data[o + 1], data[o + 2]]
			if (b > 70 && b > r + 25 && b >= g) blue++
		}
		return blue
	}, png.toString("base64"))
}

test("the small bodies stay out of the overview until their layer is on", async ({
	page,
}) => {
	await ready(page, "")
	const pluto = page.locator("[data-body=pluto]")
	await expect(
		page.locator("[data-body=jupiter][data-visible=true]"),
	).toHaveCount(1)
	await expect(
		page.locator("[data-body=pluto][data-visible=true]"),
	).toHaveCount(0)
	await expect(page.getByTestId("small-bodies-legend")).toHaveCount(0)

	await openLayers(page)
	const layer = page.getByRole("switch", { name: "Small bodies" })
	await expect(layer).not.toBeChecked()
	await layer.click({ force: true })
	await expect(layer).toBeChecked()
	await expect(page).toHaveURL(/[?&]smallBodies=true(&|$)/)
	await expect(pluto).toHaveAttribute("data-visible", "true")
	// the legend says what the belt's dots stand for and how empty the belt is
	const legend = page.getByTestId("small-bodies-legend")
	await expect(legend).toContainText("Each dot stands for about 380 asteroids")
	await expect(legend).toContainText("1 million km apart")
	await expect(page.locator("[data-belt=asteroidbelt]").first()).toBeAttached()

	await layer.click({ force: true })
	await expect(page).not.toHaveURL(/smallBodies=/)
	await expect(pluto).not.toHaveAttribute("data-visible", "true")
})

test("Pluto is findable and focusable by name, with Charon beside it", async ({
	page,
}) => {
	await ready(page, "")
	const picker = page.getByRole("combobox", { name: "Focus body" })
	await picker.click()
	await picker.fill("Pluto")
	await page.getByRole("option", { name: /^Pluto/ }).click()
	await expect(page).toHaveURL(/[?&]focus=pluto(&|$)/)
	await cameraAtRest(page)
	const s = await state(page)
	expect(s.focusId).toBe("pluto")
	// shown although the layer is off: it is the focus
	expect(s.showSmallBodies).toBe(false)
	const card = page.getByTestId("body-card")
	await expect(card).toHaveAttribute("data-card-body", "pluto")
	// the card starts small (#42): the belt note and the moons are in its unfolded part
	await expandCard(page)
	await expect(card.getByRole("heading", { name: "Pluto" })).toBeVisible()
	// Pluto lives in the Kuiper belt: the card says what that belt is
	await expect(card.getByTestId("belt-note")).toContainText("Kuiper belt")
	// its moons come with it (drawing them is isBodyShown's, unit-tested): Charon is listed in the card
	await expect(card.getByRole("button", { name: "Charon" })).toBeVisible()
	await page.screenshot({ path: path.join(screenshotDir, "pluto.png") })
})

test("a comet's tail grows near the Sun, points away from it, and is gone far out", async ({
	page,
}) => {
	test.slow()
	// a month after Halley's 1986 perihelion, on its way out: the tail goes first
	await ready(
		page,
		`focus=halley&t=${HALLEY_PERIHELION + 30}&warp=1&cam=0_70_150&labels=false&orbits=false`,
	)
	const card = page.getByTestId("body-card")
	await expandCard(page)
	await expect(card.getByTestId("comet-tail")).toContainText(
		"so now the tail goes first",
	)
	const withTail = await bluePixels(page, "halley-1986")

	// Halley today, near the far end of its orbit: no coma, no tail
	await ready(
		page,
		`focus=halley&t=2461308.5&cam=0_70_150&labels=false&orbits=false`,
	)
	await expandCard(page)
	await expect(card.getByTestId("comet-tail")).toContainText(
		"No tail right now",
	)
	const withoutTail = await bluePixels(page, "halley-2026")
	expect(withTail).toBeGreaterThan(200)
	expect(withoutTail).toBeLessThan(withTail / 10)
})

test("one click watches a comet pass the Sun", async ({ page }) => {
	test.slow()
	await ready(page, "focus=halley&t=2461308.5")
	await expandCard(page)
	await page
		.getByTestId("body-card")
		.getByRole("button", { name: "Watch it pass the Sun" })
		.click()
	// it heads for the 2061 return at 1 week per second, forwards
	await expect.poll(async () => (await state(page)).timeWarp).toBe(604800)
	expect((await state(page)).paused).toBe(false)
	await expect
		.poll(async () => (await state(page)).simTimeJD, { timeout: 30_000 })
		.toBeGreaterThan(2473700)
	await expect(
		page.getByTestId("body-card").getByTestId("comet-tail"),
	).toContainText("Its tail is about", { timeout: 60_000 })
	expect((await state(page)).focusId).toBe("halley")
})

test("the small-body texts come in German too", async ({ page }) => {
	await ready(page, "smallBodies=true&lang=de&reading=simple")
	await openLayers(page)
	await expect(page.getByRole("switch", { name: "Kleinkörper" })).toBeChecked()
	await expect(page.getByTestId("small-bodies-legend")).toContainText(
		"Jeder Punkt steht für etwa 380 echte Felsbrocken",
	)
})
