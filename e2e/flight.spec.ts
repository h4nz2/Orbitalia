import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"

// Fly between planets (#18), in the real browser: a second selection flies
// (pull back, travel, descend) with the distance and travel-time readout, and
// the flight can be skipped, retargeted and abandoned with Escape.

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
	/** The readout's Skip button labels seen while the flight was under way. */
	skips: string[]
}

/**
 * Watches every frame from now on: how far the camera pulls back, and what the
 * readout offers while the flight is under way. A flight at its own speed
 * lasts 2.5-5 s of real time, which a loaded machine can spend before a single
 * check has run, so what only shows mid-flight is recorded as it happens.
 */
const recordFlight = (page: Page) =>
	page.evaluate(() => {
		const log: FlightLog = { farthest: 0, skips: [] }
		;(window as unknown as { flightLog: FlightLog }).flightLog = log
		const watch = () => {
			const camera = window.__orbitalia?.camera()
			if (camera !== undefined) {
				log.farthest = Math.max(log.farthest, camera.distance)
			}
			const skip = document.querySelector(
				"[data-testid=flight-readout][data-arrived=false] header button",
			)
			const label = skip?.textContent?.trim()
			if (label && !log.skips.includes(label)) log.skips.push(label)
			requestAnimationFrame(watch)
		}
		requestAnimationFrame(watch)
	})

const flightLog = (page: Page) =>
	page.evaluate(() => (window as unknown as { flightLog: FlightLog }).flightLog)

test("a second selection flies there, with the distance and the travel times", async ({
	page,
}) => {
	await ready(page, "/solar_system?focus=earth")
	const start = (await camera(page)).distance
	const readout = page.getByRole("region", { name: "Flight" })

	// the picker, like any selection from a focused body, starts the flight
	await page.getByRole("combobox", { name: "Focus body" }).click()
	await recordFlight(page)
	await page.getByRole("option", { name: /^Jupiter/ }).click()
	await expect(readout).toBeVisible()
	await expect(readout.getByText("Earth → Jupiter")).toBeVisible()
	await expect(
		readout.getByText(/^\d+ million km apart on this date$/),
	).toBeVisible()
	await expect(readout.getByRole("listitem")).toHaveText([
		/^Light\s*\d+ minutes$/,
		/^New Horizons, the fastest launch ever\s*[\d.]+ years?$/,
		/^A car at 100 km\/h\s*[\d,]+ years$/,
	])

	await cameraAtRest(page)
	const log = await flightLog(page)
	// on the way it offered Skip, and the camera pulled far back
	expect(log.skips).toEqual(["Skip"])
	expect(log.farthest).toBeGreaterThan(100 * start)
	const landed = await camera(page)
	expect(landed.mode).toBe("focused")
	expect(landed.distance).toBeLessThan(10 * start)
	await expect(page).toHaveURL(/[?&]focus=jupiter(&|$)/)

	// the readout stays for the class to read, until closed
	await expect(readout).toHaveAttribute("data-arrived", "true")
	await expect(readout.getByText(/crossed/)).toHaveCount(0)
	await readout.getByRole("button", { name: "Close" }).click()
	await expect(readout).toHaveCount(0)
})

test("a flight can be skipped, retargeted and abandoned", async ({ page }) => {
	await ready(page, "/solar_system?focus=earth")
	const readout = page.getByTestId("flight-readout")

	// Skip lands at once and keeps the numbers
	await flySlowly(page, "saturn")
	await waitForProgress(page, 0.1)
	await expect(page.getByTestId("flight-crossed")).toHaveText(/crossed$/)
	await readout.getByRole("button", { name: "Skip" }).click()
	await cameraAtRest(page)
	expect((await camera(page)).mode).toBe("focused")
	await expect(readout).toHaveAttribute("data-arrived", "true")
	await expect(readout.getByText("Earth → Saturn")).toBeVisible()

	// a third selection mid-flight turns round from where the camera is
	await flySlowly(page, "neptune")
	await waitForProgress(page, 0.2)
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setFocus("mars"),
	)
	await expect(readout.getByText("Saturn → Mars")).toBeVisible()
	await cameraAtRest(page)
	expect(
		await page.evaluate(() => window.__orbitalia!.store.getState().focusId),
	).toBe("mars")

	// Escape mid-flight: the way out, and the readout goes with the trip
	await flySlowly(page, "venus")
	await waitForProgress(page, 0.3)
	await page.keyboard.press("Escape")
	await cameraAtRest(page)
	expect((await camera(page)).mode).toBe("overview")
	await expect(readout).toHaveCount(0)
})

test("true scale, in German at the simple reading level", async ({ page }) => {
	await ready(
		page,
		"/solar_system?focus=earth&scale=trueScale&lang=de&reading=simple",
	)
	await recordFlight(page)
	await flySlowly(page, "moon", 8000)
	const readout = page.getByRole("region", { name: "Reise" })
	await expect(readout.getByText("Reise: Erde → Mond")).toBeVisible()
	// no kilometres at the simple level: Earth is the yardstick (#51)
	await expect(
		readout.getByText(/^Das ist so weit wie \d{2} Erden in einer Reihe$/),
	).toBeVisible()
	await expect(readout.getByRole("listitem").first()).toHaveText(
		/^Licht, das Schnellste, was es gibt\s*1(,5)? Sekunden?$/,
	)
	await cameraAtRest(page)
	expect((await camera(page)).mode).toBe("focused")
	// while under way it offered to skip, in German
	expect((await flightLog(page)).skips).toEqual(["Sofort hin"])
})
