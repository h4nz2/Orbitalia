import { expect, test, type Browser, type Page } from "@playwright/test"

import { cameraAtRest } from "./support/scene"

// Every text in the scene goes through one label layout, and a small screen
// shows fewer names (#74): the light flash's label and its stop button, the
// spacecraft's names, the moons' at Saturn, and the panels names keep out
// from under, on two phones held upright and on a laptop.

// software WebGL is slow
test.describe.configure({ timeout: 180_000 })

/** A fixed date (the overlap guard's), so the planets stand where they stood when this was measured. */
const T = "2461337.5"

/** Every name drawn in the scene, and the flash's label (the belts' by their span: a card's belt note has the hook too). */
const NAMES =
	"[data-label-layer] > *, [aria-hidden=true] > [data-craft], span[data-belt], [data-light-front-label]"

interface Box {
	name: string
	x0: number
	y0: number
	x1: number
	y1: number
}

/** Opens the solar system at the fixed date, waits for the camera to settle and stops the clock. */
async function open(page: Page, search: string) {
	await page.goto(`/solar_system?${search}${search === "" ? "" : "&"}t=${T}`)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	await cameraAtRest(page)
	await page.evaluate(() =>
		window.__orbitalia!.store.getState().setPaused(true),
	)
	await namesStill(page)
}

/**
 * Waits until no name in the scene moves or fades for 10 frames and half a
 * second: the layout re-reads the panels every 0.25 s and fades over 0.2 s.
 */
const namesStill = (page: Page) =>
	page.waitForFunction(
		({ names, key }) => {
			const probe = window as unknown as {
				stillKey?: number
				stillState?: string
				stillFor?: number
				stillSince?: number
			}
			const now = performance.now()
			if (probe.stillKey !== key) {
				probe.stillKey = key
				probe.stillState = undefined
				probe.stillFor = 0
				probe.stillSince = now
			}
			const elements = [...document.querySelectorAll<HTMLElement>(names)]
			const fading = elements.some((element) => {
				const opacity = element.style.opacity
				return opacity !== "" && opacity !== "0" && opacity !== "1"
			})
			const state = elements
				.map((element) => `${element.style.transform}|${element.style.opacity}`)
				.join()
			if (fading || state !== probe.stillState) {
				probe.stillFor = 0
				probe.stillSince = now
			} else probe.stillFor = (probe.stillFor ?? 0) + 1
			probe.stillState = state
			return probe.stillFor >= 10 && now - (probe.stillSince ?? now) >= 500
		},
		{ names: NAMES, key: Math.random() },
		{ polling: "raf", timeout: 30_000 },
	)

/** The boxes of the names shown (the flash's label by its words and its button, apart). */
const shownNames = (page: Page): Promise<Box[]> =>
	page.evaluate((names) => {
		const toBox = (name: string, rect: DOMRect) => ({
			name,
			x0: rect.left,
			y0: rect.top,
			x1: rect.right,
			y1: rect.bottom,
		})
		const boxes = []
		for (const element of document.querySelectorAll<HTMLElement>(names)) {
			const style = getComputedStyle(element)
			if (style.visibility === "hidden" || Number(style.opacity) < 0.15)
				continue
			if (element.hasAttribute("data-light-front-label")) {
				const words = document.createRange()
				words.selectNodeContents(
					element.querySelector("[data-light-front-text]")!,
				)
				boxes.push(toBox("flash words", words.getBoundingClientRect()))
				const stop = element.querySelector("[data-light-front-stop]")!
				boxes.push(toBox("flash ×", stop.getBoundingClientRect()))
				boxes.push(toBox("flash label", element.getBoundingClientRect()))
				continue
			}
			const name =
				element.dataset.body ??
				(element.dataset.orbit && `orbit ${element.dataset.orbit}`) ??
				(element.dataset.craft && `craft ${element.dataset.craft}`) ??
				`belt ${element.dataset.belt}`
			boxes.push(toBox(name, element.getBoundingClientRect()))
		}
		return boxes
	}, NAMES)

/** More than 1 px each way: a hairline is not an overlap. */
const overlap = (a: Box, b: Box) =>
	Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1 &&
	Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1

/** Every pair of shown names that overlaps, as "a / b" (the flash's label holds its own words and button). */
function overlaps(boxes: Box[]): string[] {
	const found: string[] = []
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const [a, b] = [boxes[i], boxes[j]]
			if (a.name.startsWith("flash") && b.name.startsWith("flash")) continue
			if (overlap(a, b)) found.push(`${a.name} / ${b.name}`)
		}
	return found
}

const PHONES = [
	{ width: 360, height: 640 },
	{ width: 390, height: 844 },
]

for (const viewport of PHONES)
	test.describe(`a phone, ${viewport.width}x${viewport.height}`, () => {
		test.use({ viewport, hasTouch: true, isMobile: true })

		test("with a flash out, no name lies over the flash's label, and its × is beside its words", async ({
			page,
		}) => {
			await open(page, "light=flash")
			const label = page.locator("[data-light-front-label]")
			await expect(label).toHaveAttribute("data-visible", "true")
			const boxes = await shownNames(page)
			const box = (name: string) => boxes.find((b) => b.name === name)!
			const [words, stop, whole] = [
				box("flash words"),
				box("flash ×"),
				box("flash label"),
			]
			// the × is a finger's target, inside the label's box and off its words
			expect(stop.x1 - stop.x0).toBeGreaterThanOrEqual(44)
			expect(stop.y1 - stop.y0).toBeGreaterThanOrEqual(44)
			expect(overlap(words, stop)).toBe(false)
			expect(stop.x0).toBeGreaterThanOrEqual(whole.x0 - 0.5)
			expect(stop.x1).toBeLessThanOrEqual(whole.x1 + 0.5)
			expect(stop.y0).toBeGreaterThanOrEqual(whole.y0 - 0.5)
			expect(stop.y1).toBeLessThanOrEqual(whole.y1 + 0.5)
			// the planets near the Sun are still named, but never under it
			expect(
				boxes.filter((b) => !b.name.startsWith("flash")).length,
			).toBeGreaterThan(2)
			expect(overlaps(boxes)).toEqual([])
			// the button still stops the flash
			await page.locator("[data-light-front-stop]").click()
			await expect(label).toHaveCount(0)
		})

		test("the asteroid belt's screen: no name over another, the belts' included", async ({
			page,
		}) => {
			await open(page, "smallBodies=true&scale=trueScale")
			const boxes = await shownNames(page)
			expect(boxes.length).toBeGreaterThan(3)
			expect(overlaps(boxes)).toEqual([])
		})

		test("the overview with the spacecraft on: no name over another, and two craft named", async ({
			page,
		}) => {
			await open(page, "spacecraft=true")
			const boxes = await shownNames(page)
			expect(overlaps(boxes)).toEqual([])
			const craft = boxes.filter((b) => b.name.startsWith("craft"))
			expect(craft.length).toBeGreaterThan(0)
			expect(craft.length).toBeLessThanOrEqual(2)
		})
	})

/** Saturn's moons with a story (#17), every one a laptop names. */
const SATURN_FEATURED = [
	"mimas",
	"enceladus",
	"tethys",
	"dione",
	"rhea",
	"titan",
	"hyperion",
	"iapetus",
	"phoebe",
]

/**
 * The moons a fresh page of this size names at Saturn, from far enough out
 * (4 x the home distance, 60° up) that all nine of its featured moons are on
 * screen and apart.
 */
async function moonsNamedAtSaturn(
	browser: Browser,
	viewport: { width: number; height: number },
	touch: boolean,
): Promise<string[]> {
	const context = await browser.newContext({
		viewport,
		hasTouch: touch,
		isMobile: touch,
	})
	const page = await context.newPage()
	await open(page, "focus=saturn&cam=0_60_4")
	await expect(
		page.locator("[data-label-layer] [data-body=saturn]"),
	).toHaveAttribute("data-visible", "true")
	const names = await page
		.locator("[data-label-layer] [data-kind=moon][data-visible=true]")
		.evaluateAll((elements) =>
			elements.map((element) => (element as HTMLElement).dataset.body ?? ""),
		)
	await context.close()
	return names
}

test("a phone names fewer of Saturn's moons than a laptop, which names all nine featured ones", async ({
	browser,
}) => {
	const laptop = await moonsNamedAtSaturn(
		browser,
		{ width: 1366, height: 768 },
		false,
	)
	const phone = await moonsNamedAtSaturn(
		browser,
		{ width: 360, height: 640 },
		true,
	)
	expect(laptop).toEqual(expect.arrayContaining(SATURN_FEATURED))
	expect(phone.length).toBeGreaterThan(0)
	expect(phone.length).toBeLessThan(laptop.length)
})

test.describe("a laptop", () => {
	test.use({ viewport: { width: 1366, height: 768 } })

	test("names keep out from under a panel in the dock with a class of its own (the birthday's)", async ({
		page,
	}) => {
		await open(page, "birthday=true")
		const panel = page.locator("#birthday-panel")
		await expect(panel).toBeVisible()
		await namesStill(page)
		const rect = (await panel.boundingBox())!
		const under = {
			name: "birthday panel",
			x0: rect.x,
			y0: rect.y,
			x1: rect.x + rect.width,
			y1: rect.y + rect.height,
		}
		const names = await shownNames(page)
		expect(names.length).toBeGreaterThan(3)
		expect(
			names.filter((name) => overlap(name, under)).map((n) => n.name),
		).toEqual([])
	})

	test("the belts' names move along their circles: both shown, over no other name, Haumea's back", async ({
		page,
	}) => {
		// Everything visible: on the viewer's left "Asteroid belt" would lie on the Sun's name
		await open(page, "smallBodies=true")
		let boxes = await shownNames(page)
		let names = boxes.map((b) => b.name)
		expect(names).toEqual(
			expect.arrayContaining(["belt asteroidbelt", "belt kuiperbelt"]),
		)
		expect(names).toContain("haumea")
		expect(overlaps(boxes)).toEqual([])
		// True scale, the asteroid belt's own screen: "Kuiper belt" lay on Haumea's name
		await open(page, "smallBodies=true&scale=trueScale")
		boxes = await shownNames(page)
		names = boxes.map((b) => b.name)
		expect(names).toEqual(expect.arrayContaining(["belt kuiperbelt", "haumea"]))
		expect(overlaps(boxes)).toEqual([])
	})

	test("the overview with the spacecraft on names every craft on screen, not only two", async ({
		page,
	}) => {
		await open(page, "spacecraft=true")
		const boxes = await shownNames(page)
		expect(overlaps(boxes)).toEqual([])
		const craft = boxes.filter((b) => b.name.startsWith("craft"))
		expect(craft.length).toBeGreaterThan(2)
	})
})
