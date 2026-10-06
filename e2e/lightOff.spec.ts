/**
 * Turning the light flash off (issue #38): from the closed light button, from
 * the flash itself in the scene, from the panel on every tab, with the
 * presenter's X key; and a flash that has passed the planets fades out by
 * itself (running time backwards brings it back).
 */
import { expect, test, type Page } from "@playwright/test"
import { openTool } from "./support/hud"

// every test clicks through the panel while swiftshader renders the scene at a few fps
test.describe.configure({ timeout: 60_000 })

async function open(page: Page, search = ""): Promise<void> {
	await page.goto(`/solar_system?${search}`)
	await page.waitForLoadState("networkidle")
	await expect(page.locator("time")).toBeVisible()
}

const frontLabel = (page: Page) => page.locator("[data-light-front-label]")
const hudStop = (page: Page) => page.locator("[data-light-stop=hud]")
const panelStop = (page: Page) => page.locator("[data-light-stop=panel]")

/** Opens the panel, sends a flash from the Sun and closes the panel again. */
async function sendFlash(page: Page): Promise<void> {
	await openTool(page, "light")
	const panel = page.locator("[data-light-panel]")
	await panel.getByRole("button", { name: "Send a flash" }).click()
	await expect(frontLabel(page)).toHaveCSS("visibility", "visible")
	await panel.getByRole("button", { name: "Close" }).click()
	await expect(panel).toBeHidden()
}

const expectFlashGone = async (page: Page) => {
	await expect(frontLabel(page)).toHaveCount(0)
	await expect(hudStop(page)).toHaveCount(0)
}

test("the closed light button shows the running flash and stops it in one click", async ({
	page,
}) => {
	await open(page)
	await expect(hudStop(page)).toHaveCount(0)
	await sendFlash(page)
	await expect(hudStop(page)).toBeVisible()
	await expect(hudStop(page)).toHaveAccessibleName("Stop the flash")
	await hudStop(page).click()
	await expectFlashGone(page)
	// the clock goes with the flash (#42); the next flash starts from Tools
	await expect(page.locator("[data-light-slot=chip]")).toHaveCount(0)
	await expect(page.getByTestId("tools-menu")).toBeVisible()
})

test("the flash in the scene carries its own stop button", async ({ page }) => {
	await open(page)
	await sendFlash(page)
	// the label rides on the growing front: hold it still to aim at it
	await page.getByRole("button", { name: "Pause" }).click()
	const view = await page.evaluate(
		() => window.__orbitalia!.store.getState().view,
	)
	const stop = page.locator("[data-light-front-stop]")
	await expect(stop).toHaveAccessibleName("Stop the flash")
	await stop.click()
	await expectFlashGone(page)
	// the click stayed on the button: the scene underneath did not take it as a click on empty space
	expect(
		await page.evaluate(() => window.__orbitalia!.store.getState().view),
	).toEqual(view)
})

test("in the panel, a stop button on every tab; X stops it from the keyboard", async ({
	page,
}) => {
	await open(page)
	await openTool(page, "light")
	const panel = page.locator("[data-light-panel]")
	await expect(panelStop(page)).toHaveCount(0)
	await panel.getByRole("button", { name: "Send a flash" }).click()
	for (const tab of ["Signal delay", "Farther out", "Flash"]) {
		await panel.getByText(tab, { exact: true }).click()
		await expect(panelStop(page)).toBeVisible()
	}
	await panelStop(page).click()
	await expect(panelStop(page)).toHaveCount(0)
	await expect(frontLabel(page)).toHaveCount(0)
	await panel.getByRole("button", { name: "Close" }).click()

	// the presenter's key, with the panel closed
	await sendFlash(page)
	await page.locator("body").press("x")
	await expectFlashGone(page)
	await expect(page.getByText("Light flash stopped")).toBeAttached()
})

test("a flash beyond the planets lingers, fades out, and comes back with time reversed", async ({
	page,
}) => {
	await open(page)
	await sendFlash(page)
	await page.getByRole("button", { name: "Pause" }).click()
	const emitJD = await page.evaluate(
		() => window.__orbitalia!.store.getState().simTimeJD,
	)
	const setHoursAfter = (hours: number) =>
		page.evaluate(
			(jd) => window.__orbitalia!.store.getState().setSimTime(jd),
			emitJD + hours / 24,
		)

	// just past Neptune: "beyond the planets", still stoppable
	await setHoursAfter(4.5)
	await expect(frontLabel(page)).toContainText("Beyond the planets")
	await expect(frontLabel(page)).toHaveCSS("visibility", "visible")
	await expect(hudStop(page)).toBeVisible()

	// well past: faded out, and nothing left to stop
	await setHoursAfter(8)
	await expect(frontLabel(page)).toHaveCSS("visibility", "hidden")
	await expect(hudStop(page)).toHaveCount(0)
	await openTool(page, "light")
	await expect(
		page.locator("[data-light-panel] [data-light-status=faded]"),
	).toBeVisible()
	await expect(panelStop(page)).toHaveCount(0)

	// back in time, the flash is back
	await setHoursAfter(2)
	await expect(frontLabel(page)).toHaveCSS("visibility", "visible")
	await expect(frontLabel(page)).toContainText("Light ·")
	await expect(panelStop(page)).toBeVisible()
})
