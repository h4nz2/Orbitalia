/**
 * The date keeps its width (#71): the buttons beside it never move while time
 * runs. No year runs in real time here: links open paused on days with some of
 * the shortest and the longest dates of the year in each language, and the
 * buttons beside the date stand at the same place on every one, within a pixel.
 * On a laptop that is the time bar (reverse, pause, play, the date, the speed);
 * on a phone held upright the time chip (play, then the speed with the short
 * date) and the time controls it opens in the sheet (the date over the time).
 */
import { expect, test, type Locator, type Page } from "@playwright/test"

import { boxesAtOnce } from "./support/hud"

interface Day {
	/** the day, as `<time dateTime>` starts */
	day: string
	/** noon UTC on it, as a Julian date for the link */
	jd: number
}

const DAYS: Day[] = [
	{ day: "2026-01-01", jd: 2461042 }, // "1. 1. 2026" in Czech
	{ day: "2026-01-28", jd: 2461069 }, // "28. Jan. 2026", "28 janv. 2026"
	{ day: "2026-05-01", jd: 2461162 }, // "01. Mai 2026", "01 mai 2026", "01 may 2026"
	{ day: "2026-09-28", jd: 2461312 }, // "28. Sept. 2026", "28 sept 2026"
	{ day: "2026-10-28", jd: 2461342 }, // "28. 10. 2026" in Czech
]

const LANGUAGES = ["en", "de", "cs", "es", "fr"]

/** Opens the paused link for `day` in `lang` and waits until `clock` shows that day. */
async function openDay(
	page: Page,
	{ day, jd }: Day,
	lang: string,
	clock: Locator,
) {
	await page.goto(`/solar_system?t=${jd}&paused=true&lang=${lang}`)
	await expect(clock).toHaveAttribute("datetime", `${day}T12:00Z`, {
		timeout: 60_000,
	})
}

/** The left and right edge of each element, all read in the same instant. */
const edges = async (locators: Locator[]): Promise<number[]> =>
	(await boxesAtOnce(...locators)).flatMap(({ x, width }) => [x, x + width])

/** Every day's edges are the first day's, within a pixel. */
function expectSteady(measured: { day: string; edges: number[] }[]) {
	const [first, ...rest] = measured
	for (const { day, edges } of rest)
		edges.forEach((x, index) =>
			expect(
				Math.abs(x - first.edges[index]),
				`${day}, edge ${index}: ${x} px, on ${first.day} ${first.edges[index]} px`,
			).toBeLessThanOrEqual(1),
		)
}

test.describe("on a laptop", () => {
	test.use({ viewport: { width: 1366, height: 768 } })

	test("the time bar's buttons stay put through the year, in German", async ({
		page,
	}) => {
		// one fresh link per day, each with its software-rendered scene
		test.slow()
		const bar = page.getByTestId("time-bar")
		const transport = bar.locator("button[aria-pressed]")
		const measured = []
		for (const day of DAYS) {
			await openDay(page, day, "de", bar.locator("time"))
			await expect(transport).toHaveCount(3)
			measured.push({
				day: day.day,
				edges: await edges([
					transport.nth(0),
					transport.nth(1),
					transport.nth(2),
					bar.locator("time"),
					bar.getByTestId("time-menu"),
				]),
			})
		}
		expectSteady(measured)
	})
})

const phones = [
	...LANGUAGES.map((lang) => ({ lang, width: 390, height: 844 })),
	{ lang: "de", width: 360, height: 640 },
]

for (const { lang, width, height } of phones)
	test.describe(`on a ${width}×${height} phone held upright`, () => {
		test.use({ viewport: { width, height }, hasTouch: true, isMobile: true })

		test(`${lang}: the time chip and the time controls stay put through the year`, async ({
			page,
		}) => {
			test.slow()
			const chip = page.getByTestId("time-chip")
			const panel = page.getByTestId("time-panel")
			const transport = panel.locator("button[aria-pressed]")
			const measured = []
			for (const day of DAYS) {
				await openDay(page, day, lang, chip.locator("time"))
				await chip.getByTestId("time-menu").tap()
				await expect(panel.locator("time")).toHaveAttribute(
					"datetime",
					`${day.day}T12:00Z`,
				)
				await expect(transport).toHaveCount(3)
				measured.push({
					day: day.day,
					edges: await edges([
						chip.getByTestId("chip-play"),
						chip.getByTestId("time-menu"),
						chip.locator("time"),
						transport.nth(0),
						transport.nth(1),
						transport.nth(2),
						panel.locator("time"),
					]),
				})
			}
			expectSteady(measured)
		})
	})
