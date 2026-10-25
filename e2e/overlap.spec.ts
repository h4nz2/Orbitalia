/**
 * Nothing on screen overlaps (#76): every "try it" link of the help page
 * (read from src/data/help.json, so a new entry is checked without touching
 * this file) and a few moments no link opens (the quick look two steps in, a
 * flight under way, a card unfolded, the gesture hint, the Share panel), on
 * two phones held upright with touch in English and in German at the simple
 * level (the longest words), and on a laptop in English. Each screen waits
 * until it has settled, then e2e/support/overlap.ts compares every pair of
 * visible texts and controls. The overlaps known when this landed are in
 * ./overlap.allow.ts with the issue that fixes them; anything else fails, and
 * so does a listed overlap that no longer occurs. See docs/ARCHITECTURE.md,
 * "Size classes, finger sizes and screen edges".
 */
import { appendFileSync, readFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page, type TestInfo } from "@playwright/test"

import { ALLOWED, type Allowed, type Lang, type Size } from "./overlap.allow"
import { stubTurnstile } from "./support/feedback"
import { expandCard, pageInPlace } from "./support/hud"
import { skipDrawing } from "./support/noDrawing"
import {
	findOverlaps,
	layoutAtRest,
	namesAtRest,
	SCENE_NAMES,
	type Box,
	type Findings,
	type Overlap,
} from "./support/overlap"
import { cameraAtRest } from "./support/scene"

// software WebGL is slow, and a screen waits for its scene to settle
test.describe.configure({ timeout: 120_000 })
// a failure attaches its own picture, with the overlaps outlined; no trace,
// which would record every one of a test's screens
test.use({ screenshot: "off", trace: "off" })

const helpData = JSON.parse(
	readFileSync(path.join("src", "data", "help.json"), "utf8"),
) as { entries: { id: string; try: string }[] }

/**
 * A date for the links that bring none, so the planets and their names stand
 * in the same places every day (24 Oct 2026).
 */
const PINNED_JD = "2461337.5"

/** A clock faster than this moves the names too fast to judge in one look. */
const FAST_WARP = 3600

/** The longest any one wait may take (set as the page's default timeout). */
const WAIT_MS = 20_000

/** The longest one screen may take, every wait and its look included: past it, it reports itself stuck. */
const SCREEN_MS = 90_000

const GESTURE_HINT_SHOWN = "orbitalia.gestureHintShown"

interface Screen {
	/** Its name in the test's title and in the allow-list's `screens`. */
	name: string
	/** The address, without lang and reading. */
	url: string
	/** Local storage keys cleared first: a first-time visitor. */
	clear?: string[]
	/** Only on these sizes (a phone's own moment). */
	sizes?: Size[]
	/** Holds a moment that would pass by itself, as soon as the page is up. */
	hold?: (page: Page) => Promise<void>
	/** What to do once the page has settled; the check follows when it has settled again. */
	act?: (page: Page) => Promise<void>
	/** A moment that passes: checked as soon as it is there, not when the scene rests. */
	moving?: boolean
	/** Whether the moment was still there when the check looked (a flight still under way). */
	still?: (page: Page) => Promise<boolean>
}

const PHONES: Size[] = ["360x640", "390x844"]

/** Holds the opening on its first caption (Space or the card's pause; ← back to it if it moved on). */
async function firstCaption(page: Page) {
	const card = page.getByTestId("intro")
	await card.waitFor({ timeout: 60_000 })
	await page.getByTestId("intro-pause").click()
	await expect(card).toHaveAttribute("data-paused", "true")
	const until = Date.now() + WAIT_MS
	while ((await card.getAttribute("data-beat")) !== "earth") {
		if (Date.now() > until)
			throw new Error("the opening never went back to its first caption")
		await page.keyboard.press("ArrowLeft")
	}
}

/** The quick look holds still on its first step: its autoplay off (Back to the first step if it moved on). */
async function quickLookHeld(page: Page) {
	const auto = page.getByTestId("quick-look-auto")
	await auto.waitFor({ timeout: 60_000 })
	if ((await auto.getAttribute("aria-pressed")) === "true") await auto.click()
	await expect(auto).toHaveAttribute("aria-pressed", "false")
	const count = page.getByTestId("quick-look-count")
	const until = Date.now() + WAIT_MS
	while (!/^1\D/.test((await count.textContent()) ?? "")) {
		if (Date.now() > until)
			throw new Error("the quick look never went back to its first step")
		await quickLookButton(page, "first").click()
	}
}

/** The quick look's Back (`first`) or Next (`last`), at its foot. */
const quickLookButton = (page: Page, which: "first" | "last") =>
	page.getByTestId("quick-look").locator("[data-sheet-footer] button")[which]()

/** A link that plays something on its own is held still first, so it is the same screen every time. */
const HOLD: Record<string, (page: Page) => Promise<void>> = {
	"intro=play": firstCaption,
	"look=play": quickLookHeld,
}

/**
 * One screen per link, and links that differ only in their date (`t`) are
 * one screen: a link without a date gets one anyway, and the date moves the
 * planets, not the interface (the day and night link is a planet's link).
 */
const helpScreens = (): Screen[] => {
	const byLink = new Map<string, { url: string; ids: string[] }>()
	for (const entry of helpData.entries) {
		const url = new URL(entry.try, "http://x")
		url.searchParams.delete("t")
		const key = `${url.pathname}${url.search}`
		const screen = byLink.get(key) ?? { url: entry.try, ids: [] }
		screen.ids.push(entry.id)
		byLink.set(key, screen)
	}
	return [...byLink.values()].map(({ url, ids }) => ({
		name: ids.join(", "),
		url,
		hold: Object.entries(HOLD).find(([part]) => url.includes(part))?.[1],
	}))
}

const EXTRA_SCREENS: Screen[] = [
	{
		name: "the quick look, two steps in",
		url: "/solar_system?look=play",
		hold: quickLookHeld,
		act: async (page) => {
			const count = page.getByTestId("quick-look-count")
			for (const n of [2, 3]) {
				await quickLookButton(page, "last").click()
				await expect(count).toHaveText(new RegExp(`^${n}\\D`))
			}
		},
	},
	{
		name: "a flight under way",
		url: "/solar_system?focus=earth",
		moving: true,
		act: async (page) => {
			await cameraAtRest(page)
			await page.keyboard.press("ArrowRight")
			await page.getByTestId("flight-readout").waitFor()
		},
		still: (page) => page.getByTestId("flight-readout").isVisible(),
	},
	{
		name: "the gesture hint",
		url: "/solar_system?focus=earth",
		clear: [GESTURE_HINT_SHOWN],
		sizes: PHONES,
		act: async (page) => {
			await page.getByTestId("gesture-hint").waitFor({ timeout: 30_000 })
		},
	},
	{
		name: "a card unfolded",
		url: "/solar_system?focus=jupiter",
		act: expandCard,
	},
	{
		name: "the Share panel",
		url: "/solar_system?focus=earth",
		sizes: PHONES,
		act: async (page) => {
			await page.getByTestId("more-menu").click()
			await page.getByTestId("more-share-panel").click()
			await page.getByTestId("share-kind").waitFor()
		},
	},
]

const SCREENS = [...helpScreens(), ...EXTRA_SCREENS]

interface Device {
	size: Size
	viewport: { width: number; height: number }
	touch: boolean
	langs: Lang[]
}

const DEVICES: Device[] = [
	{
		size: "360x640",
		viewport: { width: 360, height: 640 },
		touch: true,
		langs: ["en", "de"],
	},
	{
		size: "390x844",
		viewport: { width: 390, height: 844 },
		touch: true,
		// German's longer words at the narrower phone only, for the load
		langs: ["en"],
	},
	{
		size: "1366x768",
		viewport: { width: 1366, height: 768 },
		touch: false,
		langs: ["en"],
	},
]

/** English at the reading level teachers see first; German at the simple level, the children's and longest words. */
const WORDS: Record<Lang, string> = {
	en: "lang=en",
	de: "lang=de&reading=simple",
}

const address = (screen: Screen, lang: Lang) => {
	const url = new URL(screen.url, "http://x")
	if (url.pathname === "/solar_system" && !url.searchParams.has("t"))
		url.searchParams.set("t", PINNED_JD)
	const search = url.search === "" ? "?" : `${url.search}&`
	return `${url.pathname}${search}${WORDS[lang]}`
}

/**
 * The page's entrance (`FadeInOutUp`: up 40 px and in from transparent over
 * 2.5 s, as every page opens) is put at its end at once: the guard judges
 * where the page comes to rest, and the slide alone would be most of each
 * screen's time. Its end is exactly what the slide leaves behind
 * (`GSAPAnimation/AnimateInOut.tsx`): `translate(0px, 0px)` on its wrapper,
 * the one outside every `main` (still a containing block for the page's
 * fixed parts), and `overflow: auto` on every `main`.
 */
const inPlaceAtOnce = () =>
	document.addEventListener("DOMContentLoaded", () => {
		const style = document.createElement("style")
		style.textContent = [
			"div:has(> main):not(main *) { transform: translate(0px, 0px) !important; opacity: 1 !important; }",
			"main { overflow: auto !important; }",
		].join("\n")
		document.head.append(style)
	})

/** Every finite CSS animation and transition has ended (a sheet's snap, a fade, a menu's entrance). */
const animationsDone = (page: Page) =>
	page.waitForFunction(
		() =>
			document.getAnimations().every((animation) => {
				const end = animation.effect?.getComputedTiming().endTime
				return (
					animation.playState !== "running" ||
					end === undefined ||
					!Number.isFinite(Number(end))
				)
			}),
		null,
		{ timeout: WAIT_MS },
	)

/** Stops the clock (the store's pause, as the time bar's button does), so the names stand still. */
const pause = (page: Page) =>
	page.evaluate(() => window.__orbitalia?.store.getState().setPaused(true))

/** Whether the clock runs fast enough to move the names between two looks. */
const runsFast = (page: Page) =>
	page.evaluate((fast) => {
		const state = window.__orbitalia?.store.getState()
		return (
			state !== undefined && !state.paused && Math.abs(state.timeWarp) > fast
		)
	}, FAST_WARP)

/** Waits until the screen has settled: the scene and the camera at rest, the page in place, every fade over, the names placed. */
async function settled(page: Page, screen: Screen) {
	const solar = new URL(screen.url, "http://x").pathname === "/solar_system"
	if (solar) {
		await page.waitForFunction(() => window.__orbitalia !== undefined, null, {
			timeout: 60_000,
		})
		if (screen.moving !== true) await cameraAtRest(page)
	}
	// the page is up (every page but help has the help button, under More on a phone) and nothing is still loading
	await page.waitForFunction(
		() =>
			document.querySelector(
				"[data-testid=help-button], [data-testid=more-menu], [data-testid=help-page]",
			) !== null &&
			[...document.querySelectorAll(".mantine-Loader-root")].every(
				(loader) => !loader.checkVisibility(),
			),
		null,
		{ timeout: 60_000 },
	)
	await pageInPlace(page)
	await page.evaluate(() => document.fonts.ready.then(() => undefined))
	await animationsDone(page)
	if (screen.moving === true) return
	await layoutAtRest(page)
	// last: the names keep out from under the panels as they now stand
	if (solar && !(await runsFast(page))) await namesAtRest(page)
}

/** Both looks of a screen as one: what either found, and a piece on screen in either. */
const merge = (first: Findings, second: Findings): Findings => {
	const key = (found: Overlap) =>
		[found.kind, found.a.name, found.a.text, found.b.name, found.b.text].join(
			"|",
		)
	const seen = new Set(first.overlaps.map(key))
	const offKey = (found: Findings["offScreen"][number]) =>
		`${found.piece.name}|${found.piece.text}|${found.box.left},${found.box.top}`
	const offSeen = new Set(first.offScreen.map(offKey))
	return {
		overlaps: [
			...first.overlaps,
			...second.overlaps.filter((found) => !seen.has(key(found))),
		],
		offScreen: [
			...first.offScreen,
			...second.offScreen.filter((found) => !offSeen.has(offKey(found))),
		],
		present: first.present.map((both, index) => ({
			a: both.a || second.present[index].a,
			b: both.b || second.present[index].b,
		})),
	}
}

/** What the allow-list may call a screen: each help entry sharing its link, or its own name. */
const screenNames = (screen: Screen) => [
	screen.name,
	...screen.name.split(", "),
]

/** The allow-list entries for this screen. */
const listedFor = (device: Device, lang: Lang, screen: Screen): Allowed[] =>
	ALLOWED.filter(
		(entry) =>
			(entry.sizes === undefined || entry.sizes.includes(device.size)) &&
			(entry.langs === undefined || entry.langs.includes(lang)) &&
			entry.screens.some((name) => screenNames(screen).includes(name)),
	)

const describePiece = (piece: Overlap["a"]) =>
	`${piece.name} "${piece.text}"${piece.control ? " (control)" : ""}`

/** The picture of a failure: the page with every problem's box outlined and numbered; returns its file. */
async function picture(
	page: Page,
	boxes: Box[],
	testInfo: TestInfo,
	name: string,
): Promise<string> {
	await page.evaluate((boxes) => {
		const layer = document.createElement("div")
		layer.dataset.overlapPicture = ""
		layer.style.cssText =
			"position:fixed;inset:0;z-index:2147483647;pointer-events:none"
		boxes.forEach((box, index) => {
			const mark = document.createElement("div")
			mark.style.cssText = `position:absolute;left:${box.left - 2}px;top:${box.top - 2}px;width:${box.width + 4}px;height:${box.height + 4}px;outline:2px solid #ff2d55;background:rgba(255,45,85,0.25)`
			const label = document.createElement("span")
			label.textContent = String(index + 1)
			label.style.cssText =
				"position:absolute;left:0;top:-16px;font:bold 12px sans-serif;color:#fff;background:#ff2d55;padding:0 3px"
			mark.append(label)
			layer.append(mark)
		})
		document.body.append(layer)
	}, boxes)
	const file = testInfo.outputPath(
		`overlaps-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.png`,
	)
	await page.screenshot({ path: file })
	await testInfo.attach(`overlaps: ${name}`, {
		path: file,
		contentType: "image/png",
	})
	await page.evaluate(() =>
		document.querySelector("[data-overlap-picture]")?.remove(),
	)
	return file
}

/** What fails the screen: overlaps not listed, listed ones gone, and listed pieces absent. */
function problems(findings: Findings, listed: Allowed[]) {
	const lines: string[] = []
	const boxes: Box[] = []
	for (const found of findings.overlaps) {
		if (found.listed.length > 0) continue
		boxes.push(found.box)
		const on =
			found.onTop === "neither"
				? "neither on top"
				: `${found.onTop.toUpperCase()} on top`
		const what = {
			overlap: `overlap ${found.width}×${found.height} px, ${on}`,
			cut: `a line cut through: ${found.width}×${found.height} px of it under B`,
			covered: `a control covered: ${found.width}×${found.height} px of it under B, out of a finger's reach`,
		}[found.kind]
		lines.push(
			`${boxes.length}. ${what}\n   A: ${describePiece(found.a)}\n   B: ${describePiece(found.b)}`,
		)
	}
	for (const found of findings.offScreen) {
		if (found.listed.length > 0) continue
		boxes.push(found.box)
		lines.push(
			`${boxes.length}. off screen at ${found.box.left},${found.box.top} (${found.box.width}×${found.box.height} px)\n   ${describePiece(found.piece)}`,
		)
	}
	listed.forEach((entry, index) => {
		const name = `"${entry.what}" (#${entry.issue}; ${entry.a} × ${entry.b ?? "off screen"})`
		const absent = [
			findings.present[index].a ? null : entry.a,
			findings.present[index].b ? null : entry.b,
		].filter((selector) => selector != null)
		if (absent.length > 0) {
			lines.push(
				`listed but absent: ${name} names this screen, but ${absent.join(" and ")} is not on it. Gone for good? Remove the entry from e2e/overlap.allow.ts, or narrow its sizes, langs or screens.`,
			)
			return
		}
		const occurs =
			findings.overlaps.some((found) => found.listed.includes(index)) ||
			findings.offScreen.some((found) => found.listed.includes(index))
		if (!occurs)
			lines.push(
				`listed but gone: ${name} no longer occurs here though both are on screen. Fixed? Remove it from e2e/overlap.allow.ts, or narrow its sizes, langs or screens.`,
			)
	})
	return { lines, boxes }
}

/**
 * Looks at one screen on `page` and returns what fails it, each with its
 * picture saved beside the test's results.
 */
async function check(
	page: Page,
	device: Device,
	lang: Lang,
	screen: Screen,
	testInfo: TestInfo,
): Promise<string[]> {
	const url = address(screen, lang)
	await page.goto(url)
	await screen.hold?.(page)
	await settled(page, { ...screen, moving: false })
	if (screen.act !== undefined) {
		await screen.act(page)
		await settled(page, screen)
	}
	const listed = listedFor(device, lang, screen)
	const selectors = listed.map((entry) => ({
		a: entry.a,
		b: entry.b,
		kind: entry.kind ?? "overlap",
	}))
	let findings: Findings
	if (screen.moving === true)
		// a flight: the names move between two looks, the interface is what it is about
		findings = await findOverlaps(page, selectors, { skip: SCENE_NAMES })
	else if (await runsFast(page)) {
		// a fast clock: the interface as it runs (the too-fast note shows only
		// then), and the names once the clock is paused and they stand still
		const running = await findOverlaps(page, selectors, { skip: SCENE_NAMES })
		await pause(page)
		await layoutAtRest(page)
		await namesAtRest(page)
		findings = merge(running, await findOverlaps(page, selectors))
	} else findings = await findOverlaps(page, selectors)
	if (process.env.OVERLAP_LOG !== undefined)
		appendFileSync(
			process.env.OVERLAP_LOG,
			`${JSON.stringify({ size: device.size, lang, screen: screen.name, url, findings })}\n`,
		)
	const { lines, boxes } = problems(findings, listed)
	if (screen.still !== undefined && !(await screen.still(page)))
		lines.push(
			"the moment had passed before the look: nothing under way was checked",
		)
	if (lines.length === 0) return []
	const file = await picture(page, boxes, testInfo, screen.name)
	return [`${device.size} ${lang} ${url}`, ...lines, `(the picture: ${file})`]
}

/**
 * Screens share a page, a run at a time: each opens with a fresh load, and
 * the warm cache saves about a third of the time a new page per screen
 * costs. A screen that changes what the browser remembers (`clear`) gets a
 * page of its own.
 */
const RUN = 8

for (const device of DEVICES)
	for (const lang of device.langs)
		test.describe(`${device.size} ${lang}`, () => {
			test.use({
				viewport: device.viewport,
				hasTouch: device.touch,
				isMobile: device.touch,
			})

			const screens = SCREENS.filter(
				(screen) =>
					screen.sizes === undefined || screen.sizes.includes(device.size),
			)
			const runs: Screen[][] = screens
				.filter((screen) => screen.clear !== undefined)
				.map((screen) => [screen])
			const shared = screens.filter((screen) => screen.clear === undefined)
			for (let at = 0; at < shared.length; at += RUN)
				runs.push(shared.slice(at, at + RUN))

			for (const run of runs)
				test(
					run.map((screen) => screen.name).join(" | "),
					async ({ page }, testInfo) => {
						test.setTimeout(run.length * SCREEN_MS + 60_000)
						// every wait has its bound, so a stuck screen reports itself
						page.setDefaultTimeout(WAIT_MS)
						await page.addInitScript(inPlaceAtOnce)
						// the guard reads text and boxes, never pixels: the scene runs
						// without drawing (OVERLAP_DRAW=1 draws it, to compare)
						if (process.env.OVERLAP_DRAW === undefined)
							await page.addInitScript(skipDrawing)
						// the feedback page's Turnstile never reaches the network in a test
						await stubTurnstile(page)
						const clear = run[0].clear
						if (clear !== undefined)
							await page.addInitScript((keys) => {
								for (const key of keys) localStorage.removeItem(key)
							}, clear)
						const failures: string[] = []
						for (const screen of run) {
							// a screen that never settles, or not in time, is a failure of
							// its own; the next one still gets its look
							const stuck = (why: string) => [
								`${device.size} ${lang} ${address(screen, lang)}: ${why}`,
							]
							let timer: ReturnType<typeof setTimeout> | undefined
							let late = false
							const lines = await Promise.race([
								check(page, device, lang, screen, testInfo).catch(
									(error: Error) => stuck(error.message.split("\n")[0]),
								),
								new Promise<string[]>((resolve) => {
									timer = setTimeout(() => {
										late = true
										resolve(stuck(`not done in ${SCREEN_MS / 1000} s`))
									}, SCREEN_MS)
								}),
							])
							clearTimeout(timer)
							// leaving the page ends whatever the late screen still waits for
							if (late) await page.goto("about:blank").catch(() => undefined)
							failures.push(...lines)
						}
						expect(failures).toEqual([])
					},
				)
		})
