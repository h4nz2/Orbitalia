import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"
import { openLayers } from "./support/hud"
import { cameraAtRest, labelsAtRest } from "./support/scene"

// Body labels (#20) in the real browser: who is named where, the density
// rules, the switch, the i18n names, and that a label is a click target that
// never blocks a drag.

const screenshotDir = path.join("test-results", "labels")

// software WebGL is slow, and flights must land before anything is measured
test.describe.configure({ timeout: 180_000 })

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	await settled(page)
	// freeze the bodies so labels hold still while they are measured and clicked
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setPaused(true),
	)
	// labels fade in over 0.2 s of frame time: wait until they have, and hold still
	await labelsAtRest(page)
}

/** No transition, no pan pending, and the controls have stopped damping. */
const settled = (page: Page) => cameraAtRest(page)

/** The ids of the bodies whose labels are shown. */
const shownLabels = (page: Page) =>
	page
		.locator("[data-body][data-visible=true]")
		.evaluateAll((elements) =>
			elements.map((element) => (element as HTMLElement).dataset.body!),
		)

/** Boxes of every shown label (body names and orbit names). */
const shownBoxes = (page: Page) =>
	page.locator("[data-visible=true]").evaluateAll((elements) =>
		elements.map((element) => {
			const rect = element.getBoundingClientRect()
			return {
				id: (element as HTMLElement).dataset.body ?? "orbit",
				x0: rect.left,
				y0: rect.top,
				x1: rect.right,
				y1: rect.bottom,
			}
		}),
	)

const expectNoOverlap = async (page: Page) => {
	const boxes = await shownBoxes(page)
	for (const a of boxes) {
		for (const b of boxes) {
			if (a === b) continue
			const overlap =
				a.x0 < b.x1 - 0.5 &&
				a.x1 > b.x0 + 0.5 &&
				a.y0 < b.y1 - 0.5 &&
				a.y1 > b.y0 + 0.5
			expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false)
		}
	}
}

const shot = async (page: Page, name: string) => {
	mkdirSync(screenshotDir, { recursive: true })
	await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) })
}

const centreOf = async (page: Page, id: string) => {
	const box = await page.locator(`[data-body="${id}"]`).boundingBox()
	expect(box).not.toBeNull()
	return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
}

test("the overview names the Sun and the planets, and no moon", async ({
	page,
}) => {
	await ready(page, "/solar_system")
	const shown = await shownLabels(page)
	expect(shown).toEqual(
		expect.arrayContaining(["sun", "jupiter", "saturn", "uranus", "neptune"]),
	)
	const moons = await page
		.locator('[data-kind="moon"][data-visible=true]')
		.count()
	expect(moons).toBe(0)
	await expectNoOverlap(page)
	await shot(page, "overview")
})

test("approaching a planet names its largest moons, and only a few", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=jupiter&cam=0_30_4")
	const shown = await shownLabels(page)
	expect(shown).toEqual(
		expect.arrayContaining(["jupiter", "io", "europa", "ganymede", "callisto"]),
	)
	const moons = await page
		.locator('[data-kind="moon"][data-visible=true]')
		.count()
	expect(moons).toBeGreaterThanOrEqual(4)
	expect(moons).toBeLessThanOrEqual(8)
	await expectNoOverlap(page)
	await shot(page, "jupiter")
})

test("one switch hides every label, and a link carries it", async ({
	page,
}) => {
	await ready(page, "/solar_system")
	await openLayers(page)
	await page.getByRole("switch", { name: "Labels" }).click({ force: true })
	await expect(page).toHaveURL(/[?&]labels=false/)
	await expect(page.locator("[data-visible=true]")).toHaveCount(0)
	await expect(page.locator("[data-body]").first()).toBeHidden()

	await ready(page, "/solar_system?labels=false")
	await expect(page.locator("[data-visible=true]")).toHaveCount(0)
	await openLayers(page)
	await page.getByRole("switch", { name: "Labels" }).click({ force: true })
	await expect(page.locator('[data-body="saturn"]')).toHaveAttribute(
		"data-visible",
		"true",
	)
})

test("names come from the i18n layer", async ({ page }) => {
	await ready(page, "/solar_system?lang=de&focus=earth&cam=0_20_3")
	await expect(page.locator('[data-body="earth"]')).toHaveText("Erde")
	await expect(page.locator('[data-body="moon"]')).toHaveText("Mond")
	await expect(page.locator('[data-body="earth"]')).toHaveAttribute(
		"data-visible",
		"true",
	)
})

test("a label is a click target: hover shows it, a tap focuses the body", async ({
	page,
}) => {
	await ready(page, "/solar_system")
	const saturn = await centreOf(page, "saturn")
	await page.mouse.move(saturn.x, saturn.y)
	await expect
		.poll(() =>
			page.evaluate(() => window.__orbitalia!.store.getState().hoverId),
		)
		.toBe("saturn")
	await expect(page.locator("canvas")).toHaveCSS("cursor", "pointer")
	await expect(page.locator('[data-body="saturn"]')).toHaveAttribute(
		"data-hovered",
		"true",
	)
	await page.mouse.click(saturn.x, saturn.y)
	await expect
		.poll(() =>
			page.evaluate(() => window.__orbitalia!.store.getState().focusId),
		)
		.toBe("saturn")
	await expect(page).toHaveURL(/[?&]focus=saturn/)
})

test("a drag that starts on a label still turns the camera", async ({
	page,
}) => {
	await ready(page, "/solar_system")
	const before = await page.evaluate(() => window.__orbitalia!.camera())
	const jupiter = await centreOf(page, "jupiter")
	await page.mouse.move(jupiter.x, jupiter.y)
	await page.mouse.down()
	await page.mouse.move(jupiter.x + 150, jupiter.y + 20, { steps: 8 })
	await page.mouse.up()
	await settled(page)
	const after = await page.evaluate(() => window.__orbitalia!.camera())
	expect(Math.abs(after.azimuthDeg - before.azimuthDeg)).toBeGreaterThan(5)
	expect(
		await page.evaluate(() => window.__orbitalia!.store.getState().focusId),
	).toBe("sun")
})

test("orbit names are optional and written on the orbits", async ({ page }) => {
	await ready(page, "/solar_system?orbitNames=true")
	const orbitNames = page.locator("[data-orbit][data-visible=true]")
	await expect(orbitNames.first()).toBeVisible()
	expect(await orbitNames.count()).toBeGreaterThanOrEqual(3)
	await expectNoOverlap(page)
	await shot(page, "orbit-names")
	await openLayers(page)
	await page.getByRole("switch", { name: "Orbit names" }).click({ force: true })
	await expect(page).not.toHaveURL(/orbitNames/)
	await expect(page.locator("[data-orbit]")).toHaveCount(0)
})
