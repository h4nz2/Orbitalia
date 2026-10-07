/**
 * The Worker in front of the static site (wrangler.jsonc). Only `/api/*`
 * reaches it (`assets.run_worker_first`); every other request is served from
 * `dist/` with the SPA fallback, without running any code.
 */
import { handleFeedback, type FeedbackEnv } from "./feedback"

interface Env extends FeedbackEnv {
	ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const { pathname } = new URL(request.url)
		if (pathname === "/api/feedback") return handleFeedback(request, env)
		if (pathname.startsWith("/api/"))
			return Response.json({ ok: false, error: "not found" }, { status: 404 })
		return env.ASSETS.fetch(request)
	},
}
