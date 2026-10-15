/**
 * Phones and tablets (#58). The arrangement follows the screen's size: a
 * screen narrower than 600 px or lower than 480 px gets the phone
 * arrangement, live as it turns. Wherever the primary pointer is a finger
 * every control is at least 44×44 px; a laptop with a mouse keeps its look.
 *
 * One spec over five screens, not whole-suite projects: every test drives a
 * software-WebGL scene. The scene shares are what the interface leaves today
 * (#42's measure); the phone's sheet (#60) is to raise them.
 */
import { readFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { stubTurnstile } from "./support/feedback"
import {
	expandCard,
	hudPanels,
	openLayers,
	openTime,
	unobstructed,
	type Box,
} from "./support/hud"
import { cameraAtRest } from "./support/scene"
import { smallControls, TOUCH_TARGET_PX } from "./support/touch"

const sizeClasses = JSON.parse(
	readFileSync(path.join("src", "utils", "sizeClasses.json"), "utf8"),
) as { phone: string; touch: string }

interface Device {
	name: string
	width: number
	height: number
	/** the primary pointer is a finger */
	touch: boolean
	/** the phone arrangement */
	phone: boolean
	/** the share of the screen that is scene with Earth in view, and with its card unfolded */
	scene: number
	unfolded: number
}

const DEVICES: Device[] = [
	{
		name: "a phone",
		width: 390,
		height: 844,
		touch: true,
		phone: true,
		scene: 0.64,
		unfolded: 0.28,
	},
	{
		name: "a small phone",
		width: 360,
		height: 640,
		touch: true,
		phone: true,
		scene: 0.54,
		unfolded: 0.2,
	},
	{
		name: "a phone on its side",
		width: 844,
		height: 390,
		touch: true,
		phone: true,
		scene: 0.68,
		unfolded: 0.48,
	},
	{
		name: "an iPad",
		width: 768,
		height: 1024,
		touch: true,
		phone: false,
		scene: 0.8,
		unfolded: 0.5,
	},
	{
		name: "a laptop",
		width: 1366,
		height: 768,
		touch: false,
		phone: false,
		scene: 0.88,
		unfolded: 0.5,
	},
]

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})
	await cameraAtRest(page)
}

const matches = (page: Page, query: string) =>
	page.evaluate((query) => window.matchMedia(query).matches, query)

const overlap = (a: Box, b: Box) =>
	Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
	Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1

/** No two HUD panels lie over each other, and every one is inside the screen. */
async function expectTidy(page: Page, where: string) {
	const panels = await hudPanels(page)
	const { width, height } = page.viewportSize()!
	for (const [i, a] of panels.entries()) {
		expect(a.left, `${where}: ${a.name} inside`).toBeGreaterThanOrEqual(-0.5)
		expect(a.top, `${where}: ${a.name} inside`).toBeGreaterThanOrEqual(-0.5)
		expect(a.right, `${where}: ${a.name} inside`).toBeLessThanOrEqual(
			width + 0.5,
		)
		expect(a.bottom, `${where}: ${a.name} inside`).toBeLessThanOrEqual(
			height + 0.5,
		)
		for (const b of panels.slice(i + 1))
			expect(overlap(a, b), `${where}: ${a.name} over ${b.name}`).toBe(false)
	}
}

/** On a finger-sized screen nothing is smaller than 44 px; with a mouse, the laptop's dense look stays. */
async function expectSizes(page: Page, device: Device, where: string) {
	if (device.touch) {
		expect(await smallControls(page), where).toEqual([])
		return
	}
	const speed = (await page.getByTestId("time-menu").boundingBox())!
	expect(speed.height, where).toBeLessThan(TOUCH_TARGET_PX - 10)
}

/** The focused body's centre is not under a panel. */
async function expectBodyInView(page: Page, id: string, where: string) {
	// screenOf is on the canvas, the panels on the page, which slides in as it opens
	const body = await page.evaluate((id) => {
		const at = window.__orbitalia!.screenOf(id)
		if (at === null) return null
		const canvas = document.querySelector("canvas")!.getBoundingClientRect()
		return { x: canvas.x + at.x, y: canvas.y + at.y }
	}, id)
	expect(body, `${where}: ${id} on screen`).not.toBeNull()
	const under = (await hudPanels(page)).filter(
		(panel) =>
			body!.x >= panel.left &&
			body!.x <= panel.right &&
			body!.y >= panel.top &&
			body!.y <= panel.bottom,
	)
	expect(
		under.map((panel) => panel.name),
		`${where}: ${id} in view`,
	).toEqual([])
}

for (const device of DEVICES) {
	test.describe(device.name, () => {
		test.use({
			viewport: { width: device.width, height: device.height },
			hasTouch: device.touch,
			isMobile: device.touch,
		})

		test(`${device.width}x${device.height}: the scene, the arrangement and the size of every control`, async ({
			page,
		}) => {
			test.slow()
			await ready(page, "/solar_system?focus=earth&lang=en")
			await expect(page.getByTestId("body-card")).toBeVisible()
			// the emulation is the device: its pointer, and the arrangement its size gets
			expect(await matches(page, "(pointer: coarse)")).toBe(device.touch)
			expect(await matches(page, sizeClasses.touch)).toBe(device.touch)
			expect(await matches(page, sizeClasses.phone)).toBe(device.phone)

			expect(await unobstructed(page)).toBeGreaterThanOrEqual(device.scene)
			await expectTidy(page, "Earth")
			await expectSizes(page, device, "Earth")

			await expandCard(page)
			expect(await unobstructed(page)).toBeGreaterThanOrEqual(device.unfolded)
			await expectTidy(page, "the card unfolded")
			await expectSizes(page, device, "the card unfolded")
			if (device.phone && device.width > device.height)
				await expectBodyInView(page, "earth", "the card unfolded")

			await openLayers(page)
			await expectTidy(page, "Layers")
			await expectSizes(page, device, "Layers")
			// the panel's switches are all there to reach: in view, or a scroll away inside it
			const layers = page.locator("[data-dock-panel=layers]")
			await expect(layers.getByRole("switch")).toHaveCount(8)
			for (const toggle of await layers.getByRole("switch").all()) {
				await toggle.scrollIntoViewIfNeeded()
				await expect(toggle).toBeInViewport()
			}
			if (device.phone && device.width > device.height)
				await expectBodyInView(page, "earth", "Layers")

			await openTime(page)
			await expectSizes(page, device, "the time popover")
			await page.getByTestId("time-menu").click()

			await page.getByTestId("tools-menu").click()
			await expect(page.locator("[data-tool]").first()).toBeVisible()
			await expectSizes(page, device, "the Tools menu")
		})
	})
}

test.describe("turning a phone", () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	})

	test("the arrangement follows the screen live: upright, on its side, and a tablet's size", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		const where = page.getByTestId("where")
		const corner = page.getByTestId("corner")
		const box = async (locator: typeof where) => (await locator.boundingBox())!

		// upright: the corner under the name, the card across the width
		expect((await box(corner)).y).toBeGreaterThan(
			(await box(where)).y + (await box(where)).height - 1,
		)

		// on its side: the name beside the corner, the time bar beside the entry points
		await page.setViewportSize({ width: 844, height: 390 })
		await expect
			.poll(async () => Math.abs((await box(corner)).y - (await box(where)).y))
			.toBeLessThan(2)
		const time = await box(page.getByTestId("time-bar"))
		const entries = await box(page.getByTestId("entry-bar"))
		expect(
			Math.abs(time.y + time.height - (entries.y + entries.height)),
		).toBeLessThan(2)
		await expectTidy(page, "on its side")

		// a tablet's size: the laptop arrangement, with finger sizes
		await page.setViewportSize({ width: 1024, height: 768 })
		await expect.poll(() => matches(page, sizeClasses.phone)).toBe(false)
		expect(await smallControls(page)).toEqual([])
		await expectTidy(page, "1024x768")
	})
})

test.describe("a tour on a phone on its side", () => {
	test.use({
		viewport: { width: 844, height: 390 },
		hasTouch: true,
		isMobile: true,
	})

	test("the tour card fits: its words scroll, and Back and Next stay in reach", async ({
		page,
	}) => {
		await ready(page, "/solar_system?tour=grandTour&stop=1&lang=en")
		const card = page.locator("[data-tour-card]")
		await expect(card).toBeVisible()
		await expectTidy(page, "a tour stop")
		const next = card.getByRole("button", { name: "Next" })
		await next.scrollIntoViewIfNeeded()
		await expect(next).toBeInViewport()
		// nothing lies over it: a tap there is a tap on Next
		const box = (await next.boundingBox())!
		expect(
			await page.evaluate(
				({ x, y }) =>
					document
						.elementFromPoint(x, y)
						?.closest("button")
						?.textContent?.trim(),
				{ x: box.x + box.width / 2, y: box.y + box.height / 2 },
			),
		).toBe("Next")
		expect(await smallControls(page)).toEqual([])
	})
})

/** Every page, with a finger: nothing smaller than 44 px, and nothing wider than the screen. */
for (const [name, width, height] of [
	["a phone", 390, 844],
	["an iPad", 768, 1024],
] as const) {
	test.describe(`the other pages on ${name}`, () => {
		test.use({ viewport: { width, height }, hasTouch: true, isMobile: true })

		test(`${width}x${height}: dictionary, comparison, walk, help and feedback`, async ({
			page,
		}) => {
			test.slow()
			await stubTurnstile(page)
			for (const url of [
				"/solar_dictionary?entity=3&lang=en",
				"/compare?bodies=earth,mars&lang=en",
				"/solar_walk?lang=en",
				"/help?lang=en",
				"/feedback?lang=en",
			]) {
				await page.goto(url)
				// every page has its way back (#45)
				await expect(
					page.getByRole("button", { name: /^Back/ }).first(),
				).toBeVisible({ timeout: 30_000 })
				expect(await smallControls(page, { whole: true }), url).toEqual([])
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth - window.innerWidth,
					),
					`${url}: no sideways scrolling`,
				).toBeLessThanOrEqual(0)
			}
		})
	})
}
