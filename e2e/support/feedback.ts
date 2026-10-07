/**
 * The feedback page's outside world, stubbed: Cloudflare's Turnstile script
 * (a person, at once) so no test reaches the network, and the Worker's
 * `/api/feedback` (which `vite preview` does not serve).
 */
import type { Page } from "@playwright/test"

/** Turnstile passes at once with the token "test-token". */
export async function stubTurnstile(page: Page): Promise<void> {
	await page.route("https://challenges.cloudflare.com/**", (route) =>
		route.fulfill({
			contentType: "text/javascript",
			body: `window.turnstile = {
				render(element, options) { setTimeout(() => options.callback("test-token"), 50); return "widget" },
				remove() {},
			}`,
		}),
	)
}

/** Answers `/api/feedback` with `status` and `body`, and collects what the page sent. */
export async function stubWorker(
	page: Page,
	status = 200,
	body: object = { ok: true },
): Promise<Record<string, unknown>[]> {
	const sent: Record<string, unknown>[] = []
	await page.route("**/api/feedback", async (route) => {
		sent.push(route.request().postDataJSON() as Record<string, unknown>)
		await route.fulfill({ status, json: body })
	})
	return sent
}
