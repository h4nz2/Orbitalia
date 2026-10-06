import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"

// The selection and camera navigation model (#10), in the real browser. The
// model is driven through the UI and through the store exposed on
// `window.__orbitalia` (the acceptance criterion: select -> focus -> overview
// programmatically, with no feature code touching the camera), and every
// check reads the camera director's own snapshot.

const screenshotDir = path.join("test-results", "navigation")

// software WebGL is slow and every step here waits for real flights to land
test.describe.configure({ timeout: 180_000 })

const ready = async (page: Page, url = "/solar_system") => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 30_000,
	})
	await settled(page)
}

/**
 * Waits until no transition runs, no pan waits to be committed and the
 * controls have stopped damping (counted in drawn frames, not milliseconds).
 */
const settled = (page: Page) => cameraAtRest(page)

const camera = (page: Page) => page.evaluate(() => window.__orbitalia!.camera())
const state = (page: Page) =>
	page.evaluate(() => {
		const { view, selectedId, focusId, sequence } =
			window.__orbitalia!.store.getState()
		return { view, selectedId, focusId, sequence }
	})

/** The camera is settled, finite, and orbits exactly its pivot. */
const expectHealthy = async (page: Page, mode: string, focusId: string) => {
	const snap = await camera(page)
	expect(snap.mode).toBe(mode)
	expect(snap.finite).toBe(true)
	expect(Math.hypot(...snap.targetUnits)).toBeLessThan(1e-6 * snap.distance)
	expect((await state(page)).focusId).toBe(focusId)
}

const waitForProgress = (page: Page, at: number) =>
	page.waitForFunction(
		(at) => (window.__orbitalia?.camera().progress ?? 0) >= at,
		at,
		{ timeout: 60_000 },
	)

const shot = async (page: Page, name: string) => {
	mkdirSync(screenshotDir, { recursive: true })
	await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) })
}

test("opens on the overview and always has a way back to it", async ({
	page,
}) => {
	await ready(page)
	await expectHealthy(page, "overview", "sun")
	await expect(page).not.toHaveURL(/[?&]focus=/)
	await shot(page, "overview")

	// focus a body from the picker
	const picker = page.getByRole("combobox", { name: "Focus body" })
	await picker.click()
	await picker.fill("Saturn")
	await page.getByRole("option", { name: /^Saturn/ }).click()
	await expect(page).toHaveURL(/[?&]focus=saturn(&|$)/)
	await settled(page)
	await expectHealthy(page, "focused", "saturn")
	await shot(page, "saturn")

	// the visible control
	await page.getByRole("button", { name: "Back to overview" }).click()
	await settled(page)
	await expectHealthy(page, "overview", "sun")
	expect((await state(page)).selectedId).toBeNull()
	await expect(page).not.toHaveURL(/[?&]focus=/)

	// Escape, in the middle of a flight
	await page.keyboard.press("ArrowRight")
	await expect.poll(async () => (await camera(page)).mode).toBe("transit")
	await page.keyboard.press("Escape")
	await settled(page)
	await expectHealthy(page, "overview", "sun")
})

test("drives select -> focus -> overview through the store, the camera only following", async ({
	page,
}) => {
	await ready(page)
	const home = (await camera(page)).cameraKm

	await page.evaluate(() => window.__orbitalia!.store.getState().select("mars"))
	await expect(page).toHaveURL(/[?&]sel=mars(&|$)/)
	// the info panel follows the selection; the camera does not move
	await expect(
		page
			.getByRole("region", { name: "Focused body" })
			.getByRole("heading", { name: "Mars" }),
	).toBeVisible()
	const still = await camera(page)
	expect(still.mode).toBe("overview")
	expect(still.cameraKm).toEqual(home)

	await page.evaluate(() => window.__orbitalia!.store.getState().focus("mars"))
	await settled(page)
	await expectHealthy(page, "focused", "mars")
	await expect(page).toHaveURL(/[?&]focus=mars(&|$)/)
	await expect(page).not.toHaveURL(/[?&]sel=/)

	await page.evaluate(() => window.__orbitalia!.store.getState().overview())
	await settled(page)
	await expectHealthy(page, "overview", "sun")
	// the overview keeps the selection
	await expect(page).toHaveURL(/[?&]sel=mars(&|$)/)
})

test("interrupting a flight at any point never strands the camera", async ({
	page,
}) => {
	await ready(page)
	const interruptions: [string, () => Promise<void>, string, string][] = [
		[
			"a second selection",
			() =>
				page.evaluate(() =>
					window.__orbitalia!.store.getState().setFocus("mars"),
				),
			"focused",
			"mars",
		],
		[
			"the overview",
			() =>
				page.evaluate(() => window.__orbitalia!.store.getState().overview()),
			"overview",
			"sun",
		],
		["Escape", () => page.keyboard.press("Escape"), "overview", "sun"],
		[
			"a drag on the canvas",
			async () => {
				await page.mouse.move(400, 360)
				await page.mouse.down()
				await page.mouse.move(520, 330, { steps: 6 })
				await page.mouse.up()
			},
			"focused",
			"jupiter",
		],
		[
			"a skip",
			() => page.evaluate(() => window.__orbitalia!.store.getState().skip()),
			"focused",
			"jupiter",
		],
	]
	for (const [name, interrupt, mode, focusId] of interruptions) {
		await test.step(name, async () => {
			await page.evaluate(() =>
				// a long flight, so the slow headless page catches it mid-air
				window
					.__orbitalia!.store.getState()
					.focus("jupiter", { durationMs: 6000 }),
			)
			await waitForProgress(page, 0.2)
			await interrupt()
			await settled(page)
			await expectHealthy(page, mode, focusId)
			// back to a known start for the next case
			await page.evaluate(() => window.__orbitalia!.store.getState().reset())
			await settled(page)
		})
	}
})

test("a shared link opens on the exact view, and moving the camera updates the link", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=jupiter&sel=io&cam=-40_15_2")
	await expectHealthy(page, "focused", "jupiter")
	const snap = await camera(page)
	expect(snap.azimuthDeg).toBeCloseTo(-40, 6)
	expect(snap.elevationDeg).toBeCloseTo(15, 6)
	expect((await state(page)).selectedId).toBe("io")
	await expect(page).toHaveURL(/[?&]cam=-40_15_2(&|$)/)
	await shot(page, "shared-link")

	// orbit the camera: the link follows once it comes to rest
	await page.mouse.move(700, 400)
	await page.mouse.down()
	await page.mouse.move(820, 380, { steps: 8 })
	await page.mouse.up()
	await expect(page).toHaveURL(/[?&]cam=/)
	await expect(page).not.toHaveURL(/[?&]cam=-40_15_2(&|$)/, { timeout: 5000 })
})

test("a click selects, a drag that ends on a body does not", async ({
	page,
}) => {
	await ready(page)
	const centre = { x: 640, y: 360 }
	// in the overview the Sun sits in the middle of the screen
	await page.mouse.move(centre.x + 80, centre.y)
	await page.mouse.down()
	await page.mouse.move(centre.x, centre.y, { steps: 8 })
	await page.mouse.up()
	// the drag's orbit has glided out: any click it produced has long been handled
	await settled(page)
	expect((await state(page)).selectedId).toBeNull()
	expect((await camera(page)).mode).toBe("overview")

	await page.mouse.click(centre.x, centre.y)
	await expect.poll(async () => (await state(page)).selectedId).toBe("sun")
	await settled(page)
	await expectHealthy(page, "focused", "sun")
})

test("the cursor turns into a pointer over a body a click would focus", async ({
	page,
}) => {
	await ready(page)
	const canvas = page.locator("canvas").first()
	await page.mouse.move(100, 360)
	await expect(canvas).toHaveCSS("cursor", "auto")
	// in the overview the Sun sits in the middle of the screen
	await page.mouse.move(640, 360, { steps: 4 })
	await expect(canvas).toHaveCSS("cursor", "pointer")

	// focused and selected, the Sun is no click target any more
	await page.mouse.click(640, 360)
	await expect.poll(async () => (await state(page)).selectedId).toBe("sun")
	await expect(canvas).toHaveCSS("cursor", "auto")
})

test.describe("touch and trackpad", () => {
	test.use({ hasTouch: true })

	test("a tap selects, a pinch and a trackpad pinch zoom", async ({ page }) => {
		await ready(page, "/solar_system?focus=earth")
		await expectHealthy(page, "focused", "earth")
		const before = (await camera(page)).distance

		// two fingers spreading apart: closer
		const cdp = await page.context().newCDPSession(page)
		const touch = (
			type: "touchStart" | "touchMove" | "touchEnd",
			spread: number,
		) =>
			cdp.send("Input.dispatchTouchEvent", {
				type,
				touchPoints:
					type === "touchEnd"
						? []
						: [
								{ x: 600 - spread, y: 360, id: 1 },
								{ x: 680 + spread, y: 360, id: 2 },
							],
			})
		await touch("touchStart", 0)
		for (let spread = 10; spread <= 120; spread += 10) {
			await touch("touchMove", spread)
		}
		await touch("touchEnd", 120)
		await settled(page)
		const pinched = (await camera(page)).distance
		expect(pinched).toBeLessThan(before)
		await expectHealthy(page, "focused", "earth")

		// a trackpad pinch (ctrl + wheel) dollies too, and never zooms the page
		await page.mouse.move(640, 360)
		await page.keyboard.down("Control")
		await page.mouse.wheel(0, 200)
		await page.keyboard.up("Control")
		await settled(page)
		expect((await camera(page)).distance).toBeGreaterThan(pinched)
		expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1)

		// back in the overview, a tap on the Sun selects (and focuses) it
		await page.getByRole("button", { name: "Back to overview" }).tap()
		await settled(page)
		await page.touchscreen.tap(640, 360)
		await expect.poll(async () => (await state(page)).selectedId).toBe("sun")
		await settled(page)
		await expectHealthy(page, "focused", "sun")
	})
})

test("a scripted sequence plays, can be interrupted, resumed and skipped", async ({
	page,
}) => {
	await ready(page)
	await page.evaluate(() =>
		window
			.__orbitalia!.store.getState()
			.playSequence([
				{ view: { kind: "body", id: "earth" }, holdMs: 300 },
				{ view: { kind: "body", id: "moon" }, holdMs: 300 },
				{ view: { kind: "overview" } },
			]),
	)
	await expect
		.poll(async () => (await state(page)).sequence?.index, { timeout: 60_000 })
		.toBe(1)
	// the user grabs the camera: the sequence waits where it was
	await page.mouse.move(640, 360)
	await page.mouse.down()
	await page.mouse.move(700, 360, { steps: 4 })
	await page.mouse.up()
	await expect
		.poll(async () => (await state(page)).sequence?.phase)
		.toBe("interrupted")
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().resumeSequence(),
	)
	await expect
		.poll(async () => (await state(page)).sequence?.index, { timeout: 60_000 })
		.toBe(2)
	await page.evaluate(() => window.__orbitalia!.store.getState().skip())
	await settled(page)
	await expectHealthy(page, "overview", "sun")
	expect((await state(page)).sequence).toBeNull()
})
