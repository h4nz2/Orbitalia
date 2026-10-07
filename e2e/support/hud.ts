/**
 * The quiet HUD (#42): most controls wait behind an entry point. These open
 * the right one first (and do nothing when it is already open), so a test
 * can then reach the control by its role and name as before.
 */
import type { Locator, Page } from "@playwright/test"

/** A panel of the dock opened from its entry point: "layers" or "scale". */
export async function openPanel(
	page: Page,
	panel: "layers" | "scale",
): Promise<Locator> {
	const button = page.locator(`[data-entry="${panel}"]`)
	if ((await button.getAttribute("aria-expanded")) !== "true")
		await button.click()
	const region = page.locator(`[data-dock-panel="${panel}"]`)
	await region.waitFor()
	return region
}

/** The layer switches (Orbits, Labels, Moons, …), in the Layers panel. */
export const openLayers = (page: Page): Promise<Locator> =>
	openPanel(page, "layers")

/** The scale presets and the honesty statements, in the Scale panel. */
export const openScale = (page: Page): Promise<Locator> =>
	openPanel(page, "scale")

/** The time popover: Now, the speed presets and the spin. */
export async function openTime(page: Page): Promise<Locator> {
	const button = page.getByTestId("time-menu")
	const popover = page.getByTestId("time-panel")
	if (!(await popover.isVisible())) await button.click()
	await popover.waitFor()
	return popover
}

export type ToolId =
	| "light"
	| "sky"
	| "birthday"
	| "hunt"
	| "spacecraft"
	| "compare"
	| "walk"
	| "dictionary"
	| "postcard"

/** Opens a tool from the Tools menu at the bottom right. */
export async function openTool(page: Page, tool: ToolId): Promise<void> {
	await page.getByTestId("tools-menu").click()
	await page.locator(`[data-tool="${tool}"]`).click()
}

/** Unfolds the body card's facts, moons and stories (it starts small). */
export async function expandCard(page: Page): Promise<void> {
	const card = page.getByTestId("body-card")
	await card.waitFor()
	const toggle = card.getByTestId("card-toggle")
	if ((await toggle.getAttribute("aria-expanded")) !== "true")
		await toggle.click()
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")

/** Picks a speed preset ("1 min/s") in the time popover. */
export async function setSpeed(page: Page, label: string): Promise<void> {
	const popover = await openTime(page)
	await popover.getByText(label, { exact: true }).click()
}

/** The time bar names the speed on its button: "Time and speed: 1x". */
export const speedButton = (page: Page): Locator =>
	page.getByTestId("time-menu")

/** A pattern for the speed button's name ending in `label` ("1x", "1 min/s"). */
export const speedName = (label: string): RegExp =>
	new RegExp(`${escape(label)}$`)

/** Closes the time popover, if it is open (its button toggles it). */
export async function closeTime(page: Page): Promise<void> {
	const popover = page.getByTestId("time-panel")
	if (await popover.isVisible()) await page.getByTestId("time-menu").click()
	await popover.waitFor({ state: "hidden" })
}
