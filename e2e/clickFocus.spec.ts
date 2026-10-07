import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"
import { expandCard } from "./support/hud"
import { cameraAtRest, nextFrames } from "./support/scene"

// Click a body to focus on it (#16), in the real browser: hover feedback,
// generous targets for tiny bodies (true scale, touch), the focused view's
// card with comparative facts, and the card's own close button, which leaves
// the camera where it is. A stray click never loses the view (#47): clicks
// and taps on empty space, the end of a pinch and the click that brings the
// window to the front leave the camera where it was; the way out (the home
// button here, Escape in navigation.spec.ts) is the way back.

const screenshotDir = path.join("test-results", "click-focus")

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

const state = (page: Page) =>
	page.evaluate(() => {
		const { view, selectedId, hoverId } = window.__orbitalia!.store.getState()
		return { view, selectedId, hoverId }
	})

/** The camera round its pivot, rounded: equal means it has not moved. */
const pose = (page: Page) =>
	page.evaluate(() => {
		const camera = window.__orbitalia!.camera()
		return [camera.distance, camera.azimuthDeg, camera.elevationDeg].map(
			(value) => value.toPrecision(5),
		)
	})

/** Where a body is on the page right now (the canvas fills the viewport). */
const screenOf = async (page: Page, id: string) => {
	const placement = await page.evaluate(
		(id) => window.__orbitalia!.screenOf(id),
		id,
	)
	expect(placement, `${id} on screen`).not.toBeNull()
	return placement!
}

/**
 * Points on the bare canvas (no HUD panel over them), on a 40 px grid, at
 * least `clearance` px from every listed body; at least one.
 */
const emptySpots = async (page: Page, ids: string[], clearance = 90) => {
	const spots = await page.evaluate(
		({ ids, clearance }) => {
			const bodies = ids.map((id) => window.__orbitalia!.screenOf(id))
			const found: { x: number; y: number }[] = []
			for (let y = 120; y < window.innerHeight - 160; y += 40) {
				for (let x = 40; x < window.innerWidth - 40; x += 40) {
					const clear = bodies.every(
						(b) =>
							b === null || Math.hypot(b.x - x, b.y - y) > b.ringPx + clearance,
					)
					if (clear && document.elementFromPoint(x, y)?.tagName === "CANVAS") {
						found.push({ x, y })
					}
				}
			}
			return found
		},
		{ ids, clearance },
	)
	expect(spots.length, "empty spots on screen").toBeGreaterThan(0)
	return spots
}

/** The Sun, the planets and the moons of Earth and Mars. */
const WORLDS = [
	"sun",
	"mercury",
	"venus",
	"earth",
	"moon",
	"mars",
	"phobos",
	"deimos",
	"jupiter",
	"saturn",
	"uranus",
	"neptune",
]

/** `count` of `spots`, spread over all of them (repeating when there are fewer). */
const spread = <T>(spots: T[], count: number): T[] =>
	Array.from(
		{ length: count },
		(_, i) => spots[Math.floor((i * spots.length) / count) % spots.length],
	)

/** `distance` px beyond a body, straight away from the Sun on screen. */
const beside = async (page: Page, id: string, distance: number) => {
	const body = await screenOf(page, id)
	const sun = await screenOf(page, "sun")
	const length = Math.hypot(body.x - sun.x, body.y - sun.y)
	return {
		body,
		x: body.x + ((body.x - sun.x) / length) * distance,
		y: body.y + ((body.y - sun.y) / length) * distance,
	}
}

const shot = async (page: Page, name: string) => {
	mkdirSync(screenshotDir, { recursive: true })
	await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) })
}

test("hovering a planet rings and names it; a click flies there and opens its card", async ({
	page,
}) => {
	await ready(page)
	await expect(page.getByTestId("click-hint")).toBeVisible()
	const saturn = await screenOf(page, "saturn")

	await page.mouse.move(saturn.x + 4, saturn.y + 3, { steps: 3 })
	await expect.poll(async () => (await state(page)).hoverId).toBe("saturn")
	const ring = page.getByTestId("hover-ring")
	await expect(ring).toBeVisible()
	await expect(ring).toContainText("Saturn")
	await expect(ring).toContainText("Click to fly there")
	await expect(page.locator("canvas")).toHaveCSS("cursor", "pointer")
	await shot(page, "hover-saturn")

	// its label (#20) is a click target too, with the same feedback
	await page.mouse.move(100, 600, { steps: 2 })
	await expect.poll(async () => (await state(page)).hoverId).toBeNull()
	const label = await page
		.locator('span[data-body="saturn"][data-visible="true"]')
		.boundingBox()
	expect(label).not.toBeNull()
	await page.mouse.move(
		label!.x + label!.width / 2,
		label!.y + label!.height / 2,
		{ steps: 3 },
	)
	await expect.poll(async () => (await state(page)).hoverId).toBe("saturn")
	await expect(ring).toBeVisible()
	await shot(page, "hover-saturn-label")

	await page.mouse.click(saturn.x + 4, saturn.y + 3)
	await expect.poll(async () => (await state(page)).selectedId).toBe("saturn")
	await settled(page)
	expect((await state(page)).view).toEqual({ kind: "body", id: "saturn" })
	await expect(page).toHaveURL(/[?&]focus=saturn(&|$)/)
	const card = page.getByTestId("body-card")
	await expect(card).toHaveAttribute("data-card-body", "saturn")
	await expect(card.getByRole("heading", { name: "Saturn" })).toBeVisible()
	// the card starts small (#42): name and one sentence, the facts on demand
	await expect(card.locator("[data-fact]")).toHaveCount(0)
	await expandCard(page)
	await expect(card).toContainText(/\d Earths wide/)
	await expect(card).toContainText("Sunlight takes")
	await expect(
		card.getByRole("link", { name: /Read more in the dictionary/ }),
	).toHaveAttribute("href", /\/solar_dictionary\?.*entity=6/)
	// the framed, selected focus is no click target any more
	await page.mouse.move(640, 360, { steps: 3 })
	await expect(ring).toBeHidden()
	await shot(page, "focused-saturn")
})

test("at true scale a sub-pixel planet is hit anywhere within its target", async ({
	page,
}) => {
	await ready(page)
	await page.evaluate(() =>
		window.__orbitalia!.scale.getState().setPreset("trueScale"),
	)
	// the camera follows the new scale on its next drawn frame, which a loaded machine may
	// not have drawn yet (until then screenOf still answers for the old scale): wait until
	// the camera has moved with it and come to rest, and Jupiter is back on screen
	await settled(page)
	await expect
		.poll(() => page.evaluate(() => window.__orbitalia!.screenOf("jupiter")))
		.not.toBeNull()
	// 9 px beside a planet far less than a pixel wide
	const aim = await beside(page, "jupiter", 9)
	expect(aim.body.discPx).toBeLessThan(1)
	await page.mouse.move(aim.x, aim.y, { steps: 3 })
	await expect.poll(async () => (await state(page)).hoverId).toBe("jupiter")
	await expect(page.getByTestId("hover-ring")).toBeVisible()
	await shot(page, "true-scale-hover-jupiter")
	await page.mouse.click(aim.x, aim.y)
	await expect.poll(async () => (await state(page)).selectedId).toBe("jupiter")
	await settled(page)
	expect((await state(page)).view).toEqual({ kind: "body", id: "jupiter" })
	// framed as a close-up although it was a speck
	expect((await screenOf(page, "jupiter")).discPx).toBeGreaterThan(40)
	await shot(page, "true-scale-focused-jupiter")
})

test("clicks on empty space never move the camera; the way out does, in one click", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=mars")
	expect((await state(page)).selectedId).toBe("mars")
	const card = page.getByTestId("body-card")
	await expect(card).toHaveAttribute("data-card-body", "mars")
	const mars = await screenOf(page, "mars")
	const before = await pose(page)

	// just beside the disc (a near miss), then 20 clicks all over empty space
	await page.mouse.click(mars.x + mars.discPx + 12, mars.y)
	const spots = await emptySpots(page, ["mars", "phobos", "deimos"])
	for (const spot of spread(spots, 20)) await page.mouse.click(spot.x, spot.y)
	// a way out would have started a flight by now: let any move land first
	await settled(page)
	expect(await state(page)).toMatchObject({
		view: { kind: "body", id: "mars" },
		selectedId: "mars",
	})
	expect(await pose(page)).toEqual(before)
	await expect(card).toHaveAttribute("data-card-body", "mars")

	// a world selected besides the one in view: an empty click lets go of it, the view stays
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().select("phobos"),
	)
	await expect(card).toHaveAttribute("data-card-body", "phobos")
	// well clear of every world a near miss could be aimed at
	const [clear] = await emptySpots(page, WORLDS, 50)
	await page.mouse.click(clear.x, clear.y)
	await expect.poll(async () => (await state(page)).selectedId).toBeNull()
	await expect(card).toHaveAttribute("data-card-body", "mars")
	expect((await state(page)).view).toEqual({ kind: "body", id: "mars" })

	// the way out: one click
	await page
		.getByRole("button", { name: "Back to overview", exact: true })
		.click()
	await expect.poll(async () => (await state(page)).view.kind).toBe("overview")
	await settled(page)
	await expect(page.getByTestId("click-hint")).toBeVisible()
})

test("the click that brings the window to the front does nothing", async ({
	page,
}) => {
	await ready(page)
	const saturn = await screenOf(page, "saturn")
	await page.mouse.move(saturn.x + 4, saturn.y + 3)
	await page.mouse.down()
	// the window comes into focus with this very press
	await page.evaluate(() => window.dispatchEvent(new FocusEvent("focus")))
	await page.mouse.up()
	await nextFrames(page)
	expect(await state(page)).toMatchObject({
		view: { kind: "overview" },
		selectedId: null,
	})

	// a moment later (FOCUS_CLICK_MS in scene/tap.ts), a click is a click again
	await page.waitForTimeout(600)
	await page.mouse.click(saturn.x + 4, saturn.y + 3)
	await expect.poll(async () => (await state(page)).selectedId).toBe("saturn")
})

test("the card's close button closes the card and keeps the camera", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=jupiter")
	const card = page.getByTestId("body-card")
	await expandCard(page)
	await expect(card).toContainText("11 Earths wide")
	await card.getByRole("button", { name: "Close" }).click()
	await expect(card).toBeHidden()
	await expect(page.getByTestId("click-hint")).toBeHidden()
	await settled(page)
	expect((await state(page)).view).toEqual({ kind: "body", id: "jupiter" })
	expect((await state(page)).selectedId).toBeNull()

	// clicking the planet again brings the card back
	const jupiter = await screenOf(page, "jupiter")
	await page.mouse.click(jupiter.x, jupiter.y)
	await expect(card.getByRole("heading", { name: "Jupiter" })).toBeVisible()
})

test.describe("on a phone", () => {
	test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

	test("a tap beside a small planet focuses it and the card folds its facts", async ({
		page,
	}) => {
		await ready(page)
		// a finger lands 16 px off
		const aim = await beside(page, "mars", 16)
		await page.touchscreen.tap(aim.x, aim.y)
		await expect.poll(async () => (await state(page)).selectedId).toBe("mars")
		await settled(page)
		expect((await state(page)).view).toEqual({ kind: "body", id: "mars" })
		// no hover ring for a finger
		await expect(page.getByTestId("hover-ring")).toBeHidden()

		const card = page.getByTestId("body-card")
		await expect(card.getByRole("heading", { name: "Mars" })).toBeVisible()
		await expect(card.locator("[data-fact]")).toHaveCount(0)
		await shot(page, "phone-folded")
		await card.getByRole("button", { name: "Show facts" }).tap()
		await expect(card.locator("[data-fact=size]")).toBeVisible()
		await shot(page, "phone-expanded")
	})

	test("taps on empty space keep the view, and the end of a pinch is no tap", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=mars")
		const before = await pose(page)
		const spots = await emptySpots(page, ["mars", "phobos", "deimos"], 60)
		for (const spot of spread(spots, 20)) {
			await page.touchscreen.tap(spot.x, spot.y)
		}
		await settled(page)
		expect(await state(page)).toMatchObject({
			view: { kind: "body", id: "mars" },
			selectedId: "mars",
		})
		expect(await pose(page)).toEqual(before)

		// in the overview, a gentle pinch with one finger on the Sun: the other finger
		// lifts first, then the one on the Sun, which must not count as a tap on it
		await page.getByRole("button", { name: "Back to overview" }).tap()
		await settled(page)
		const sun = await screenOf(page, "sun")
		const cdp = await page.context().newCDPSession(page)
		const fingers = (points: { x: number; y: number; id: number }[]) =>
			cdp.send("Input.dispatchTouchEvent", {
				type: points.length === 0 ? "touchEnd" : "touchMove",
				touchPoints: points,
			})
		const onSun = { x: sun.x, y: sun.y, id: 1 }
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [onSun, { x: sun.x, y: sun.y + 120, id: 2 }],
		})
		for (let spread = 2; spread <= 8; spread += 2) {
			await fingers([onSun, { x: sun.x, y: sun.y + 120 + spread, id: 2 }])
		}
		await fingers([onSun])
		await fingers([])
		await settled(page)
		expect(await state(page)).toMatchObject({
			view: { kind: "overview" },
			selectedId: null,
		})
	})
})
