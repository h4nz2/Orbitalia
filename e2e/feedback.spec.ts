/**
 * Feedback: from the Help menu to the inbox, with the view attached; no email
 * needed; and an honest way out (the address) when the form cannot send.
 */
import { expect, test } from "@playwright/test"

import { stubTurnstile, stubWorker } from "./support/feedback"

test("a bug report from the Help menu carries the view, and Back returns to it", async ({
	page,
}) => {
	await stubTurnstile(page)
	const sent = await stubWorker(page)
	await page.goto("/solar_system?focus=mars&lang=en")
	await expect(page.getByRole("combobox", { name: "Focus body" })).toHaveValue(
		"Mars",
	)
	const scene = new URL(page.url())

	await page.getByTestId("intro-menu").click()
	await page.getByRole("menuitem", { name: "Send feedback" }).click()
	await expect(page).toHaveURL(/\/feedback\?/)

	const send = page.getByRole("button", { name: "Send" })
	await expect(send).toBeDisabled()
	await page
		.getByRole("textbox", { name: "Your message" })
		.fill("Mars has no moons in the card.")
	await page
		.getByRole("textbox", { name: "Your email (optional)" })
		.fill("teacher@example.org")
	await expect(
		page.getByRole("checkbox", { name: "Attach the view I was looking at" }),
	).toBeChecked()
	await send.click()
	await expect(page.getByTestId("feedback-sent")).toBeVisible()

	expect(sent).toHaveLength(1)
	const report = sent[0]
	expect(report.kind).toBe("bug")
	expect(report.message).toBe("Mars has no moons in the card.")
	expect(report.email).toBe("teacher@example.org")
	expect(report.token).toBe("test-token")
	const view = new URL(String(report.view), "https://orbitalia.app")
	expect(view.pathname).toBe("/solar_system")
	expect(view.searchParams.get("focus")).toBe("mars")
	expect(report.context).toMatchObject({ language: "en", reading: "standard" })

	await page.getByRole("button", { name: "Back" }).first().click()
	await expect(page).toHaveURL(/\/solar_system\?/)
	expect(new URL(page.url()).searchParams.get("focus")).toBe(
		scene.searchParams.get("focus"),
	)
})

test("an idea needs no email and no view", async ({ page }) => {
	await stubTurnstile(page)
	const sent = await stubWorker(page)
	await page.goto("/feedback?kind=idea&lang=en&reading=simple")
	await expect(
		page.getByRole("checkbox", { name: "Attach the view I was looking at" }),
	).toHaveCount(0)
	await page
		.getByRole("textbox", { name: "Your message" })
		.fill("Show where the Moon landings were!")
	await page.getByRole("button", { name: "Send" }).click()
	await expect(page.getByTestId("feedback-sent")).toBeVisible()
	expect(sent[0].kind).toBe("idea")
	expect(sent[0]).not.toHaveProperty("email")
	expect(sent[0]).not.toHaveProperty("view")
	expect(sent[0].context).toMatchObject({ reading: "simple" })
})

test("when sending fails, the address is offered and the form can try again", async ({
	page,
}) => {
	await stubTurnstile(page)
	const sent = await stubWorker(page, 502, { ok: false, error: "send" })
	await page.goto("/feedback?lang=en")
	await page.getByRole("textbox", { name: "Your message" }).fill("Hello!")
	const send = page.getByRole("button", { name: "Send" })
	await send.click()
	const error = page.getByTestId("feedback-error")
	await expect(error).toContainText("feedback@orbitalia.app")
	// what was written stays, and a new check lets it go again
	await expect(page.getByRole("textbox", { name: "Your message" })).toHaveValue(
		"Hello!",
	)
	await expect(send).toBeEnabled()
	await send.click()
	await expect.poll(() => sent.length).toBe(2)
})

test("without Turnstile (a school filter), the page gives the address instead", async ({
	page,
}) => {
	await page.route("https://challenges.cloudflare.com/**", (route) =>
		route.abort(),
	)
	await page.goto("/feedback?lang=en")
	await expect(page.getByTestId("feedback-unavailable")).toContainText(
		"feedback@orbitalia.app",
	)
	await expect(
		page.getByRole("link", { name: "Report it on GitHub" }),
	).toHaveAttribute("href", /issues\/new\?template=bug\.yml/)
})

test("a broken link can be reported from the not-found page", async ({
	page,
}) => {
	await stubTurnstile(page)
	await page.goto("/no-such-page?lang=en")
	await page.getByRole("link", { name: "Report a broken link" }).click()
	await expect(page).toHaveURL(/\/feedback\?/)
	const search = new URL(page.url()).searchParams
	expect(search.get("kind")).toBe("bug")
	expect(search.get("from")).toMatch(/^\/no-such-page/)
})
