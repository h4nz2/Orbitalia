/**
 * Teacher and presentation mode (#29): a prepared link opens exactly on its
 * view, a lesson runs from the keyboard with every control hidden, and one
 * key brings back the start; high contrast, reduced motion and the screen
 * reader's live region; sharing (this view or a fresh start, #69; a clock
 * showing now stays out of the link); and a layout that survives a projector.
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
	// a paused clock is a chosen moment, so the address and the link carry it (#69)
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
	// on a phone, Share is under More (#59): "Link and QR code" is the same panel
	const more = page.getByTestId("more-menu")
	const morePanel = page.getByTestId("more-panel")
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
		const phone = width < 600
		await page.setViewportSize({ width, height })
		if (present) {
			if ((await html(page).getAttribute("data-presenting")) === null)
				await page.keyboard.press("p")
			await expect(html(page)).toHaveAttribute("data-presenting", "")
		}
		if (phone) {
			await more.click()
			await morePanel.getByRole("button", { name: "Link and QR code" }).click()
			await morePanel
				.getByRole("button", { name: "Show the QR code to the class" })
				.click()
		} else {
			if (!(await panel.isVisible())) await share.click()
			await panel
				.getByRole("button", { name: "Show the QR code to the class" })
				.click()
		}
		await expect(large, where).toBeVisible()
		await expect(phone ? morePanel : panel, where).toBeHidden()
		const qr = large.getByRole("img", {
			name: "QR code of the link to this view",
		})
		await expect.poll(() => qrCovers(qr), { message: where }).toEqual([])
		const box = await qr.boundingBox()
		expect(box!.width, where).toBeGreaterThan(Math.min(400, 0.65 * width))
		// closing the code comes back to Share (More on a phone), not to the panel
		await page.keyboard.press("Escape")
		await expect(large, where).toBeHidden()
		await expect(phone ? morePanel : panel, where).toBeHidden()
		await expect(phone ? more : share, where).toBeFocused()
	}
	expect((await state(page)).focusId).toBe("jupiter")
})

/** The `t` of the address, or null. */
const addressTime = (page: Page) => {
	const t = new URL(page.url()).searchParams.get("t")
	return t === null ? null : Number(t)
}

/** The wall clock as a Julian Date. */
const nowJD = () => Date.now() / 86_400_000 + 2440587.5

test("a clock that only shows now stays out of the link; leaving it writes the moment at once (#69)", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1366, height: 768 })
	await open(page, "lang=en")
	await cameraAtRest(page)
	// a few seconds on the untouched overview: no time in the address
	await page.waitForTimeout(3000)
	expect(addressTime(page)).toBeNull()
	const entries = await page.evaluate(() => history.length)

	// pause: `t` within a second and a half, written over the entry on screen
	await page.keyboard.press("Space")
	await expect(
		page.getByRole("button", { name: "Pause", pressed: true }),
	).toBeVisible()
	await expect(page).toHaveURL(/[?&]t=\d+(\.\d+)?(&|$)/, { timeout: 1500 })
	expect(Math.abs(addressTime(page)! - nowJD())).toBeLessThan(2 / 1440)
	expect(await page.evaluate(() => history.length)).toBe(entries)

	// running again a moment later: still the present, so `t` goes again
	await page.keyboard.press("Space")
	await expect.poll(() => addressTime(page)).toBeNull()

	// straight to 1 day/s, where `t` is not mirrored: the link keeps the moment it left now
	const left = nowJD()
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setTimeWarp(86400),
	)
	await expect(page).toHaveURL(/[?&]warp=86400(&|$)/)
	expect(addressTime(page)).not.toBeNull()
	expect(Math.abs(addressTime(page)! - left)).toBeLessThan(2 / 1440)
	const fast = addressTime(page)
	await page.waitForTimeout(2000)
	expect(addressTime(page)).toBe(fast)

	// back to 1x and Now: the present again, no `t`
	await page.evaluate(() => {
		const store = window.__orbitalia!.store.getState()
		store.setTimeWarp(1)
		store.setNow()
	})
	await expect.poll(() => addressTime(page), { timeout: 10_000 }).toBeNull()
	expect(new URL(page.url()).searchParams.has("warp")).toBe(false)
	expect(await page.evaluate(() => history.length)).toBe(entries)

	// a time travel at 1x: `t` within a second and a half
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().travelTo(2451545),
	)
	await expect.poll(() => addressTime(page), { timeout: 1500 }).not.toBeNull()
	await expect
		.poll(() => addressTime(page), { timeout: 10_000 })
		.toBeCloseTo(2451545, 1)

	// R, back to the start of a link taken at now: now again, at 1x, with no `t`
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setTimeWarp(-3600),
	)
	await page.keyboard.press("r")
	await expect(liveRegion(page)).toHaveText("Back to the start")
	await expect.poll(() => addressTime(page), { timeout: 15_000 }).toBeNull()
	const back = await state(page)
	expect(back.timeWarp).toBe(1)
	expect(back.paused).toBe(false)
	expect(Math.abs(back.simTimeJD - nowJD())).toBeLessThan(2 / 1440)
})

test("share: a fresh start plays the opening for everyone, then asks the quick look (#69)", async ({
	page,
	context,
	browser,
}) => {
	await page.setViewportSize({ width: 1366, height: 768 })
	await open(page, "focus=jupiter&lang=en")
	await page.getByRole("button", { name: "Share", exact: true }).click()
	const panel = page.getByRole("dialog", { name: "Share", exact: true })
	const choice = panel.getByRole("radiogroup", { name: "What the link opens" })
	// this view by default
	await expect(choice.getByRole("radio", { name: "This view" })).toBeChecked()
	await expect(
		panel.getByRole("textbox", { name: "Link to this view" }),
	).toHaveValue(/focus=jupiter/)

	// a fresh start: the app's address with the language, the reading level and intro=play
	await choice.getByText("A fresh start", { exact: true }).click()
	await expect(
		choice.getByRole("radio", { name: "A fresh start" }),
	).toBeChecked()
	const field = panel.getByRole("textbox", { name: "Link to a fresh start" })
	const origin = new URL(page.url()).origin
	await expect(field).toHaveValue(
		`${origin}/solar_system?lang=en&reading=standard&intro=play`,
	)
	await expect(
		panel.getByRole("img", { name: "QR code of the link to a fresh start" }),
	).toBeVisible()
	const link = await field.inputValue()

	// the class code follows the choice, and the choice holds while the page is open
	await panel
		.getByRole("button", { name: "Show the QR code to the class" })
		.click()
	const large = page.getByRole("dialog", {
		name: "Scan to start Orbitalia from the beginning on a phone or tablet",
	})
	await expect(large).toBeVisible()
	await expect(
		large.getByRole("img", { name: "QR code of the link to a fresh start" }),
	).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(large).toBeHidden()
	await page.getByRole("button", { name: "Share", exact: true }).click()
	await expect(
		choice.getByRole("radio", { name: "A fresh start" }),
	).toBeChecked()
	// the view itself is untouched
	expect((await state(page)).focusId).toBe("jupiter")

	// a student who has seen the opening before (this context remembers it) gets it again
	const student = await context.newPage()
	await student.goto(link)
	await expect(student.getByTestId("intro-skip")).toBeVisible({
		timeout: 60_000,
	})
	expect(
		await student.evaluate(() => localStorage.getItem("orbitalia.introSeen")),
	).toBe("1")
	await student.getByTestId("intro-skip").click()
	// asked once on this device, as after any opening (#44)
	await expect(student.getByTestId("quick-look-ask")).toBeVisible()
	await expect(student).not.toHaveURL(/intro=/)
	await student.close()

	// on a phone the choice lives in More's "Link and QR code", finger-sized
	const phone = await browser.newContext({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	})
	const teacher = await phone.newPage()
	await open(teacher, "focus=jupiter&lang=en")
	await teacher.getByTestId("more-menu").tap()
	const more = teacher.getByTestId("more-panel")
	await more.getByRole("button", { name: "Link and QR code" }).tap()
	const phoneChoice = more.getByRole("radiogroup", {
		name: "What the link opens",
	})
	await phoneChoice.getByText("A fresh start", { exact: true }).tap()
	await expect(
		more.getByRole("textbox", { name: "Link to a fresh start" }),
	).toHaveValue(/\/solar_system\?lang=en&reading=standard&intro=play$/)
	for (const segment of ["This view", "A fresh start"]) {
		const box = (await phoneChoice
			.locator("label")
			.filter({ hasText: segment })
			.boundingBox())!
		expect(box.height, segment).toBeGreaterThanOrEqual(43.5)
		expect(box.x + box.width, segment).toBeLessThanOrEqual(390)
	}
	await phone.close()
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

test("second screen: the projector layout fits laptop and projector sizes", async ({
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
})

test("second screen: dragged to a sharper projector and back, the canvas follows the pixel ratio", async ({
	browser,
	headless,
	storageState,
}) => {
	test.skip(!headless, "only a headless browser can be given a second screen")
	// a real window on two screens, with no emulated viewport: it takes its pixel
	// ratio from the screen it is on, as on a laptop with a projector. (An
	// emulated ratio, `Emulation.setDeviceMetricsOverride`, changes
	// `devicePixelRatio` without telling any `matchMedia` listener: DprSync never
	// hears it, and the canvas follows only when a resize happens to come along.)
	const context = await browser.newContext({
		viewport: null,
		deviceScaleFactor: undefined,
		storageState,
	})
	const page = await context.newPage()
	const cdp = await context.newCDPSession(page)
	const { windowId } = await cdp.send("Browser.getWindowForTarget")
	const { screenInfo: projector } = await cdp.send("Emulation.addScreen", {
		left: 4000,
		top: 0,
		width: 3840,
		height: 2160,
		devicePixelRatio: 2,
	})
	const moveTo = (left: number) =>
		cdp.send("Browser.setWindowBounds", { windowId, bounds: { left, top: 0 } })
	const ratio = () =>
		page.evaluate(() => {
			const canvas = document.querySelector("canvas")!
			return canvas.width / canvas.clientWidth
		})
	try {
		await open(page, "present=true&lang=en")
		await expect.poll(ratio).toBeCloseTo(1, 1)
		// the Canvas also re-reads the ratio whenever it re-renders, as when its
		// box moves: wait until the page has slid into place
		await expect
			.poll(async () => (await page.locator("canvas").first().boundingBox())!.y)
			.toBe(0)
		// the window keeps its size: only the pixel ratio changes
		await moveTo(projector.left)
		await expect.poll(ratio).toBeCloseTo(2, 1)
		// and back to the laptop, not at twice the pixels it needs there. (The
		// first resize after loading may re-render the Canvas once; this second
		// one is DprSync's alone: without it, the canvas stays at 2.)
		await moveTo(0)
		await expect.poll(ratio).toBeCloseTo(1, 1)
	} finally {
		await cdp.send("Emulation.removeScreen", { screenId: projector.id })
		await context.close()
	}
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
