/**
 * Teacher and presentation mode (#29): a prepared link opens exactly on its
 * view, a lesson runs from the keyboard with every control hidden, and one
 * key brings back the start; high contrast, reduced motion and the screen
 * reader's live region; sharing; and a layout that survives a projector.
 */
import { expect, test, type Locator, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"
import { expandCard } from "./support/hud"

// software WebGL is slow and the lesson waits for the camera several times
test.describe.configure({ timeout: 180_000 })

/** 16 January 2025, Mars at opposition: the lesson a teacher prepared. */
const LESSON =
	"focus=earth&frame=earth&sel=mars&cam=0_89.9_120&t=2460691.5&warp=2629800&paused=true&present=true"

const open = async (page: Page, search: string) => {
	await page.goto(`/solar_system?${search}`)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 30_000,
	})
	await expect(page.locator("time")).toBeVisible()
}

const state = (page: Page) =>
	page.evaluate(() => {
		const handle = window.__orbitalia!
		const s = handle.store.getState()
		return {
			view: s.view,
			focusId: s.focusId,
			selectedId: s.selectedId,
			frameId: s.frameId,
			paused: s.paused,
			timeWarp: s.timeWarp,
			simTimeJD: s.simTimeJD,
			showLabels: s.showLabels,
			scale: handle.scale.getState().targetId,
			transitionMs: s.transition?.durationMs ?? null,
		}
	})

const html = (page: Page) => page.locator("html")
const liveRegion = (page: Page) => page.locator("[data-announcer]")
const overviewButton = (page: Page) =>
	page.getByRole("button", { name: "Back to overview", exact: true })

test("a prepared lesson opens exactly there and runs from the keyboard with no controls on screen", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 720 })
	await open(page, `${LESSON}&lang=en`)

	// the link opens in projector mode, paused on the prepared moment
	await expect(html(page)).toHaveAttribute("data-presenting", "")
	await expect(
		page.getByRole("button", { name: "Pause", pressed: true }),
	).toBeVisible()
	expect(await state(page)).toMatchObject({
		focusId: "earth",
		frameId: "earth",
		selectedId: "mars",
		paused: true,
		timeWarp: 2629800,
		simTimeJD: 2460691.5,
	})
	await expect(page).toHaveURL(/[?&]paused=true(&|$)/)
	await expect(page).toHaveURL(/[?&]present=true(&|$)/)
	await cameraAtRest(page)

	// H: every panel disappears, the keys keep working
	await page.keyboard.press("h")
	await expect(html(page)).toHaveAttribute("data-chrome", "hidden")
	await expect(overviewButton(page)).toBeHidden()
	await expect(page.locator("time")).toBeHidden()
	await expect(liveRegion(page)).toContainText("Controls hidden")
	await expect(
		page.getByRole("button", { name: "Show the controls" }),
	).toBeVisible()

	// 5: Jupiter; PageDown (a presenter remote): Saturn
	await page.keyboard.press("5")
	await expect(liveRegion(page)).toHaveText("Now showing Jupiter")
	expect(await state(page)).toMatchObject({
		focusId: "jupiter",
		selectedId: "jupiter",
	})
	await page.keyboard.press("PageDown")
	await expect(liveRegion(page)).toHaveText("Now showing Saturn")
	await cameraAtRest(page)

	// Space runs time, S walks the scale presets, L hides the names
	await page.keyboard.press(" ")
	await expect.poll(async () => (await state(page)).paused).toBe(false)
	await page.keyboard.press("s")
	await expect(liveRegion(page)).toHaveText("Scale: Textbook")
	await page.keyboard.press("l")
	await expect(liveRegion(page)).toHaveText("Names hidden")
	expect(await state(page)).toMatchObject({
		scale: "textbook",
		showLabels: false,
	})

	// R: back to the prepared lesson, exactly
	await page.keyboard.press("r")
	await expect(liveRegion(page)).toHaveText("Back to the start")
	await cameraAtRest(page)
	await expect
		.poll(async () => (await state(page)).simTimeJD, { timeout: 15_000 })
		.toBeCloseTo(2460691.5, 3)
	expect(await state(page)).toMatchObject({
		focusId: "earth",
		frameId: "earth",
		selectedId: "mars",
		paused: true,
		timeWarp: 2629800,
		scale: "everythingVisible",
		showLabels: true,
	})

	// Escape is still the way out; H brings the controls back
	await page.keyboard.press("Escape")
	await expect
		.poll(async () => (await state(page)).view)
		.toEqual({ kind: "overview" })
	expect((await state(page)).frameId).toBe("sun")
	await page.keyboard.press("h")
	await expect(overviewButton(page)).toBeVisible()
	await expect(page.locator("time")).toBeVisible()
})

test("high contrast, reduced motion and the screen reader: German, simple reading level", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce", contrast: "more" })
	await page.setViewportSize({ width: 1280, height: 800 })
	await open(page, "lang=de&reading=simple")

	// prefers-contrast: more switches high contrast on by itself
	await expect(html(page)).toHaveAttribute("data-contrast", "high")
	const colours = await page
		.getByRole("button", { name: "Zurück zur Übersicht", exact: true })
		.evaluate((button) => {
			const panel = button.closest("div[class*='panel']")!
			const style = getComputedStyle(panel)
			return {
				background: style.backgroundColor,
				border: style.borderTopColor,
				text: getComputedStyle(document.body).color,
			}
		})
	expect(colours.background).toBe("rgb(0, 0, 0)")
	expect(colours.border).toBe("rgb(255, 255, 255)")
	expect(colours.text).toBe("rgb(255, 255, 255)")

	// reduced motion: a key jumps instead of flying, and the live region says where
	await page.evaluate(() => {
		const probe = window as unknown as { durations: (number | null)[] }
		probe.durations = []
		window.__orbitalia!.store.subscribe((s, previous) => {
			if (s.transition !== null && s.transition !== previous.transition) {
				probe.durations.push(s.transition.durationMs)
			}
		})
	})
	await page.keyboard.press("4")
	await expect(liveRegion(page)).toHaveText("Jetzt zu sehen: Mars")
	expect(
		await page.evaluate(
			() => (window as unknown as { durations: unknown[] }).durations,
		),
	).toEqual([0])
	await cameraAtRest(page)

	// the shortcut list is a real dialog, and Escape closes only the dialog
	await page.keyboard.press("?")
	const dialog = page.getByRole("dialog", { name: "Tastenkürzel" })
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText(
		"Zwischen erfundenen und echten Größen wechseln",
	)
	await expect(dialog.locator("kbd", { hasText: "Leertaste" })).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(dialog).toBeHidden()
	expect((await state(page)).focusId).toBe("mars")

	// the teacher's menu: its switches say which key they are
	await page.getByRole("button", { name: "Präsentieren" }).click()
	const menu = page.getByRole("dialog", { name: "Präsentieren" })
	await expect(menu).toBeVisible()
	await expect(
		menu.getByRole("switch", { name: "Große Schrift für den Beamer" }),
	).toHaveAttribute("aria-keyshortcuts", "P")
	await expect(
		menu.getByRole("switch", { name: "Hoher Kontrast" }),
	).toBeChecked()
	await menu.getByRole("button", { name: /Bedienelemente ausblenden/ }).click()
	await expect(html(page)).toHaveAttribute("data-chrome", "hidden")

	// with hidden controls, the way back is reachable from the keyboard alone
	await page.keyboard.press("Tab")
	const show = page.getByRole("button", { name: "Bedienelemente zeigen" })
	await expect(show).toBeFocused()
	await page.keyboard.press("Enter")
	await expect(html(page)).not.toHaveAttribute("data-chrome", "hidden")
	await expect(
		page.getByRole("button", { name: "Zurück zur Übersicht", exact: true }),
	).toBeVisible()
})

/**
 * The points of the class QR code a phone needs, and what covers them (#50):
 * its four corners (the white margin), the centres of its three finder
 * squares and its centre. Each point names the element on top there when
 * that is not the code itself; an empty list means the whole code is in
 * view. Everything is hit-tested, click-through layers (labels, hints)
 * included.
 */
const qrCovers = (qr: Locator) =>
	qr.evaluate((svg) => {
		const size = (svg as SVGSVGElement).viewBox.baseVal.width
		const box = svg.getBoundingClientRect()
		// the finder squares' centres lie 3.5 modules inside the 4-module quiet zone
		const finder = (4 + 3.5) / size
		const inset = 1 / box.width
		const points: [string, number, number][] = [
			["top left corner", inset, inset],
			["top right corner", 1 - inset, inset],
			["bottom left corner", inset, 1 - inset],
			["bottom right corner", 1 - inset, 1 - inset],
			["top left finder", finder, finder],
			["top right finder", 1 - finder, finder],
			["bottom left finder", finder, 1 - finder],
			["centre", 0.5, 0.5],
		]
		const style = document.createElement("style")
		style.textContent = "* { pointer-events: auto !important; }"
		document.head.append(style)
		const covered = points.flatMap(([name, fx, fy]) => {
			const top = document.elementFromPoint(
				box.left + fx * box.width,
				box.top + fy * box.height,
			)
			if (top !== null && svg.contains(top)) return []
			const by =
				top === null
					? "nothing (off screen)"
					: `${top.tagName.toLowerCase()}.${[...top.classList].join(".")}`
			return [`${name}: ${by}`]
		})
		style.remove()
		return covered
	})

test("share: the link is the view, copied or scanned", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"])
	await page.setViewportSize({ width: 1366, height: 768 })
	await open(page, "focus=jupiter&lang=en")
	// a running clock rewrites `t` in the address every second: hold it still, so the
	// shared link and the address are compared at the same instant
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setPaused(true),
	)
	await expect(page).toHaveURL(/[?&]t=/)

	await page.getByRole("button", { name: "Share", exact: true }).click()
	const panel = page.getByRole("dialog", { name: "Share", exact: true })
	const link = panel.getByRole("textbox", { name: "Link to this view" })
	await expect(link).toHaveValue(/\/solar_system\?.*focus=jupiter/)
	expect(await link.inputValue()).toBe(page.url())
	await expect(
		panel.getByRole("img", { name: "QR code of the link to this view" }),
	).toBeVisible()

	await panel.getByRole("button", { name: "Copy link" }).click()
	await expect(panel.getByRole("status")).toHaveText("Link copied")
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		page.url(),
	)

	// the class code takes the panel's place, and nothing covers it (#50): a
	// laptop, a phone, and a laptop and a full-HD projector in projector mode
	const share = page.getByRole("button", { name: "Share", exact: true })
	const large = page.getByRole("dialog", {
		name: "Scan to open this view on a phone or tablet",
	})
	for (const { width, height, present } of [
		{ width: 1366, height: 768, present: false },
		{ width: 390, height: 844, present: false },
		{ width: 1366, height: 768, present: true },
		{ width: 1920, height: 1080, present: true },
	]) {
		const where = `${width}x${height}${present ? ", presenting" : ""}`
		await page.setViewportSize({ width, height })
		if (present) {
			if ((await html(page).getAttribute("data-presenting")) === null)
				await page.keyboard.press("p")
			await expect(html(page)).toHaveAttribute("data-presenting", "")
		}
		if (!(await panel.isVisible())) await share.click()
		await panel
			.getByRole("button", { name: "Show the QR code to the class" })
			.click()
		await expect(large, where).toBeVisible()
		await expect(panel, where).toBeHidden()
		const qr = large.getByRole("img", {
			name: "QR code of the link to this view",
		})
		await expect.poll(() => qrCovers(qr), { message: where }).toEqual([])
		const box = await qr.boundingBox()
		expect(box!.width, where).toBeGreaterThan(Math.min(400, 0.65 * width))
		// closing the code comes back to Share, not to the panel
		await page.keyboard.press("Escape")
		await expect(large, where).toBeHidden()
		await expect(panel, where).toBeHidden()
		await expect(share, where).toBeFocused()
	}
	expect((await state(page)).focusId).toBe("jupiter")
})

/** Every control a teacher needs lies fully inside the viewport. */
const controlsInView = async (page: Page) => {
	const size = page.viewportSize()!
	for (const locator of [
		overviewButton(page),
		page.getByRole("combobox", { name: "Focus body" }),
		page.getByRole("button", { name: "Present", exact: true }),
		page.getByRole("button", { name: "Share", exact: true }),
		page.getByRole("button", { name: "Play", exact: true }),
		page.getByRole("button", { name: "Travel to a date" }),
		page.getByTestId("time-menu"),
		page.getByTestId("hide-controls"),
		// the entry points (#42)
		page.getByTestId("tour-menu"),
		page.locator("[data-entry=layers]"),
		page.locator("[data-entry=scale]"),
		page.getByTestId("tools-menu"),
	]) {
		const box = await locator.boundingBox()
		expect(box, String(locator)).not.toBeNull()
		expect(box!.x).toBeGreaterThanOrEqual(0)
		expect(box!.y).toBeGreaterThanOrEqual(0)
		expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 0.5)
		expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 0.5)
	}
	const canvas = await page.locator("canvas").first().boundingBox()
	expect(canvas!.width).toBeCloseTo(size.width, 0)
	expect(canvas!.height).toBeCloseTo(size.height, 0)
}

test("second screen: the projector layout fits laptop and projector sizes, and follows the pixel ratio", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 720 })
	await open(page, "present=true&lang=en")
	await controlsInView(page)

	// dragged to an old 4:3 projector, then to a full-HD one
	for (const size of [
		{ width: 1024, height: 768 },
		{ width: 1920, height: 1080 },
	]) {
		await page.setViewportSize(size)
		await expect
			.poll(
				async () => (await page.locator("canvas").first().boundingBox())!.width,
			)
			.toBeCloseTo(size.width, 0)
		await controlsInView(page)
	}

	// a screen with another pixel ratio: the canvas re-renders at it
	await page.setViewportSize({ width: 1024, height: 768 })
	const cdp = await page.context().newCDPSession(page)
	const sharper = () =>
		cdp.send("Emulation.setDeviceMetricsOverride", {
			width: 1024,
			height: 768,
			deviceScaleFactor: 2,
			mobile: false,
		})
	await sharper()
	await expect
		.poll(async () => {
			const { ratio, canvas } = await page.evaluate(() => {
				const canvas = document.querySelector("canvas")!
				return {
					ratio: window.devicePixelRatio,
					canvas: canvas.width / canvas.clientWidth,
				}
			})
			// Playwright's own session emulates the context's ratio (1) too and may
			// re-assert it after this one: then the screen changes again, and the
			// canvas must follow that change as well
			if (ratio !== 2) await sharper()
			return canvas
		})
		.toBeCloseTo(2, 1)
})

test("short screens: a tall body card never pushes the time controls off screen", async ({
	page,
}) => {
	for (const search of [
		"focus=saturn&lang=de",
		"focus=saturn&lang=de&present=true",
	]) {
		await page.setViewportSize({ width: 800, height: 600 })
		await open(page, search)
		await expect(page.getByRole("heading", { name: "Saturn" })).toBeVisible()
		// the card starts small (#42); unfolded, it is tall
		await expandCard(page)
		for (const locator of [
			page.getByRole("button", { name: "Abspielen", exact: true }),
			page.getByRole("heading", { name: "Saturn" }),
		]) {
			const box = await locator.boundingBox()
			expect(box, search).not.toBeNull()
			expect(box!.y).toBeGreaterThanOrEqual(0)
			expect(box!.y + box!.height).toBeLessThanOrEqual(600.5)
		}
	}
	// the layer switches sit behind one button (#42: on every screen)
	await expect(
		page.getByRole("switch", { name: "Beschriftungen" }),
	).toHaveCount(0)
	await page.getByRole("button", { name: "Ebenen" }).click()
	await expect(
		page.getByRole("switch", { name: "Beschriftungen" }),
	).toBeVisible()
})
