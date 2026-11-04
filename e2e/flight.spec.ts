import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"

// Fly between planets (#18), in the real browser: a second selection flies
// (pull back, travel, descend) with nothing on screen but the flight, a screen
// reader hears where it goes, and the flight can be retargeted and abandoned
// with Escape.

// software WebGL is slow and every step here waits for real flights to land
test.describe.configure({ timeout: 180_000 })

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 30_000,
	})
	await cameraAtRest(page)
}

const camera = (page: Page) => page.evaluate(() => window.__orbitalia!.camera())

/**
 * Starts a slow flight (so the headless page can watch it) the way a click
 * does, plus a duration: long enough that a loaded machine still catches it
 * mid-air, and every one of them is ended early by the test.
 */
const flySlowly = (page: Page, id: string, durationMs = 40_000) =>
	page.evaluate(
		({ id, durationMs }) => {
			const store = window.__orbitalia!.store.getState()
			store.select(id)
			store.focus(id, { profile: "fly", durationMs })
		},
		{ id, durationMs },
	)

const waitForProgress = (page: Page, at: number) =>
	page.waitForFunction(
		(at) => (window.__orbitalia!.camera().progress ?? 0) >= at,
		at,
		{ timeout: 60_000, polling: "raf" },
	)

interface FlightLog {
	/** The farthest the camera got from its pivot, scene units. */
	farthest: number
	/** Frames seen with the camera on its way. */
	moving: number
	/** The most panels seen at the time bar's place while the camera moved. */
	atTheTime: number
}

/**
 * Watches every frame from now on: how far the camera pulls back, and whether
 * a panel comes up beside the time bar while it moves. A flight at its own
 * speed lasts 2.5-5 s of real time, which a loaded machine can spend before a
 * single check has run, so what only shows mid-flight is recorded as it happens.
 */
const recordFlight = (page: Page) =>
	page.evaluate(() => {
		const log: FlightLog = { farthest: 0, moving: 0, atTheTime: 0 }
		;(window as unknown as { flightLog: FlightLog }).flightLog = log
		const watch = () => {
			const camera = window.__orbitalia?.camera()
			if (camera !== undefined) {
				log.farthest = Math.max(log.farthest, camera.distance)
			}
			if (camera?.progress !== null && camera?.progress !== undefined) {
				log.moving += 1
				const time = document.querySelector("[data-sheet-above]")
				log.atTheTime = Math.max(log.atTheTime, time?.childElementCount ?? 0)
			}
			requestAnimationFrame(watch)
		}
		requestAnimationFrame(watch)
	})

const flightLog = (page: Page) =>
	page.evaluate(() => (window as unknown as { flightLog: FlightLog }).flightLog)

/** Until the watcher has seen the camera on its way, then until it lands. */
const landed = async (page: Page) => {
	await page.waitForFunction(
		() => (window as unknown as { flightLog: FlightLog }).flightLog.moving > 0,
		null,
		{ timeout: 60_000 },
	)
	await cameraAtRest(page)
	return camera(page)
}

/** While the camera moved, only the time bar sat at its place. */
const expectNoBox = async (page: Page) => {
	expect((await flightLog(page)).atTheTime).toBe(1)
	await expect(page.getByTestId("flight-readout")).toHaveCount(0)
}

const liveRegion = (page: Page) => page.locator("[data-announcer]")

/** From now on, everything the live region is given to read. */
const listenToLiveRegion = (page: Page) =>
	page.evaluate(() => {
		const heard: string[] = []
		;(window as unknown as { heard: string[] }).heard = heard
		new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					heard.push(node.textContent ?? "")
				}
			}
		}).observe(document.querySelector("[data-announcer]")!, {
			childList: true,
		})
	})

const heard = (page: Page) =>
	page.evaluate(() => (window as unknown as { heard: string[] }).heard)

test("a second selection flies there, pulling far back on the way, and brings no box", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=earth")
	const start = (await camera(page)).distance

	// the picker, like any selection from a focused body, starts the flight
	await page.getByRole("combobox", { name: "Focus body" }).click()
	await recordFlight(page)
	await page.getByRole("option", { name: /^Jupiter/ }).click()

	const end = await landed(page)
	// on the way the camera pulled far back
	expect((await flightLog(page)).farthest).toBeGreaterThan(100 * start)
	await expectNoBox(page)
	expect(end.mode).toBe("focused")
	expect(end.distance).toBeLessThan(10 * start)
	await expect(page).toHaveURL(/[?&]focus=jupiter(&|$)/)
	await expect(liveRegion(page)).toHaveText("Now showing Jupiter")
})

test("a screen reader hears each destination once, from a flight or from a presenter's key", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=earth")
	await listenToLiveRegion(page)

	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setFocus("jupiter"),
	)
	await expect.poll(() => heard(page)).toEqual(["Now showing Jupiter"])
	await cameraAtRest(page)

	// the key says it itself, and moves without a flight of its own
	await page.keyboard.press("6")
	await cameraAtRest(page)
	expect(await heard(page)).toEqual([
		"Now showing Jupiter",
		"Now showing Saturn",
	])

	// Back says so at once, and the flight says where to when it leaves
	await page.keyboard.press("Backspace")
	await expect
		.poll(() => heard(page))
		.toEqual([
			"Now showing Jupiter",
			"Now showing Saturn",
			"Back to the view before",
			"Now showing Jupiter",
		])
	await cameraAtRest(page)
	expect((await heard(page)).length).toBe(4)
})

test("a flight can be retargeted and abandoned", async ({ page }) => {
	await ready(page, "/solar_system?focus=earth")

	// a third selection mid-flight turns round from where the camera is
	await flySlowly(page, "neptune")
	await waitForProgress(page, 0.2)
	const turned = await page.evaluate(async () => {
		const orbitalia = window.__orbitalia!
		const high = orbitalia.camera().distance
		orbitalia.store.getState().setFocus("mars")
		const profile = orbitalia.store.getState().transition?.profile
		await new Promise(requestAnimationFrame)
		await new Promise(requestAnimationFrame)
		return { profile, high, next: orbitalia.camera().distance }
	})
	expect(turned.profile).toBe("fly")
	// no snap back: the new flight starts high up, where the camera was
	expect(turned.next).toBeGreaterThan(turned.high / 2)
	await cameraAtRest(page)
	expect((await camera(page)).mode).toBe("focused")
	expect(
		await page.evaluate(() => window.__orbitalia!.store.getState().focusId),
	).toBe("mars")

	// Escape mid-flight: the way out
	await flySlowly(page, "venus")
	await waitForProgress(page, 0.3)
	await page.keyboard.press("Escape")
	await cameraAtRest(page)
	expect((await camera(page)).mode).toBe("overview")
})

test("true scale, in German at the simple reading level", async ({ page }) => {
	await ready(
		page,
		"/solar_system?focus=earth&scale=trueScale&lang=de&reading=simple",
	)
	const start = (await camera(page)).distance
	await recordFlight(page)
	await flySlowly(page, "moon", 8000)
	expect((await landed(page)).mode).toBe("focused")
	await expect(page).toHaveURL(/[?&]focus=moon(&|$)/)
	// the gap in true scale: far wider than the close-up of the Earth
	expect((await flightLog(page)).farthest).toBeGreaterThan(5 * start)
	await expectNoBox(page)
	// the page around it is the German one
	await expect(page.locator("html")).toHaveAttribute("lang", "de")
	await expect(liveRegion(page)).toHaveText("Jetzt zu sehen: Mond")
	await expect(
		page.getByRole("combobox", { name: "Himmelskörper im Fokus" }),
	).toHaveValue("Mond")
})
