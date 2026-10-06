import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"

// Re-centring the view and moving around freely (#15): panning away from a
// body into empty space with the mouse, a trackpad click and touch, the
// centre marker and badge, the way back, and the free centre in a link.

const screenshotDir = path.join("test-results", "recentre")

// software WebGL is slow and every step waits for the camera to come to rest
test.describe.configure({ timeout: 180_000 })

/** J2000, paused: the planets stand still where these tests expect them. */
const FIXED = "t=2451545&warp=1"

const ready = async (page: Page, url: string) => {
	await page.setViewportSize({ width: 1280, height: 720 })
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 30_000,
	})
	// time stands still, so a free centre stays exactly where it was put
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setPaused(true),
	)
	await settled(page)
}

/**
 * No transition, no pan in progress, and the controls have stopped damping
 * (counted in drawn frames, not milliseconds).
 */
const settled = (page: Page) => cameraAtRest(page)

const view = (page: Page) =>
	page.evaluate(() => window.__orbitalia!.store.getState().view)
const mode = async (page: Page) =>
	(await page.evaluate(() => window.__orbitalia!.camera())).mode

const shot = async (page: Page, name: string) => {
	mkdirSync(screenshotDir, { recursive: true })
	await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) })
}

/** A drag from the middle of the canvas by (dx, dy) with the given button. */
const drag = async (
	page: Page,
	dx: number,
	dy: number,
	options: { button?: "left" | "right"; shift?: boolean } = {},
) => {
	const { button = "right", shift = false } = options
	await page.mouse.move(640, 360)
	if (shift) await page.keyboard.down("Shift")
	await page.mouse.down({ button })
	for (let i = 1; i <= 10; i++) {
		await page.mouse.move(640 + (dx * i) / 10, 360 + (dy * i) / 10)
	}
	await page.mouse.up({ button })
	if (shift) await page.keyboard.up("Shift")
}

const badge = (page: Page) =>
	page.getByRole("status").filter({ hasText: "Free view" })

test("pans away from a planet into its neighbourhood and back with one click", async ({
	page,
}) => {
	await ready(page, `/solar_system?focus=mars&${FIXED}`)
	expect(await mode(page)).toBe("focused")

	// while panning the centre marker shows what the camera will orbit
	await page.mouse.move(640, 360)
	await page.mouse.down({ button: "right" })
	for (let i = 1; i <= 10; i++) await page.mouse.move(640 + 30 * i, 360)
	await expect(page.getByTestId("centre-marker")).toHaveAttribute(
		"data-visible",
		"true",
	)
	await page.mouse.up({ button: "right" })
	await expect
		.poll(() => view(page), { timeout: 20_000 })
		.toMatchObject({
			kind: "point",
			anchorId: "mars",
		})
	await settled(page)
	expect(await mode(page)).toBe("free")

	// the centre is named, the picker no longer claims Mars is centred, the link carries it
	await expect(badge(page)).toContainText("near Mars")
	await expect(page.getByRole("combobox", { name: "Focus body" })).toHaveValue(
		"",
	)
	await expect(page).toHaveURL(/[?&]focus=mars(&|$)/)
	await expect(page).toHaveURL(/[?&]at=[-\d._]+(&|$)/)
	await expect(page.getByTestId("centre-marker")).toHaveAttribute(
		"data-visible",
		"true",
	)
	await shot(page, "free-near-mars")

	// the link opens the same free centre
	const link = page.url()
	await page.goto(link)
	await page.waitForFunction(() => window.__orbitalia !== undefined)
	await settled(page)
	expect(await view(page)).toMatchObject({ kind: "point", anchorId: "mars" })
	await expect(badge(page)).toBeVisible()

	// orbiting a free centre is still just orbiting
	await drag(page, 120, 40, { button: "left" })
	await settled(page)
	expect(await view(page)).toMatchObject({ kind: "point", anchorId: "mars" })

	// one click back onto Mars
	await badge(page).getByRole("button", { name: "Centre on Mars" }).click()
	await settled(page)
	expect(await view(page)).toEqual({ kind: "body", id: "mars" })
	expect(await mode(page)).toBe("focused")
	await expect(badge(page)).toHaveCount(0)
	await expect(page).not.toHaveURL(/[?&]at=/)
	await expect(page.getByTestId("centre-marker")).toHaveAttribute(
		"data-visible",
		"false",
	)
})

test("a small pan does not lose the focused planet", async ({ page }) => {
	await ready(page, `/solar_system?focus=jupiter&${FIXED}`)
	await drag(page, 40, 25)
	await settled(page)
	expect(await view(page)).toEqual({ kind: "body", id: "jupiter" })
	expect(await mode(page)).toBe("focused")
})

test("pans out into interplanetary space with Shift + drag, and the home button brings it back", async ({
	page,
}) => {
	await ready(page, `/solar_system?${FIXED}`)
	expect(await mode(page)).toBe("overview")
	// a trackpad click or a one-button mouse: Shift + drag pans instead of orbiting
	const before = await page.evaluate(() => window.__orbitalia!.camera())
	await drag(page, -260, 170, { button: "left", shift: true })
	await expect
		.poll(() => view(page), { timeout: 20_000 })
		.toMatchObject({
			kind: "point",
		})
	await settled(page)
	const after = await page.evaluate(() => window.__orbitalia!.camera())
	// panned, not orbited
	expect(after.azimuthDeg).toBeCloseTo(before.azimuthDeg, 3)
	expect(after.elevationDeg).toBeCloseTo(before.elevationDeg, 3)
	await expect(badge(page)).toBeVisible()
	await shot(page, "free-interplanetary")

	await page.getByRole("button", { name: "Back to overview" }).first().click()
	await settled(page)
	expect(await view(page)).toEqual({ kind: "overview" })
	await expect(badge(page)).toHaveCount(0)
})

test.describe("touch", () => {
	test.use({ hasTouch: true })

	test("two fingers dragging together pan the centre", async ({ page }) => {
		await ready(page, `/solar_system?focus=saturn&${FIXED}`)
		const cdp = await page.context().newCDPSession(page)
		const touch = (type: "touchStart" | "touchMove" | "touchEnd", dx: number) =>
			cdp.send("Input.dispatchTouchEvent", {
				type,
				touchPoints:
					type === "touchEnd"
						? []
						: [
								{ x: 600 + dx, y: 360, id: 1 },
								{ x: 680 + dx, y: 360, id: 2 },
							],
			})
		await touch("touchStart", 0)
		for (let dx = 20; dx <= 360; dx += 20) await touch("touchMove", dx)
		await touch("touchEnd", 360)
		await expect
			.poll(() => view(page), { timeout: 20_000 })
			.toMatchObject({
				kind: "point",
				anchorId: "saturn",
			})
		await settled(page)
		await expect(badge(page)).toContainText("near Saturn")
		await shot(page, "touch-pan-saturn")
	})
})
