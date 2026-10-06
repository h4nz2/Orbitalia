import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"

// Sky events (#41) in the real browser: one action sets the whole scene (time,
// true scale, the view from space), one click switches to the view from Earth
// where the Moon covers the Sun, a link opens on either view, and leaving goes
// back to the view, time and scale the viewer had.

test.describe.configure({ timeout: 180_000 })

const J2000 = 2451545

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 30_000,
	})
	await cameraAtRest(page)
}

const card = (page: Page) => page.locator("[data-event-card]")
// the HUD clock (the event card gives its date as text)
const clock = (page: Page) => page.locator("time")
const camera = (page: Page) =>
	page.evaluate(() => {
		const handle = window.__orbitalia!
		const c = handle.camera()
		return {
			fovDeg: c.fovDeg,
			eyeHeld: c.eyeHeld,
			view: handle.store.getState().view,
			paused: handle.store.getState().paused,
			scale: handle.scale.getState().targetId,
		}
	})

test("one action stages the 2024 eclipse; from Earth the Moon covers the Sun; leaving goes back", async ({
	page,
}) => {
	await ready(page, `/solar_system?t=${J2000}&paused=true`)
	await page.getByRole("button", { name: "Travel to a date" }).click()
	await page.getByText("Sky events", { exact: true }).click()
	await page
		.locator('[data-event="solar2024"]')
		.getByText("Total solar eclipse")
		.click()

	await expect(card(page)).toBeVisible()
	await expect(
		card(page).getByRole("heading", { name: "Total solar eclipse" }),
	).toBeVisible()
	await expect(card(page)).toContainText("Apr 8, 2024, 18:17 UTC")
	await expect(page).toHaveURL(/tour=event-solar2024/)
	// the scene is set: true scale, paused on the day of the eclipse, Earth in view
	await expect(page.locator("canvas[data-scale-preset]")).toHaveAttribute(
		"data-scale-preset",
		"trueScale",
		{ timeout: 20_000 },
	)
	await expect(clock(page)).toHaveAttribute("datetime", /^2024-04-08T/, {
		timeout: 20_000,
	})
	await cameraAtRest(page)
	let now = await camera(page)
	expect(now.view).toEqual({ kind: "body", id: "earth" })
	expect(now.paused).toBe(true)
	expect(now.fovDeg).toBe(45)

	// the view from Earth: standing in the Moon's shadow, a telescope's lens
	await card(page).getByText("From Earth", { exact: true }).click()
	await expect(card(page)).toHaveAttribute("data-view", "earth")
	await cameraAtRest(page)
	now = await camera(page)
	expect(now.view).toEqual({ kind: "body", id: "moon" })
	expect(now.eyeHeld).toBe(true)
	expect(now.fovDeg).toBeCloseTo(2, 5)
	const discs = await page.evaluate(() => ({
		sun: window.__orbitalia!.screenOf("sun"),
		moon: window.__orbitalia!.screenOf("moon"),
	}))
	expect(discs.sun).not.toBeNull()
	expect(discs.moon).not.toBeNull()
	const apart = Math.hypot(
		discs.sun!.x - discs.moon!.x,
		discs.sun!.y - discs.moon!.y,
	)
	// the Moon's disc is at least as big as the Sun's and sits right on it
	expect(discs.moon!.discPx).toBeGreaterThanOrEqual(discs.sun!.discPx)
	expect(apart + discs.sun!.discPx).toBeLessThanOrEqual(discs.moon!.discPx + 1)

	// leaving: back to the overview, the year 2000 and Everything visible
	await card(page).getByTestId("event-leave").click()
	await expect(card(page)).toBeHidden()
	await expect(clock(page)).toHaveAttribute("datetime", /^2000-01-01T12:00/, {
		timeout: 20_000,
	})
	await cameraAtRest(page)
	now = await camera(page)
	expect(now.view).toEqual({ kind: "overview" })
	expect(now.scale).toBe("everythingVisible")
	expect(now.fovDeg).toBe(45)
	await expect(page).not.toHaveURL(/tour=/)
})

test("a link opens a lunar eclipse on the view from Earth, in German; the presenter key switches views", async ({
	page,
}) => {
	await ready(page, "/solar_system?tour=event-lunar2025mar&stop=2&lang=de")
	await expect(
		card(page).getByRole("heading", {
			name: "Totale Mondfinsternis: ein Blutmond",
		}),
	).toBeVisible()
	await expect(card(page)).toHaveAttribute("data-view", "earth")
	const now = await camera(page)
	expect(now.view).toEqual({ kind: "body", id: "moon" })
	expect(now.eyeHeld).toBe(true)
	expect(now.scale).toBe("trueScale")
	await expect(clock(page)).toHaveAttribute("datetime", /^2025-03-14T/)

	// a clicker's Page Up goes back to the view from space
	await page.keyboard.press("PageUp")
	await expect(card(page)).toHaveAttribute("data-view", "space")
	await expect(page).toHaveURL(/stop=1/)
	await cameraAtRest(page)
	expect((await camera(page)).view).toEqual({ kind: "body", id: "earth" })
})
