import { expect, test, type Page } from "@playwright/test"

import { openTool } from "./support/hud"
import { cameraAtRest, nextFrames } from "./support/scene"

// Riding along with a spacecraft (#57): the camera follows a craft, keeping
// it centred while time runs; Watch on a flyby sets the time and the speed
// and follows; the view turns and zooms without ending it; the way out, a
// world chosen and Back end it and give back normal control; and the link
// reopens the same follow view. Every date is pinned in the links.

// software WebGL is slow, and flights and time glides must land first
test.describe.configure({ timeout: 240_000 })

/** 25 September 2026, 00:00 UTC. */
const T_2026 = 2461308.5
/** Voyager 1 shortly before Jupiter, as Watch starts it in Everything visible (the help page's link). */
const WATCH_START = 2443901.1808
const FOLLOW_LINK = `/solar_system?craft=voyager1&follow=true&focus=jupiter&t=${WATCH_START}&cam=-122.1_65_3.21&lang=en`

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	await cameraAtRest(page)
}

/** The craft drawn on screen (it is drawn once its trajectory has loaded). */
const craftDrawn = (page: Page) =>
	page.waitForFunction(
		() => window.__orbitalia?.craftScreenOf("voyager1") != null,
		null,
		{ timeout: 60_000 },
	)

/** How far (px) Voyager 1 is drawn from the middle of the canvas. */
const offCentre = (page: Page) =>
	page.evaluate(() => {
		const at = window.__orbitalia!.craftScreenOf("voyager1")
		const canvas = document.querySelector("canvas")!
		if (at === null) return Infinity
		return Math.hypot(
			at.x - canvas.clientWidth / 2,
			at.y - canvas.clientHeight / 2,
		)
	})

const state = (page: Page) =>
	page.evaluate(() => {
		const handle = window.__orbitalia!
		const { view, simTimeJD, timeWarp, paused, shot } = handle.store.getState()
		const camera = handle.camera()
		return {
			view,
			simTimeJD,
			timeWarp,
			paused,
			shot,
			distance: camera.distance,
			azimuthDeg: camera.azimuthDeg,
			mode: camera.mode,
		}
	})

/** The "what you are looking at" spot: the focus picker, which names the followed craft. */
const spot = (page: Page) =>
	page.locator("[data-testid=where] input[role=combobox]")

const panel = (page: Page) =>
	page.getByRole("region", { name: "Selected spacecraft" })

test("a followed craft stays centred while time runs, and the view still turns and zooms", async ({
	page,
}) => {
	await ready(page, `${FOLLOW_LINK}&warp=172800`)
	await craftDrawn(page)
	await cameraAtRest(page)
	expect((await state(page)).view).toMatchObject({
		kind: "craft",
		id: "voyager1",
	})
	// the spot names the craft, with the follow mark; its card is open
	await expect(spot(page)).toHaveAttribute("placeholder", "Voyager 1")
	await expect(spot(page)).toHaveAttribute("data-following", "voyager1")
	await expect(page.locator("[data-follow-mark]")).toBeVisible()
	await expect(panel(page)).toContainText("Voyager 1")
	await expect(panel(page).locator("[data-fact=nearest]")).toContainText(
		"Jupiter",
	)

	// time runs at 2 days/s: the craft moves through Jupiter's neighbourhood
	// and stays in the middle of the screen the whole time
	const start = (await state(page)).simTimeJD
	for (let i = 0; i < 6; i++) {
		await page.waitForTimeout(500)
		expect(await offCentre(page)).toBeLessThan(2)
	}
	expect((await state(page)).simTimeJD).toBeGreaterThan(start + 1)

	// turn and zoom: still following, still centred, the camera where the user put it
	const before = await state(page)
	await page.mouse.move(900, 500)
	await page.mouse.down()
	await page.mouse.move(1020, 470, { steps: 8 })
	await page.mouse.up()
	await page.mouse.wheel(0, 300)
	await cameraAtRest(page)
	const after = await state(page)
	expect(after.view).toMatchObject({ kind: "craft", id: "voyager1" })
	expect(after.mode).toBe("following")
	expect(Math.abs(after.azimuthDeg - before.azimuthDeg)).toBeGreaterThan(5)
	expect(after.distance).toBeGreaterThan(1.1 * before.distance)
	expect(await offCentre(page)).toBeLessThan(2)
	// panning does not move the centre off the craft
	await page.mouse.move(900, 500)
	await page.mouse.down({ button: "right" })
	await page.mouse.move(1000, 560, { steps: 8 })
	await page.mouse.up({ button: "right" })
	await cameraAtRest(page)
	expect((await state(page)).view).toMatchObject({ kind: "craft" })
	expect(await offCentre(page)).toBeLessThan(2)
})

test("Watch on Voyager 1's Jupiter flyby goes there, picks the speed and rides along", async ({
	page,
}) => {
	await ready(page, `/solar_system?t=${T_2026}&lang=en`)
	await openTool(page, "spacecraft")
	await page.locator("button[data-craft=voyager1]").click()
	await cameraAtRest(page)
	await panel(page)
		.getByRole("button", { name: "Watch: Flies past Jupiter" })
		.click()
	// time glides back to shortly before the closest approach and runs on
	await page.waitForFunction(
		() => window.__orbitalia!.store.getState().clock.glide === null,
		null,
		{ timeout: 60_000 },
	)
	await craftDrawn(page)
	await cameraAtRest(page)
	const watched = await state(page)
	expect(watched.view).toMatchObject({ kind: "craft", id: "voyager1" })
	expect(watched.paused).toBe(false)
	// 2 days/s: in Everything visible the drawn passage takes about 34 s
	expect(watched.timeWarp).toBe(172800)
	expect(watched.simTimeJD).toBeGreaterThan(WATCH_START)
	// the closest approach (5 March 1979, 12:05) is still ahead
	expect(watched.simTimeJD).toBeLessThan(2443938)
	await expect(page.getByTestId("time-menu")).toHaveAccessibleName(/2 days\/s$/)
	await expect(spot(page)).toHaveAttribute("data-following", "voyager1")
	expect(await offCentre(page)).toBeLessThan(2)
	// Watch is a step: Back returns to where the view was before
	await expect(page.getByTestId("back-button")).toHaveAttribute(
		"aria-disabled",
		"false",
	)
})

test("the way out, or a world chosen, ends following and gives back normal control", async ({
	page,
}) => {
	await ready(page, `${FOLLOW_LINK}&paused=true`)
	await craftDrawn(page)
	await page.keyboard.press("Escape")
	await cameraAtRest(page)
	const out = await state(page)
	expect(out.view).toEqual({ kind: "overview" })
	expect(out.mode).toBe("overview")
	await expect(spot(page)).not.toHaveAttribute("data-following")
	// a pan moves the centre again (it was held on the craft while following)
	await page.mouse.move(700, 450)
	await page.mouse.down({ button: "right" })
	await page.mouse.move(900, 520, { steps: 10 })
	await page.mouse.up({ button: "right" })
	await cameraAtRest(page)
	expect((await state(page)).view.kind).toBe("point")

	// following again, then a world chosen in the picker: there it goes
	await ready(page, `${FOLLOW_LINK}&paused=true`)
	await craftDrawn(page)
	const picker = page.getByRole("combobox", { name: "Following Voyager 1" })
	await picker.click()
	await picker.fill("Saturn")
	await page.getByRole("option", { name: /^Saturn/ }).click()
	await expect
		.poll(async () => (await state(page)).view)
		.toEqual({ kind: "body", id: "saturn" })
	await expect(spot(page)).not.toHaveAttribute("data-following")
})

test("the link reopens the same follow view", async ({ page, context }) => {
	await ready(page, `${FOLLOW_LINK}&paused=true`)
	await craftDrawn(page)
	// turn the view a little, as a teacher preparing a lesson would
	await page.mouse.move(900, 500)
	await page.mouse.down()
	await page.mouse.move(980, 520, { steps: 6 })
	await page.mouse.up()
	await cameraAtRest(page)
	await nextFrames(page, 5)
	const taken = await state(page)
	const url = page.url()
	expect(url).toContain("craft=voyager1")
	expect(url).toContain("follow=true")

	const again = await context.newPage()
	await ready(again, url.replace(/^https?:\/\/[^/]+/, ""))
	await craftDrawn(again)
	await cameraAtRest(again)
	const reopened = await state(again)
	expect(reopened.view).toMatchObject({ kind: "craft", id: "voyager1" })
	expect(reopened.simTimeJD).toBeCloseTo(taken.simTimeJD, 3)
	expect(reopened.shot).toEqual(taken.shot)
	expect(reopened.distance / taken.distance).toBeCloseTo(1, 2)
	expect(Math.abs(reopened.azimuthDeg - taken.azimuthDeg)).toBeLessThan(0.2)
	expect(await offCentre(again)).toBeLessThan(2)
	await expect(spot(again)).toHaveAttribute("data-following", "voyager1")
})

test("following is a step: Back ends it and returns to the view before", async ({
	page,
}) => {
	await ready(
		page,
		`/solar_system?focus=jupiter&t=${WATCH_START}&paused=true&lang=en`,
	)
	await openTool(page, "spacecraft")
	await page.locator("button[data-follow=voyager1]").click()
	await craftDrawn(page)
	await cameraAtRest(page)
	expect((await state(page)).view).toMatchObject({
		kind: "craft",
		id: "voyager1",
	})
	await expect(
		panel(page).locator("button[data-follow=voyager1]"),
	).toHaveAttribute("aria-pressed", "true")
	await page.getByTestId("back-button").click()
	await expect
		.poll(async () => (await state(page)).view)
		.toEqual({ kind: "body", id: "jupiter" })
	await cameraAtRest(page)
	await expect(spot(page)).not.toHaveAttribute("data-following")
	// and Forward rides along again
	await page.goForward()
	await expect
		.poll(async () => (await state(page)).view)
		.toMatchObject({ kind: "craft", id: "voyager1" })
})
