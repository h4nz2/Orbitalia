/**
 * Phones: the planet in the part of the screen you can see (#61). On an
 * upright phone the camera centres and fits what it looks at in the band the
 * HUD leaves free between its top and bottom stacks, fits a ringed planet
 * across the width, and looks down more steeply on the whole system; taps
 * still land on what they aim at. A laptop's framing is unchanged.
 */
import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { expandCard } from "./support/hud"
import { cameraAtRest, labelsAtRest, nextFrames } from "./support/scene"
import { stubSpeech } from "./support/speech"

const screenshotDir = path.join("test-results", "phone-framing")
const shot = async (page: Page, name: string) => {
	mkdirSync(screenshotDir, { recursive: true })
	await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) })
}

// software WebGL is slow; the hunt flies between five clues
test.describe.configure({ timeout: 180_000 })

/** The rings' outer edge in planet radii (data/rings, `ringRatioOf`). */
const SATURN_RINGS = 140220 / 58232

const PLANETS = [
	"mercury",
	"venus",
	"earth",
	"mars",
	"jupiter",
	"saturn",
	"uranus",
	"neptune",
]

const ready = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 30_000,
	})
	await cameraAtRest(page)
}

interface Placement {
	x: number
	y: number
	discPx: number
}

const screenOf = (page: Page, id: string): Promise<Placement | null> =>
	page.evaluate((id) => window.__orbitalia!.screenOf(id), id)

/** The band the HUD leaves free (the phone's open row, dock/FreeArea.tsx), px. */
const freeBand = async (page: Page) => {
	const box = await page.locator("[data-free-area]").boundingBox()
	expect(box, "the phone's HUD leaves a band free").not.toBeNull()
	return { top: box!.y, bottom: box!.y + box!.height }
}

/** The top of the body card, px. */
const cardTop = async (page: Page) =>
	(await page.getByTestId("body-card").boundingBox())!.y

test.describe("on an upright phone", () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	})

	test("Earth with its card unfolded is whole above the card, and the pivot in the band", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=earth&lang=en")
		await expandCard(page)
		await expect(page.getByTestId("card-toggle")).toHaveAttribute(
			"aria-expanded",
			"true",
		)
		await cameraAtRest(page, 10)
		const band = await freeBand(page)
		const earth = (await screenOf(page, "earth"))!
		expect(earth).not.toBeNull()
		expect(earth.y - earth.discPx).toBeGreaterThanOrEqual(band.top - 1)
		expect(earth.y + earth.discPx).toBeLessThanOrEqual(band.bottom + 1)
		expect(earth.y + earth.discPx).toBeLessThan(await cardTop(page))
		// drawn in the middle of the band (the free area is kept to whole pixels)
		expect(Math.abs(earth.y - (band.top + band.bottom) / 2)).toBeLessThan(1.5)
		await shot(page, "earth-unfolded")

		// folded again: Earth grows back into the larger band, still whole
		await page.getByTestId("card-toggle").tap()
		await cameraAtRest(page, 10)
		const folded = await freeBand(page)
		const back = (await screenOf(page, "earth"))!
		expect(back.discPx).toBeGreaterThan(earth.discPx)
		expect(back.y - back.discPx).toBeGreaterThanOrEqual(folded.top - 1)
		expect(back.y + back.discPx).toBeLessThanOrEqual(folded.bottom + 1)
		// the link keeps its camera: nothing in it changed with the card
		expect(new URL(page.url()).searchParams.get("cam")).toBeNull()
	})

	test("Saturn and its rings fit the width, above the card", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=saturn&lang=en")
		const saturn = (await screenOf(page, "saturn"))!
		const rings = SATURN_RINGS * saturn.discPx
		expect(saturn.x - rings).toBeGreaterThanOrEqual(0)
		expect(saturn.x + rings).toBeLessThanOrEqual(390)
		// rings across nine tenths of the width, not shrunk further
		expect(2 * rings).toBeGreaterThan(0.85 * 390)
		const band = await freeBand(page)
		expect(saturn.y + saturn.discPx).toBeLessThan(await cardTop(page))
		expect(Math.abs(saturn.y - (band.top + band.bottom) / 2)).toBeLessThan(1.5)
		await shot(page, "saturn")
	})

	test("a link to Saturn made on a laptop, its camera included, opens whole on the phone", async ({
		browser,
		page,
	}) => {
		// the teacher's laptop: Saturn, turned to a view of its own
		const laptop = await browser.newContext({
			viewport: { width: 1366, height: 768 },
		})
		const teacher = await laptop.newPage()
		await ready(teacher, "/solar_system?focus=saturn&lang=en")
		const before = (await screenOf(teacher, "saturn"))!
		await teacher.evaluate(() =>
			window
				.__orbitalia!.store.getState()
				.goTo(
					{ kind: "body", id: "saturn" },
					{ shot: { azimuthDeg: 35, elevationDeg: 20 } },
				),
		)
		await cameraAtRest(teacher)
		await expect
			.poll(() => new URL(teacher.url()).searchParams.get("cam"))
			.toBe("35_20_1")
		const link = new URL(teacher.url())
		// a laptop frames Saturn as it always did (6 drawn radii)
		expect((await screenOf(teacher, "saturn"))!.discPx).toBeCloseTo(
			before.discPx,
			0,
		)
		await laptop.close()

		// a student's phone
		await ready(page, `${link.pathname}${link.search}`)
		expect(new URL(page.url()).searchParams.get("cam")).toBe("35_20_1")
		const saturn = (await screenOf(page, "saturn"))!
		const rings = SATURN_RINGS * saturn.discPx
		expect(saturn.x - rings).toBeGreaterThanOrEqual(0)
		expect(saturn.x + rings).toBeLessThanOrEqual(390)
		expect(saturn.y + saturn.discPx).toBeLessThan(await cardTop(page))
		const camera = await page.evaluate(() => window.__orbitalia!.camera())
		expect(camera.azimuthDeg).toBeCloseTo(35, 3)
		expect(camera.elevationDeg).toBeCloseTo(20, 3)
		await shot(page, "laptop-link-saturn")
	})

	test("the whole system uses the height: the orbits over a third of it, every planet in the band", async ({
		page,
	}) => {
		test.slow()
		for (const scale of ["everythingVisible", "poster", "trueScale"]) {
			await ready(page, `/solar_system?scale=${scale}&paused=true&lang=en`)
			const camera = await page.evaluate(() => window.__orbitalia!.camera())
			// looked at from the steeper home shot, which the link leaves out
			expect(camera.elevationDeg, scale).toBeCloseTo(65, 3)
			expect(new URL(page.url()).searchParams.get("cam"), scale).toBeNull()
			const band = await freeBand(page)
			for (const id of PLANETS) {
				const at = await screenOf(page, id)
				expect(at, `${scale}: ${id} on screen`).not.toBeNull()
				expect(at!.x, `${scale}: ${id}`).toBeGreaterThanOrEqual(0)
				expect(at!.x, `${scale}: ${id}`).toBeLessThanOrEqual(390)
				expect(at!.y, `${scale}: ${id}`).toBeGreaterThanOrEqual(band.top)
				expect(at!.y, `${scale}: ${id}`).toBeLessThanOrEqual(band.bottom)
			}
			if (scale === "everythingVisible") await shot(page, "overview")
			// Neptune round its orbit (the outermost): its path spans the height
			const ys = await page.evaluate(async () => {
				const handle = window.__orbitalia!
				const state = handle.store.getState()
				const start = state.simTimeJD
				const frame = () =>
					new Promise((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(resolve)),
					)
				const out: number[] = []
				for (let k = 0; k < 12; k++) {
					state.setSimTime(start + (k * 60190) / 12)
					await frame()
					out.push(handle.screenOf("neptune")?.y ?? Number.NaN)
				}
				state.setSimTime(start)
				return out
			})
			const span = Math.max(...ys) - Math.min(...ys)
			expect(
				span,
				`${scale}: Neptune's orbit across the height`,
			).toBeGreaterThan(844 / 3)
		}
	})

	test("taps on bodies and names land with the scene drawn off-centre", async ({
		page,
	}) => {
		await ready(page, "/solar_system?lang=en&paused=true")
		expect(
			await page.evaluate(() => window.__orbitalia!.camera().pivotLift),
		).toBeGreaterThan(0)
		const jupiter = (await screenOf(page, "jupiter"))!
		await page.touchscreen.tap(jupiter.x, jupiter.y)
		await expect
			.poll(() =>
				page.evaluate(() => window.__orbitalia!.store.getState().selectedId),
			)
			.toBe("jupiter")
		await cameraAtRest(page)
		// the way out, then a tap on a name
		await page.getByRole("button", { name: "Back to overview" }).tap()
		await cameraAtRest(page)
		await labelsAtRest(page)
		const label = page.locator('[data-label-layer] [data-body="saturn"]')
		await expect(label).toHaveAttribute("data-visible", "true")
		const box = (await label.boundingBox())!
		await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
		await expect
			.poll(() =>
				page.evaluate(() => window.__orbitalia!.store.getState().view),
			)
			.toEqual({ kind: "body", id: "saturn" })
	})

	test("the centre marker sits on the pivot, in the middle of the band", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=mars&at=0_40_0&lang=en")
		const marker = page.getByTestId("centre-marker")
		await expect(marker).toHaveAttribute("data-visible", "true")
		const box = (await marker.boundingBox())!
		const lift = await page.evaluate(
			() => window.__orbitalia!.camera().pivotLift,
		)
		expect(lift).toBeGreaterThan(0)
		expect(
			Math.abs(box.y + box.height / 2 - (844 / 2 - lift * 844)),
		).toBeLessThan(1.5)
		expect(Math.abs(box.x + box.width / 2 - 195)).toBeLessThan(1.5)
	})

	test("Look and find: every world a clue asks for is in sight while the clue is up", async ({
		page,
	}) => {
		test.slow()
		await stubSpeech(page)
		await ready(page, "/solar_system?hunt=lookAndFind&lang=en&reading=simple")
		const panel = page.locator("#hunt-panel")
		for (const answer of ["earth", "mars", "jupiter", "saturn", "moon"]) {
			await expect(page.getByTestId("hunt-clue")).toBeVisible()
			await cameraAtRest(page, 10)
			await nextFrames(page)
			const at = (await screenOf(page, answer))!
			expect(at, `${answer} on screen`).not.toBeNull()
			const clue = (await panel.boundingBox())!
			expect(at.y, `${answer} above the clue`).toBeLessThan(clue.y)
			const hit = await page.evaluate(
				([x, y]) => document.elementFromPoint(x, y)?.tagName,
				[at.x, at.y],
			)
			expect(hit, `${answer} is not under a panel`).toBe("CANVAS")
			if (answer === "earth") await shot(page, "hunt-clue")
			// found (through the store: in the overview a spacecraft's marker beside
			// Earth may take a finger's tap, which is not what this test is about)
			await page.evaluate(
				(id) => window.__orbitalia!.store.getState().setFocus(id),
				answer,
			)
			await expect(page.getByTestId("hunt-found")).toBeVisible()
			if (answer !== "moon") {
				await panel.getByRole("button", { name: "Next clue" }).tap()
				await expect(page.getByTestId("hunt-found")).toHaveCount(0)
			}
		}
	})
})

test.describe("on a small phone", () => {
	test.use({
		viewport: { width: 360, height: 640 },
		hasTouch: true,
		isMobile: true,
	})

	test("Saturn's rings fit the width and the system fits the band", async ({
		page,
	}) => {
		await ready(page, "/solar_system?focus=saturn&lang=en")
		const saturn = (await screenOf(page, "saturn"))!
		const rings = SATURN_RINGS * saturn.discPx
		expect(saturn.x - rings).toBeGreaterThanOrEqual(0)
		expect(saturn.x + rings).toBeLessThanOrEqual(360)
		expect(saturn.y + saturn.discPx).toBeLessThan(await cardTop(page))

		await page.getByRole("button", { name: "Back to overview" }).tap()
		await cameraAtRest(page)
		const band = await freeBand(page)
		for (const id of PLANETS) {
			const at = (await screenOf(page, id))!
			expect(at, id).not.toBeNull()
			expect(at.y, id).toBeGreaterThanOrEqual(band.top)
			expect(at.y, id).toBeLessThanOrEqual(band.bottom)
		}
	})
})

test("a laptop keeps its framing: centred, the home shot at 45 degrees", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1366, height: 768 })
	await ready(page, "/solar_system?lang=en")
	const camera = await page.evaluate(() => window.__orbitalia!.camera())
	expect(camera.elevationDeg).toBeCloseTo(45, 6)
	expect(camera.pivotLift).toBe(0)
	await expect(page.locator("[data-free-area]")).toBeHidden()
	const sun = (await screenOf(page, "sun"))!
	expect(sun.x).toBeCloseTo(683, 0)
	expect(sun.y).toBeCloseTo(384, 0)
})
