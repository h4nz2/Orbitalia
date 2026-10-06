import { expect, test, type Page } from "@playwright/test"

// The first ten seconds (#30): a first-time visitor gets the opening (close on
// Earth in true scale, pull back, the switch to Everything visible) and a
// hand-over with hints and a pulsing Earth; a returning visitor and a shared
// link never do. playwright.config.ts makes every visitor a returning one;
// these tests clear that to arrive for the first time.

test.describe.configure({ timeout: 180_000 })

const firstVisit = { storageState: { cookies: [], origins: [] } }

const handle = async (page: Page) =>
	page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})

const state = (page: Page) =>
	page.evaluate(() => {
		const { view, selectedId, sequence, transition } =
			window.__orbitalia!.store.getState()
		const scale = window.__orbitalia!.scale.getState()
		return {
			view,
			selectedId,
			sequence:
				sequence === null
					? null
					: { index: sequence.index, phase: sequence.phase },
			steps: sequence?.steps.map((step) => step.durationMs ?? null) ?? null,
			transition: transition !== null,
			scale: scale.targetId,
			preset: scale.presetId,
		}
	})

const seen = (page: Page) =>
	page.evaluate(() => window.localStorage.getItem("orbitalia.introSeen"))

interface OpeningLog {
	steps: { index: number; view: string; scale: string; planned: number }[]
	captions: { beat: string; text: string }[]
}

/**
 * Records every beat as it happens (the sequence's steps, frame by frame, and
 * the captions as they are rendered), so a slow machine that races through a
 * short hold cannot make a check miss it.
 */
const recordOpening = (page: Page) =>
	page.addInitScript(() => {
		const log: OpeningLog = { steps: [], captions: [] }
		;(window as unknown as { __openingLog: OpeningLog }).__openingLog = log
		let lastIndex = -1
		const tick = () => {
			const handle = window.__orbitalia
			const state = handle?.store.getState()
			const sequence = state?.sequence
			if (handle && state && sequence && sequence.index !== lastIndex) {
				lastIndex = sequence.index
				log.steps.push({
					index: sequence.index,
					view: state.view.kind === "body" ? state.view.id : state.view.kind,
					scale: String(handle.scale.getState().targetId),
					planned: sequence.steps.reduce(
						(ms, step) => ms + (step.durationMs ?? 0) + (step.holdMs ?? 0),
						0,
					),
				})
			}
			requestAnimationFrame(tick)
		}
		requestAnimationFrame(tick)
		let lastBeat: string | null = null
		new MutationObserver(() => {
			const card = document.querySelector("[data-testid=intro]")
			const beat = card?.getAttribute("data-beat") ?? null
			if (card && beat !== null && beat !== lastBeat) {
				lastBeat = beat
				log.captions.push({ beat, text: card.textContent ?? "" })
			}
		}).observe(document, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		})
	})

const opening = (page: Page) =>
	page.evaluate(
		() => (window as unknown as { __openingLog: OpeningLog }).__openingLog,
	)

const skip = (page: Page) => page.getByTestId("intro-skip")
const hints = (page: Page) => page.getByTestId("intro-hints")

test.describe("a first visit", () => {
	test.use(firstVisit)

	test("opens close on Earth, pulls back in true scale and hands over in the default view", async ({
		page,
	}) => {
		await recordOpening(page)
		await page.goto("/solar_system")
		// skippable from the very first frame
		await expect(skip(page)).toBeVisible({ timeout: 60_000 })
		await handle(page)
		expect(await seen(page)).toBe("1")

		// hand-over: the overview a reset shows, in Everything visible, with hints and Earth pulsing
		await expect(hints(page)).toBeVisible({ timeout: 60_000 })
		await expect(page.getByTestId("intro")).toHaveCount(0)

		// every beat played, in order: Earth and the Moon, the inner planets and the
		// whole system in true scale, then the switch to Everything visible
		const log = await opening(page)
		expect(log.steps.map((step) => step.index)).toEqual([0, 1, 2, 3, 4])
		expect(log.steps.map((step) => step.view)).toEqual([
			"earth",
			"earth",
			"overview",
			"overview",
			"overview",
		])
		expect(log.steps.map((step) => step.scale)).toEqual([
			"trueScale",
			"trueScale",
			"trueScale",
			"trueScale",
			"everythingVisible",
		])
		// the plan is under fifteen seconds
		expect(log.steps[0].planned).toBeLessThan(15_000)
		expect(log.captions.map((caption) => caption.beat)).toEqual([
			"earth",
			"moon",
			"inner",
			"system",
			"scale",
		])
		expect(log.captions[0].text).toContain("This is Earth.")
		expect(log.captions[1].text).toContain("30 Earths")

		const end = await state(page)
		expect(end.view).toEqual({ kind: "overview" })
		expect(end.sequence).toBeNull()
		expect(end.scale).toBe("everythingVisible")
		await expect(page).not.toHaveURL(/[?&](focus|scale|cam)=/)
		await expect(hints(page)).toContainText("Click a planet to fly there")
		await expect(page.getByTestId("intro-pulse")).toHaveCSS(
			"visibility",
			"visible",
		)
		// Earth pulses where Earth is
		const earth = await page.evaluate(() =>
			window.__orbitalia!.screenOf("earth"),
		)
		const ring = await page.getByTestId("intro-pulse").boundingBox()
		expect(earth).not.toBeNull()
		expect(ring).not.toBeNull()
		expect(Math.abs(ring!.x + ring!.width / 2 - earth!.x)).toBeLessThan(
			ring!.width,
		)
		expect(Math.abs(ring!.y + ring!.height / 2 - earth!.y)).toBeLessThan(
			ring!.height,
		)

		// picking a planet stops the pulse
		await page.evaluate(() =>
			window.__orbitalia!.store.getState().setFocus("mars"),
		)
		await expect(page.getByTestId("intro-pulse")).toHaveCSS(
			"visibility",
			"hidden",
		)

		// a returning visitor goes straight to the overview
		await page.goto("/solar_system")
		await handle(page)
		await expect(page.getByTestId("intro")).toHaveCount(0)
		expect((await state(page)).sequence).toBeNull()
	})

	test("Skip ends it at once, from the first frame", async ({ page }) => {
		await page.goto("/solar_system")
		await skip(page).click({ timeout: 60_000 })
		await expect(page.getByTestId("intro")).toHaveCount(0)
		await expect(hints(page)).toBeVisible()
		await handle(page)
		const after = await state(page)
		expect(after.sequence).toBeNull()
		expect(after.view).toEqual({ kind: "overview" })
		expect(after.preset).toBe("everythingVisible")
	})

	test("a shared link opens exactly where it was taken, and the opening waits for a plain visit", async ({
		page,
	}) => {
		await page.goto("/solar_system?focus=jupiter&cam=-40_15_2")
		await handle(page)
		await page.waitForFunction(
			() => window.__orbitalia!.store.getState().transition === null,
		)
		await expect(page.getByTestId("intro")).toHaveCount(0)
		const view = await state(page)
		expect(view.view).toEqual({ kind: "body", id: "jupiter" })
		expect(view.sequence).toBeNull()
		expect(view.scale).toBe("everythingVisible")
		expect(await seen(page)).toBeNull()
	})

	test("a drag takes over: the opening ends and the planets grow back", async ({
		page,
	}) => {
		await page.goto("/solar_system")
		await handle(page)
		// somewhere in the pull-back
		await page.waitForFunction(
			() => (window.__orbitalia!.store.getState().sequence?.index ?? 0) >= 1,
			null,
			{ timeout: 60_000, polling: "raf" },
		)
		// the stop the opening was heading to when the drag took over: noted by the
		// store itself, since a loaded machine may move on to the next stop between
		// any reading taken here and the drag
		await page.evaluate(() => {
			const probe = window as unknown as { heading?: unknown }
			window.__orbitalia!.store.subscribe((now, previous) => {
				if (now.sequence !== null || previous.sequence !== null) {
					probe.heading = now.view
				}
			})
		})
		const box = (await page.locator("canvas").first().boundingBox())!
		const x = box.x + box.width * 0.3
		const y = box.y + box.height * 0.4
		await page.mouse.move(x, y)
		await page.mouse.down()
		await page.mouse.move(x + 120, y - 30, { steps: 6 })
		await page.mouse.up()
		await expect(page.getByTestId("intro")).toHaveCount(0)
		await expect(hints(page)).toBeVisible()
		const after = await state(page)
		expect(after.sequence).toBeNull()
		expect(after.scale).toBe("everythingVisible")
		const before = (await page.evaluate(
			() => (window as unknown as { heading?: unknown }).heading,
		)) as typeof after.view
		// the stop it was heading to is still where the camera arrives: nothing flew away
		if (before.kind === "body") expect(after.view).toEqual(before)
		else expect(after.view.kind).not.toBe("body")
	})

	test("with reduced motion the shots are cuts", async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" })
		await page.goto("/solar_system")
		await handle(page)
		await expect(skip(page)).toBeVisible()
		const start = await state(page)
		expect(start.steps).toEqual([0, 0, 0, 0, 0])
		await page.waitForFunction(
			() => (window.__orbitalia!.store.getState().sequence?.index ?? 0) >= 2,
			null,
			{ timeout: 60_000, polling: "raf" },
		)
		expect(
			(await page.evaluate(() => window.__orbitalia!.camera())).durationMs ?? 0,
		).toBe(0)
		await expect(hints(page)).toBeVisible({ timeout: 60_000 })
		expect((await state(page)).preset).toBe("everythingVisible")
	})

	test("on a phone, in German at the simple level", async ({ browser }) => {
		const context = await browser.newContext({
			viewport: { width: 390, height: 844 },
			isMobile: true,
			hasTouch: true,
		})
		const page = await context.newPage()
		await recordOpening(page)
		await page.goto("/solar_system?lang=de&reading=simple")
		const button = skip(page)
		await expect(button).toBeVisible({ timeout: 60_000 })
		expect((await opening(page)).captions[0].text).toContain(
			"Das ist die Erde.",
		)
		await expect(button).toHaveText("Überspringen")
		const box = (await button.boundingBox())!
		expect(box.x).toBeGreaterThanOrEqual(0)
		expect(box.x + box.width).toBeLessThanOrEqual(390)
		expect(box.y + box.height).toBeLessThanOrEqual(844)
		await button.tap()
		await expect(hints(page)).toContainText(
			"Tippe auf einen Planeten, um ihn zu besuchen",
		)
		await expect(hints(page)).toContainText("Mit zwei Fingern zoomen")
		await context.close()
	})
})

test("a returning visitor replays it from the Help menu, and Escape ends it", async ({
	page,
}) => {
	await page.goto("/solar_system")
	await handle(page)
	await expect(page.getByTestId("intro")).toHaveCount(0)
	await page.getByTestId("intro-menu").click()
	await page.getByRole("menuitem", { name: "Play the opening again" }).click()
	await expect(page.getByTestId("intro")).toBeVisible()
	// the replay starts over, close on Earth, in true scale
	const replay = await state(page)
	expect(replay.sequence?.index ?? 99).toBeLessThanOrEqual(2)
	expect(replay.scale).toBe("trueScale")
	await page.keyboard.press("Escape")
	await expect(page.getByTestId("intro")).toHaveCount(0)
	const after = await state(page)
	expect(after.view).toEqual({ kind: "overview" })
	expect(after.preset).toBe("everythingVisible")
})
