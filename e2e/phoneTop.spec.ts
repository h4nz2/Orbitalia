/**
 * Phones: one quiet row at the top, and a tap on the sky hides the controls
 * (#59). On a phone the top is one row (Back, the way out, the name, the point
 * of view and More); More holds everything of the teacher's corner, one tap
 * away, with words and without keyboard keys; Share opens the phone's own
 * share sheet; an iPhone in Safari is told about the Home Screen instead of a
 * full screen it cannot have. On a touch screen a tap on empty sky hides the
 * controls and the next tap anywhere only brings them back. iPads keep the
 * corner, and a mouse never hides anything by clicking the sky.
 */
import { expect, test, type Page } from "@playwright/test"

import { cameraAtRest, menuAtRest } from "./support/scene"
import { smallControls } from "./support/touch"

// software WebGL is slow, and the taps on the sky wait for the camera each time
test.describe.configure({ timeout: 180_000 })

const PHONES = [
	{ name: "a phone", width: 390, height: 844 },
	{ name: "a small phone", width: 360, height: 640 },
] as const

const IPHONE_SAFARI =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	await cameraAtRest(page)
}

const html = (page: Page) => page.locator("html")
const more = (page: Page) => page.getByTestId("more-menu")
const morePanel = (page: Page) => page.getByTestId("more-panel")

/** Opens More, with a finger or a mouse. */
async function openMore(page: Page, finger = true) {
	if (await morePanel(page).isVisible()) return morePanel(page)
	if (finger) await more(page).tap()
	else await more(page).click()
	await expect(morePanel(page)).toBeVisible()
	return morePanel(page)
}

const state = (page: Page) =>
	page.evaluate(() => {
		const s = window.__orbitalia!.store.getState()
		return {
			view: s.view,
			selectedId: s.selectedId,
			paused: s.paused,
		}
	})

/** The camera's angles and its distance as a multiple of the framing: what a tap must never change. */
const shot = (page: Page) =>
	page.evaluate(() => {
		const camera = window.__orbitalia!.camera()
		const s = window.__orbitalia!.store.getState().shot
		return {
			azimuth: camera.azimuthDeg.toPrecision(5),
			elevation: camera.elevationDeg.toPrecision(5),
			multiple: s === null ? null : s.distance.toPrecision(4),
		}
	})

const cameraDistance = (page: Page) =>
	page.evaluate(() => window.__orbitalia!.camera().distance.toPrecision(5))

const hidden = (page: Page) =>
	page.evaluate(() => document.documentElement.dataset.chrome === "hidden")

/**
 * Points on the bare canvas (no panel over them) well clear of every listed
 * body: a finger there taps the sky, not a near miss.
 */
const skySpots = async (page: Page, ids: string[], clearance = 90) => {
	const spots = await page.evaluate(
		({ ids, clearance }) => {
			const canvas = document.querySelector("canvas")!.getBoundingClientRect()
			const bodies = ids
				.map((id) => window.__orbitalia!.screenOf(id))
				.filter((b) => b !== null)
				.map((b) => ({ x: canvas.x + b.x, y: canvas.y + b.y, r: b.ringPx }))
			const found: { x: number; y: number }[] = []
			for (let y = 80; y < window.innerHeight - 80; y += 30)
				for (let x = 30; x < window.innerWidth - 30; x += 30) {
					const clear = bodies.every(
						(b) => Math.hypot(b.x - x, b.y - y) > b.r + clearance,
					)
					if (clear && document.elementFromPoint(x, y)?.tagName === "CANVAS")
						found.push({ x, y })
				}
			return found
		},
		{ ids, clearance },
	)
	expect(spots.length, "sky on screen").toBeGreaterThan(0)
	return spots
}

/** The Sun and the planets: in the whole system, the sky is clear of all of them. */
const WORLDS = [
	"sun",
	"mercury",
	"venus",
	"earth",
	"moon",
	"mars",
	"jupiter",
	"saturn",
	"uranus",
	"neptune",
]

interface Edges {
	left: number
	top: number
	right: number
	bottom: number
}

/** The top row's panels and controls, all measured at the same instant. */
const topRow = (page: Page) =>
	page.evaluate(() => {
		const edges = (selector: string) => {
			const r = document.querySelector(selector)!.getBoundingClientRect()
			return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
		}
		return {
			where: edges("[data-testid=where]"),
			corner: edges("[data-testid=corner]"),
			controls: {
				back: edges("[data-testid=where] button"),
				home: edges("[data-testid=where] button[aria-keyshortcuts=Escape]"),
				name: edges("[data-testid=where] input"),
				pointOfView: edges("[data-testid=frame-menu]"),
				more: edges("[data-testid=more-menu]"),
			},
		}
	}) as Promise<{
		where: Edges
		corner: Edges
		controls: Record<string, Edges>
	}>

/** The corner's own buttons (laptops and tablets): none of them on a phone. */
const CORNER = [
	"present-menu",
	"share-menu",
	"hide-controls",
	"sound-toggle",
	"sound-menu",
	"help-button",
	"intro-menu",
]

for (const phone of PHONES) {
	test.describe(`${phone.name}, ${phone.width}x${phone.height}`, () => {
		test.use({
			viewport: { width: phone.width, height: phone.height },
			hasTouch: true,
			isMobile: true,
		})

		test("the top is one row, and More holds the whole corner with words, one tap away", async ({
			page,
		}) => {
			await ready(page, "/solar_system?focus=earth&lang=en")
			await expect(more(page)).toHaveText("More")

			// one row: the name and More side by side, nothing under them but the
			// scene (measured at one instant: the page slides in as it opens)
			const row = await topRow(page)
			const { where: w, corner: c } = row
			expect(Math.abs(w.top - c.top)).toBeLessThan(2)
			expect(Math.abs(w.bottom - c.bottom)).toBeLessThan(2)
			expect(c.left).toBeGreaterThanOrEqual(w.right)
			expect(c.right).toBeLessThanOrEqual(phone.width)
			expect(w.bottom - w.top).toBeLessThan(60)
			for (const [name, b] of Object.entries(row.controls)) {
				expect((b.top + b.bottom) / 2, name).toBeCloseTo(
					(w.top + w.bottom) / 2,
					0,
				)
				expect(b.bottom - b.top, name).toBeGreaterThanOrEqual(44)
			}
			// the name box keeps room for a name
			const name = row.controls.name
			expect(name.right - name.left).toBeGreaterThan(80)
			for (const id of CORNER)
				await expect(page.getByTestId(id), id).toBeHidden()
			expect(await smallControls(page)).toEqual([])

			// More: every item with its words, finger-sized, and no keyboard keys
			const panel = await openMore(page)
			expect(await smallControls(page)).toEqual([])
			await expect(panel.locator("kbd")).toHaveCount(0)
			await expect(
				panel.getByRole("button", { name: "Keyboard shortcuts" }),
			).toHaveCount(0)
			for (const item of [
				panel.getByRole("button", { name: "Link and QR code" }),
				panel.getByRole("switch", { name: "Sound on" }),
				panel.getByRole("button", { name: "Sound settings" }),
				panel.getByRole("button", { name: /^Language and reading level/ }),
				panel.getByRole("link", { name: "Every feature and how to use it" }),
				panel.getByRole("button", { name: "Play the opening again" }),
				panel.getByRole("button", { name: "Take the quick look again" }),
				panel.getByRole("button", { name: "Show how to move around" }),
				panel.getByRole("button", { name: "Send feedback" }),
				panel.getByRole("button", { name: "Hide the controls" }),
				panel.getByRole("switch", { name: "Large text for a projector" }),
				panel.getByRole("switch", { name: "High contrast" }),
				panel.getByRole("button", { name: "Back to the start" }),
			]) {
				await item.scrollIntoViewIfNeeded()
				await expect(item, String(item)).toBeVisible()
			}

			// the second tap does it: the projector's text, sound, the hiding
			await panel
				.getByRole("switch", { name: "Large text for a projector" })
				.tap()
			await expect(html(page)).toHaveAttribute("data-presenting", "")
			await panel
				.getByRole("switch", { name: "Large text for a projector" })
				.tap()
			await expect(html(page)).not.toHaveAttribute("data-presenting", "")
			await panel.getByRole("switch", { name: "Sound on" }).tap()
			await expect(
				panel.getByRole("switch", { name: "Sound on" }),
			).toBeChecked()

			// a page inside More, and back
			await panel.getByRole("button", { name: "Sound settings" }).tap()
			await expect(page.getByTestId("sound-settings")).toBeVisible()
			await panel.getByRole("button", { name: "Back to More" }).tap()
			await panel
				.getByRole("button", { name: /^Language and reading level/ })
				.tap()
			await panel.getByRole("button", { name: "Deutsch" }).tap()
			await expect(more(page)).toHaveText("Mehr")
			await panel.getByRole("button", { name: "Zurück zu „Mehr“" }).tap()
			await panel
				.getByRole("button", { name: "Bedienelemente ausblenden" })
				.tap()
			await expect(html(page)).toHaveAttribute("data-chrome", "hidden")
			await expect(morePanel(page)).toBeHidden()
		})

		test("Share opens the phone's share sheet; the link and the class QR code are one tap away", async ({
			page,
		}) => {
			await page.addInitScript(() => {
				const calls: unknown[] = []
				;(window as unknown as { shared: unknown[] }).shared = calls
				Object.defineProperty(navigator, "share", {
					configurable: true,
					value: (data: unknown) => {
						calls.push(data)
						return (window as unknown as { cancelShare?: boolean }).cancelShare
							? Promise.reject(new DOMException("cancelled", "AbortError"))
							: Promise.resolve()
					},
				})
			})
			await ready(page, "/solar_system?focus=jupiter&lang=en")
			await page.evaluate(() =>
				window.__orbitalia!.store.getState().setPaused(true),
			)
			await expect(page).toHaveURL(/[?&]t=/)

			const panel = await openMore(page)
			await panel.getByRole("button", { name: "Share", exact: true }).tap()
			await expect
				.poll(() =>
					page.evaluate(
						() => (window as unknown as { shared: unknown[] }).shared,
					),
				)
				.toEqual([
					{
						title: await page.title(),
						url: page.url(),
					},
				])
			// sent: More closes
			await expect(morePanel(page)).toBeHidden()

			// a cancelled share is silent: More stays, nothing else opens
			await page.evaluate(() => {
				;(window as unknown as { cancelShare: boolean }).cancelShare = true
			})
			await openMore(page)
			await panel.getByRole("button", { name: "Share", exact: true }).tap()
			await expect
				.poll(() =>
					page.evaluate(
						() => (window as unknown as { shared: unknown[] }).shared.length,
					),
				)
				.toBe(2)
			await expect(panel).toBeVisible()
			await expect(
				panel.getByRole("button", { name: "Copy link" }),
			).toHaveCount(0)

			// the link and the class QR code
			await panel.getByRole("button", { name: "Link and QR code" }).tap()
			const link = panel.getByRole("textbox", { name: "Link to this view" })
			await expect(link).toHaveValue(/\/solar_system\?.*focus=jupiter/)
			expect(await link.inputValue()).toBe(page.url())
			await panel
				.getByRole("button", { name: "Show the QR code to the class" })
				.tap()
			const large = page.getByRole("dialog", {
				name: "Scan to open this view on a phone or tablet",
			})
			await expect(large).toBeVisible()
			await expect(morePanel(page)).toBeHidden()
			// closing the code comes back to More
			await page.keyboard.press("Escape")
			await expect(large).toBeHidden()
			await expect(more(page)).toBeFocused()
		})
	})
}

test.describe("a phone without a share sheet", () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	})

	test("More offers only the link and the QR code", async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, "share", {
				configurable: true,
				value: undefined,
			})
		})
		await ready(page, "/solar_system?focus=earth&lang=en")
		const panel = await openMore(page)
		await expect(
			panel.getByRole("button", { name: "Share", exact: true }),
		).toHaveCount(0)
		await panel.getByRole("button", { name: "Link and QR code" }).tap()
		await expect(panel.getByRole("button", { name: "Copy link" })).toBeVisible()
	})
})

test.describe("an iPhone in Safari", () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
		userAgent: IPHONE_SAFARI,
	})

	test("without the Fullscreen API, More explains the Home Screen instead of Full screen", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			Object.defineProperty(Document.prototype, "fullscreenEnabled", {
				configurable: true,
				get: () => false,
			})
		})
		await ready(page, "/solar_system?focus=earth&lang=en")
		const panel = await openMore(page)
		await expect(panel.getByTestId("more-fullscreen")).toHaveCount(0)
		const item = panel.getByTestId("more-home-screen")
		await item.scrollIntoViewIfNeeded()
		await expect(item).toHaveText(/Full screen/)
		await item.tap()
		const steps = page.getByTestId("home-screen-steps")
		await expect(steps).toBeVisible()
		await expect(steps).toContainText("Add to Home Screen")
		await expect(panel.getByRole("heading")).toHaveText(
			"Full screen on an iPhone",
		)
	})

	test("opened from the Home Screen, neither is offered", async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(Document.prototype, "fullscreenEnabled", {
				configurable: true,
				get: () => false,
			})
			Object.defineProperty(navigator, "standalone", {
				configurable: true,
				value: true,
			})
		})
		await ready(page, "/solar_system?focus=earth&lang=en")
		const panel = await openMore(page)
		await expect(panel.getByTestId("more-fullscreen")).toHaveCount(0)
		await expect(panel.getByTestId("more-home-screen")).toHaveCount(0)
	})
})

test.describe("a tap on the sky, on a phone", () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	})

	test("twenty taps on the sky hide and bring back the controls, and never move the camera or the selection", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=mars&lang=en")
		const before = await state(page)
		const pose = await shot(page)
		const distance = await cameraDistance(page)
		const time = () =>
			page.evaluate(() => window.__orbitalia!.store.getState().simTimeJD)
		const startTime = await time()
		const spots = await skySpots(page, ["mars", "phobos", "deimos"])
		for (let i = 0; i < 20; i++) {
			const spot = spots[(i * 7) % spots.length]
			await page.touchscreen.tap(spot.x, spot.y)
			const hide = i % 2 === 0
			await expect.poll(() => hidden(page), `tap ${i + 1}`).toBe(hide)
			await expect(page.getByTestId("hud")).toBeVisible({ visible: !hide })
			// the controls go or come back at once; the camera follows the room it has (#61)
			await cameraAtRest(page)
			expect(await state(page), `tap ${i + 1}`).toEqual({
				...before,
				paused: false,
			})
			expect(await shot(page), `tap ${i + 1}`).toEqual(pose)
		}
		// back where it was, to the pixel
		expect(await cameraDistance(page)).toBe(distance)
		// hiding never stops the time
		expect(await time()).toBeGreaterThan(startTime)
	})

	test("while hidden, a tap on a world only brings the controls back", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=mars&lang=en")
		const [spot] = await skySpots(page, ["mars", "phobos", "deimos"])
		await page.touchscreen.tap(spot.x, spot.y)
		await expect(html(page)).toHaveAttribute("data-chrome", "hidden")
		await cameraAtRest(page)
		const pose = await shot(page)
		// Mars itself, and its moons: none is chosen
		for (const id of ["phobos", "deimos", "mars"]) {
			if (!(await hidden(page))) {
				await page.touchscreen.tap(spot.x, spot.y)
				await expect(html(page)).toHaveAttribute("data-chrome", "hidden")
				await cameraAtRest(page)
			}
			const at = await page.evaluate((id) => {
				const canvas = document.querySelector("canvas")!.getBoundingClientRect()
				const b = window.__orbitalia!.screenOf(id)
				return b === null ? null : { x: canvas.x + b.x, y: canvas.y + b.y }
			}, id)
			// a moon behind Mars or off the screen just now: nothing to aim at
			if (at === null) continue
			await page.touchscreen.tap(at.x, at.y)
			await expect(html(page)).not.toHaveAttribute("data-chrome", "hidden")
			await cameraAtRest(page)
			expect(await state(page), id).toMatchObject({
				view: { kind: "body", id: "mars" },
				selectedId: "mars",
			})
			expect((await shot(page)).azimuth, id).toBe(pose.azimuth)
		}
	})

	test("a tap that lets go of a second world does that, and keeps the controls", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=mars&lang=en")
		await page.evaluate(() =>
			window.__orbitalia!.store.getState().select("phobos"),
		)
		const [spot] = await skySpots(page, ["mars", "phobos", "deimos"])
		await page.touchscreen.tap(spot.x, spot.y)
		await expect.poll(async () => (await state(page)).selectedId).toBeNull()
		await expect(page.getByTestId("body-card")).toHaveAttribute(
			"data-card-body",
			"mars",
		)
		expect(await hidden(page)).toBe(false)
		// the next one, with nothing to let go of, hides them
		await page.touchscreen.tap(spot.x, spot.y)
		await expect(html(page)).toHaveAttribute("data-chrome", "hidden")
	})

	test("a tap that closes a menu does not also hide the controls", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=mars&lang=en")
		// the point of view's menu, under the top row (Tools is tiles in the sheet now, #62)
		await page.getByTestId("frame-menu").tap()
		const menu = page.getByRole("menu")
		await expect(menu).toBeVisible()
		await menuAtRest(page)
		// a patch of sky clear of the open menu
		const [spot] = await skySpots(page, ["mars", "phobos", "deimos"])
		await page.touchscreen.tap(spot.x, spot.y)
		await expect(menu).toBeHidden()
		expect(await hidden(page)).toBe(false)
		// and the next tap on the sky does
		await page.touchscreen.tap(spot.x, spot.y)
		await expect(html(page)).toHaveAttribute("data-chrome", "hidden")
	})

	test("during a tour the sky hides the controls, and the tour goes on", async ({
		page,
	}) => {
		await ready(page, "/solar_system?tour=grandTour&stop=1&lang=en")
		const card = page.locator("[data-tour-card]")
		await expect(card).toBeVisible()
		const stop = () =>
			page.evaluate(() => window.__orbitalia!.store.getState().sequence?.index)
		const at = await stop()
		const spots = await skySpots(page, WORLDS, 70)
		// a stop opens the phone's sheet at half height: the first tap lowers it (#60)
		await page.touchscreen.tap(spots[0].x, spots[0].y)
		await expect(page.getByTestId("sheet")).toHaveAttribute(
			"data-sheet-height",
			"small",
		)
		expect(await hidden(page)).toBe(false)
		await page.touchscreen.tap(spots[0].x, spots[0].y)
		await expect(html(page)).toHaveAttribute("data-chrome", "hidden")
		expect(await stop()).toBe(at)
		await page.touchscreen.tap(spots[0].x, spots[0].y)
		await expect(card).toBeVisible()
		expect(await stop()).toBe(at)
	})
})

test.describe("an iPad", () => {
	test.use({
		viewport: { width: 768, height: 1024 },
		hasTouch: true,
		isMobile: true,
	})

	test("keeps the corner, and a tap on the sky hides the controls", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=mars&lang=en")
		await expect(more(page)).toHaveCount(0)
		for (const id of CORNER)
			await expect(page.getByTestId(id), id).toBeVisible()
		expect(await smallControls(page)).toEqual([])
		const [spot] = await skySpots(page, ["mars", "phobos", "deimos"])
		await page.touchscreen.tap(spot.x, spot.y)
		await expect(html(page)).toHaveAttribute("data-chrome", "hidden")
		await page.touchscreen.tap(spot.x, spot.y)
		await expect(html(page)).not.toHaveAttribute("data-chrome", "hidden")
	})
})

test.describe("a laptop", () => {
	test.use({ viewport: { width: 1366, height: 768 } })

	test("a click on the sky never hides the controls", async ({ page }) => {
		await ready(page, "/solar_system?focus=mars&lang=en")
		await expect(more(page)).toHaveCount(0)
		const spots = await skySpots(page, ["mars", "phobos", "deimos"])
		for (const spot of spots.slice(0, 6)) {
			await page.mouse.click(spot.x, spot.y)
			expect(await hidden(page)).toBe(false)
		}
		await expect(page.getByTestId("corner")).toBeVisible()
	})

	test("a narrow window gets More, with its keys and the shortcut list", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await ready(page, "/solar_system?focus=mars&lang=en")
		const panel = await openMore(page, false)
		await expect(
			panel.getByRole("button", { name: /^Hide the controls/ }),
		).toContainText("H")
		await panel.getByRole("button", { name: /^Keyboard shortcuts/ }).click()
		await expect(
			page.getByRole("dialog", { name: "Keyboard shortcuts" }),
		).toBeVisible()
	})
})
