import { expect, test, type Page } from "@playwright/test"

// The first ten seconds (#30): a first-time visitor gets the opening (close on
// Earth in true scale, pull back, the switch to Everything visible) and a
// hand-over with hints and a pulsing Earth; a returning visitor and a shared
// link never do. Slow enough to read, at the viewer's own pace (#49): every
// caption holds for its reading time, Space or a tap pauses it, Next steps it.
// playwright.config.ts makes every visitor a returning one; these tests clear
// that to arrive for the first time.

test.describe.configure({ timeout: 180_000 })

const firstVisit = { storageState: { cookies: [], origins: [] } }

const handle = async (page: Page) =>
	page.waitForFunction(() => window.__orbitalia !== undefined, null, {
		timeout: 60_000,
	})

const state = (page: Page) =>
	page.evaluate(() => {
		const { view, selectedId, sequence, transition, paused } =
			window.__orbitalia!.store.getState()
		const scale = window.__orbitalia!.scale.getState()
		return {
			view,
			selectedId,
			sequence:
				sequence === null
					? null
					: {
							index: sequence.index,
							phase: sequence.phase,
							paused: sequence.paused === true,
						},
			steps: sequence?.steps.map((step) => step.durationMs ?? null) ?? null,
			holds: sequence?.steps.map((step) => step.holdMs ?? 0) ?? null,
			transition: transition !== null,
			scale: scale.targetId,
			preset: scale.presetId,
			/** The clock's own pause (the time bar), not the opening's. */
			clockPaused: paused,
		}
	})

const seen = (page: Page) =>
	page.evaluate(() => window.localStorage.getItem("orbitalia.introSeen"))

interface OpeningLog {
	steps: { index: number; view: string; scale: string; planned: number }[]
	/** Each caption as it is rendered (the whole card, and its title and detail), and when (performance.now(), ms). */
	captions: { beat: string; text: string; caption: string; at: number }[]
	/** When the hand-over hints appeared. */
	hintsAt: number | null
}

/**
 * Records every beat as it happens (the sequence's steps, frame by frame, and
 * the captions as they are rendered), so a slow machine that races through a
 * short hold cannot make a check miss it.
 */
const recordOpening = (page: Page) =>
	page.addInitScript(() => {
		const log: OpeningLog = { steps: [], captions: [], hintsAt: null }
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
				log.captions.push({
					beat,
					text: card.textContent ?? "",
					caption: [...card.querySelectorAll("p")]
						.map((p) => p.textContent)
						.join(" "),
					at: performance.now(),
				})
			}
			if (
				log.hintsAt === null &&
				document.querySelector("[data-testid=intro-hints]") !== null
			) {
				log.hintsAt = performance.now()
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

/** How long reading `text` aloud at a calm pace takes (#49): 1.5 s + 0.45 s a word, at least 3.5 s. */
const toRead = (text: string) =>
	Math.max(
		3500,
		1500 +
			450 *
				text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length,
	)

const skip = (page: Page) => page.getByTestId("intro-skip")
const next = (page: Page) => page.getByTestId("intro-next")
const pause = (page: Page) => page.getByTestId("intro-pause")
const paused = (page: Page) => page.getByTestId("intro-paused")
const card = (page: Page) => page.getByTestId("intro")
const hints = (page: Page) => page.getByTestId("intro-hints")

/** Waits until the caption of `beat` is on screen. */
const onBeat = (page: Page, beat: string) =>
	expect(card(page)).toHaveAttribute("data-beat", beat, { timeout: 60_000 })

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

		// the first caption runs its course; the middle three are stepped with Next (what a
		// natural hold looks like is measured on the first and the last); the last runs out
		await onBeat(page, "moon")
		for (const beat of ["inner", "system", "scale"]) {
			await next(page).click()
			await onBeat(page, beat)
		}

		// hand-over: the overview a reset shows, in Everything visible, with hints and Earth pulsing
		await expect(hints(page)).toBeVisible({ timeout: 60_000 })
		await expect(card(page)).toHaveCount(0)

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
		// slow enough to read (#49): close to a minute in all, every caption with its reading time
		expect(log.steps[0].planned).toBeGreaterThan(30_000)
		expect(log.captions.map((caption) => caption.beat)).toEqual([
			"earth",
			"moon",
			"inner",
			"system",
			"scale",
		])
		expect(log.captions[0].text).toContain("This is Earth.")
		expect(log.captions[1].text).toContain("30 Earths")
		// the first and the last caption stayed up at least as long as reading them aloud takes
		expect(log.captions[1].at - log.captions[0].at).toBeGreaterThan(
			toRead(log.captions[0].caption),
		)
		expect(log.hintsAt! - log.captions[4].at).toBeGreaterThan(
			toRead(log.captions[4].caption),
		)

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
		await expect(card(page)).toHaveCount(0)
		await expect(hints(page)).toBeVisible()
		await handle(page)
		const after = await state(page)
		expect(after.sequence).toBeNull()
		expect(after.view).toEqual({ kind: "overview" })
		expect(after.preset).toBe("everythingVisible")
		// and the quick look's question follows, as after a whole opening (#44)
		await expect(page.getByTestId("quick-look-ask")).toBeVisible()
	})

	test("pauses on a caption with Space, a tap or the button, and steps on with Next", async ({
		page,
	}) => {
		await page.goto("/solar_system?lang=en")
		await handle(page)
		await expect(pause(page)).toHaveAccessibleName("Pause")

		// Space holds the opening on its caption, and never pauses the clock underneath
		await page.keyboard.press("Space")
		await expect(paused(page)).toBeVisible()
		await expect(paused(page)).toHaveText("Paused")
		await expect(pause(page)).toHaveAccessibleName("Continue")
		let now = await state(page)
		// (the first caption, unless a very slow machine took ten seconds to press a key)
		const at = now.sequence!.index
		expect(now.sequence).toMatchObject({ paused: true })
		expect(now.clockPaused).toBe(false)
		// it stays put: the hold is not running out behind the viewer's back
		await page.waitForFunction(
			() => window.__orbitalia!.store.getState().sequence?.phase === "waiting",
		)
		expect(
			await page.evaluate(
				() => window.__orbitalia!.store.getState().sequence?.holdUntil,
			),
		).toBeNull()
		await page.keyboard.press("Space")
		await expect(paused(page)).toHaveCount(0)
		now = await state(page)
		expect(now.sequence).toMatchObject({ index: at, paused: false })
		expect(now.clockPaused).toBe(false)

		// a tap on the scene (on Earth, while it is the close-up): it pauses, it does not fly anywhere
		const box = (await page.locator("canvas").first().boundingBox())!
		await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4)
		await expect(paused(page)).toBeVisible()
		now = await state(page)
		expect(now.selectedId).toBeNull()
		expect(now.sequence).toMatchObject({ index: at, paused: true })

		// Next steps on and the pause holds on the next beat; the button carries on
		const beats = ["earth", "moon", "inner", "system", "scale"]
		await next(page).click()
		await onBeat(page, beats[at + 1])
		await expect(paused(page)).toBeVisible()
		await pause(page).click()
		await expect(paused(page)).toHaveCount(0)
		// the right arrow is Next too
		await page.keyboard.press("ArrowRight")
		await onBeat(page, beats[at + 2])
		expect((await state(page)).sequence?.index).toBe(at + 2)
		for (const beat of beats.slice(at + 3)) {
			await next(page).click()
			await onBeat(page, beat)
		}
		await expect
			.poll(async () => (await state(page)).scale)
			.toBe("everythingVisible")
		// Next on the last beat ends the opening: the hand-over, then the quick look's question
		await next(page).click()
		await expect(card(page)).toHaveCount(0)
		await expect(hints(page)).toBeVisible()
		const end = await state(page)
		expect(end.sequence).toBeNull()
		expect(end.view).toEqual({ kind: "overview" })
		await expect(page.getByTestId("quick-look-ask")).toBeVisible()
	})

	test("paused, the viewer can look around without ending it, and Skip still works", async ({
		page,
	}) => {
		await page.goto("/solar_system?lang=en")
		await handle(page)
		await onBeat(page, "earth")
		await pause(page).click()
		await expect(paused(page)).toBeVisible()
		const box = (await page.locator("canvas").first().boundingBox())!
		const x = box.x + box.width * 0.3
		const y = box.y + box.height * 0.4
		await page.mouse.move(x, y)
		await page.mouse.down()
		await page.mouse.move(x + 120, y - 30, { steps: 6 })
		await page.mouse.up()
		// the drag turned the view and was not taken for a tap
		await expect(paused(page)).toBeVisible()
		expect((await state(page)).sequence).toMatchObject({
			index: 0,
			paused: true,
		})
		await skip(page).click()
		await expect(card(page)).toHaveCount(0)
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
		await expect(card(page)).toHaveCount(0)
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

	test("with reduced motion the shots are cuts, held just as long to read", async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" })
		await page.goto("/solar_system")
		await handle(page)
		await expect(skip(page)).toBeVisible()
		const start = await state(page)
		expect(start.steps).toEqual([0, 0, 0, 0, 0])
		// the same reading time: no beat under 3.5 s, well over half a minute in all
		for (const hold of start.holds!) expect(hold).toBeGreaterThanOrEqual(3500)
		expect(start.holds!.reduce((ms, hold) => ms + hold, 0)).toBeGreaterThan(
			30_000,
		)
		// held on its caption, so a hold that runs out on a slow machine never
		// overtakes a click; Next steps on and the pause holds on the next beat
		await pause(page).click()
		await expect(paused(page)).toBeVisible()
		const beats = ["earth", "moon", "inner", "system", "scale"]
		let at = (await state(page)).sequence!.index
		const stepTo = async (beat: string) => {
			while (at < beats.indexOf(beat)) {
				await next(page).click()
				at += 1
				await onBeat(page, beats[at])
			}
		}
		await stepTo("inner")
		expect(
			(await page.evaluate(() => window.__orbitalia!.camera())).durationMs ?? 0,
		).toBe(0)
		await stepTo("scale")
		expect((await state(page)).preset).toBe("everythingVisible")
		await next(page).click()
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
		await expect(next(page)).toHaveText("Weiter")
		// every control fits on the phone's screen
		for (const control of [button, next(page), pause(page)]) {
			const box = (await control.boundingBox())!
			expect(box.x).toBeGreaterThanOrEqual(0)
			expect(box.x + box.width).toBeLessThanOrEqual(390)
			expect(box.y + box.height).toBeLessThanOrEqual(844)
		}
		// a tap on the picture holds it, another carries on
		await page.touchscreen.tap(195, 300)
		await expect(paused(page)).toHaveText("Angehalten")
		await page.touchscreen.tap(195, 300)
		await expect(paused(page)).toHaveCount(0)
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
	await expect(card(page)).toBeVisible()
	// the replay starts over, close on Earth, in true scale
	const replay = await state(page)
	expect(replay.sequence?.index ?? 99).toBeLessThanOrEqual(2)
	expect(replay.scale).toBe("trueScale")
	await page.keyboard.press("Escape")
	await expect(card(page)).toHaveCount(0)
	const after = await state(page)
	expect(after.view).toEqual({ kind: "overview" })
	expect(after.preset).toBe("everythingVisible")
})
