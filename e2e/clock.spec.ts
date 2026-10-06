/**
 * The simulation clock (issue #9), seen through the HUD date: it runs at the
 * chosen speed whatever the frame rate, runs backwards at a negative warp,
 * freezes on pause, and time travel passes through the dates in between
 * instead of teleporting.
 */
import { expect, test, type Locator, type Page } from "@playwright/test"

import { nextFrames } from "./support/scene"
import { openTime } from "./support/hud"

const J2000 = 2451545
const DAY_MS = 86_400_000

/** A HUD date and the real time counted up to the frame that computed it. */
interface ClockSample {
	shown: number
	countedMs: number
}

/** The HUD clock: its text is localized (#11), its `dateTime` is the ISO instant. */
const clockOf = (page: Page): Locator => page.locator("time")

/** The HUD date ("2000-01-01T12:00Z" in `dateTime`) as epoch milliseconds. */
async function shownTime(clock: Locator): Promise<number> {
	return Date.parse((await clock.getAttribute("datetime")) ?? "")
}

/** Opens the solar system at `search` and waits until the scene has settled. */
async function open(page: Page, search: string): Promise<Locator> {
	await page.goto(`/solar_system?${search}`)
	await page.waitForLoadState("networkidle")
	const clock = clockOf(page)
	await expect(clock).toBeVisible()
	return clock
}

test("the clock runs at the chosen speed, whatever the frame rate", async ({
	page,
}) => {
	// one simulated day per real second. Headless software rendering draws only
	// a few frames per second (fewer still under a parallel test run); the clock
	// must advance by the real time elapsed, not per frame. Only frame gaps over
	// 250 ms (a stalled or hidden page) count partly, by design, so on a loaded
	// machine four counted seconds can take much longer than four.
	test.slow()
	await open(page, `t=${J2000}&warp=86400`)
	await page.waitForFunction(() => window.__orbitalia !== undefined)
	// Every time the HUD date changes, note it with the real time counted up to
	// the frame that computed it. Real time is counted at the store's own ticks
	// (`lastTickMs`, the instant each frame sampled the clock), capped per frame
	// like the clock; the date the HUD shows is matched to the tick that computed
	// it (the HUD refreshes at 10 Hz, so it may show a date some frames old, and
	// a loaded run draws a frame a second or less).
	await page.evaluate(() => {
		const probe = window as unknown as { samples: ClockSample[] }
		probe.samples = []
		const minuteOf = (jd: number) =>
			Math.floor(Math.round((jd - 2440587.5) * 86_400_000) / 60_000) * 60_000
		// every tick's date (to the minute the HUD shows) and the real time counted up to it
		const ticks = new Map<number, number>()
		let countedMs = 0
		let lastTick: number | null = null
		window.__orbitalia!.store.subscribe(({ lastTickMs, simTimeJD }) => {
			if (lastTickMs === null || lastTickMs === lastTick) return
			if (lastTick !== null) {
				countedMs += Math.min(Math.max(lastTickMs - lastTick, 0), 250)
			}
			lastTick = lastTickMs
			const minute = minuteOf(simTimeJD)
			if (!ticks.has(minute)) ticks.set(minute, countedMs)
		})
		const time = document.querySelector("time")!
		new MutationObserver(() => {
			const shown = Date.parse(time.getAttribute("datetime") ?? "")
			// a date computed before the count began cannot be paired with it
			const counted = ticks.get(shown)
			if (counted === undefined) return
			probe.samples.push({ shown, countedMs: counted })
		}).observe(time, { attributes: true, attributeFilter: ["datetime"] })
	})
	// wait for four seconds of counted real time, however long that takes
	await page.waitForFunction(() => {
		const { samples } = window as unknown as { samples: ClockSample[] }
		return (
			samples.length >= 2 &&
			samples.at(-1)!.countedMs - samples[0].countedMs >= 4000
		)
	})
	const samples = await page.evaluate(
		() => (window as unknown as { samples: ClockSample[] }).samples,
	)
	const first = samples[0]
	const second = samples.at(-1)!
	const simulatedDays = (second.shown - first.shown) / DAY_MS
	const countedSeconds = (second.countedMs - first.countedMs) / 1000
	expect(countedSeconds).toBeGreaterThan(1)
	// each HUD date is exact to the minute it shows (1/1440 of a day here)
	expect(Math.abs(simulatedDays - countedSeconds)).toBeLessThan(0.05)
})

test("a negative warp runs the clock backwards and survives in the link", async ({
	page,
}) => {
	const clock = await open(page, `t=${J2000}&warp=-86400`)
	const before = await shownTime(clock)
	// a day per second; polled, because a loaded headless run may stall frames
	await expect
		.poll(() => shownTime(clock), { timeout: 20_000 })
		.toBeLessThan(before - 2 * DAY_MS)
	await expect(page).toHaveURL(/[?&]warp=-86400(&|$)/)
})

test("pause freezes the clock where it is", async ({ page }) => {
	const clock = await open(page, `t=${J2000}&warp=86400`)
	await page.keyboard.press("Space")
	await expect(
		page.getByRole("button", { name: "Pause", pressed: true }),
	).toBeVisible()
	// the HUD refreshes the date at 10 Hz: let it show the pinned value first
	await page.waitForFunction(() => window.__orbitalia !== undefined)
	const pinned = await page.evaluate(() => {
		const { simTimeJD } = window.__orbitalia!.store.getState()
		return Math.round((simTimeJD - 2440587.5) * 86_400_000)
	})
	await expect
		.poll(() => shownTime(clock))
		.toBe(Math.floor(pinned / 60_000) * 60_000)
	const frozen = await clock.innerText()
	// two seconds would be two simulated days, and the page keeps drawing frames
	await page.waitForTimeout(2000)
	await nextFrames(page)
	await expect(clock).toHaveText(frozen)
})

test("Now travels to the present through the dates in between", async ({
	page,
}) => {
	const clock = await open(page, `t=${J2000}`)
	// paused, so every change of the date comes from the time travel itself
	await page.keyboard.press("Space")
	await expect(
		page.getByRole("button", { name: "Pause", pressed: true }),
	).toBeVisible()
	const start = await shownTime(clock)

	await openTime(page)
	await page.getByRole("button", { name: "Now" }).click()
	// sample every date shown on the way (a loaded headless run may stall
	// frames, which holds the glide, so poll instead of timing it)
	const seen: number[] = []
	await expect
		.poll(
			async () => {
				const shown = await shownTime(clock)
				if (seen.at(-1) !== shown) seen.push(shown)
				return Math.abs(shown - Date.now())
			},
			{ timeout: 20_000, intervals: [50] },
		)
		.toBeLessThan(5 * 60_000)
	const end = seen.at(-1)!
	// the date swept forward through the years in between, never backwards
	const between = seen.filter((t) => t > start + DAY_MS && t < end - DAY_MS)
	expect(between.length).toBeGreaterThan(0)
	for (let i = 1; i < seen.length; i++) {
		expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
	}
	// and it has landed, still paused
	await expect(
		page.getByRole("button", { name: "Pause", pressed: true }),
	).toBeVisible()
})
