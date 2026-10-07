/**
 * `POST /api/feedback`: a report from the app's feedback page, checked against
 * the shared schema and Turnstile, then mailed to the maintainers' inbox. Mail,
 * not a GitHub issue: children use the form, and what they type must not
 * become public. The mail carries a link that opens the report as a GitHub
 * issue (without the sender's email) for the maintainer to file it.
 *
 * Secrets (`wrangler secret put`): TURNSTILE_SECRET, FEEDBACK_TO (a verified
 * Email Routing destination, kept out of the repository). Binding:
 * FEEDBACK_EMAIL (`send_email` in wrangler.jsonc).
 */
import {
	FEEDBACK_ADDRESS,
	FeedbackRequest,
	type FeedbackError,
	type FeedbackKind,
	type FeedbackResponse,
} from "../src/features/feedback/schema"

/** The parts of Cloudflare's `send_email` binding this Worker uses. */
export interface SendEmail {
	send(message: {
		to: string
		from: { email: string; name?: string }
		replyTo?: string
		subject: string
		text: string
	}): Promise<{ messageId: string }>
}

export interface FeedbackEnv {
	FEEDBACK_EMAIL: SendEmail
	FEEDBACK_TO: string
	TURNSTILE_SECRET: string
}

export type Verify = (
	token: string,
	secret: string,
	ip: string | undefined,
) => Promise<boolean>

const SITE = "https://orbitalia.app"
const REPO = "https://github.com/h4nz2/Orbitalia"
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

/** The largest request body read, in bytes: the longest message and its context fit easily. */
export const MAX_BODY = 32_000

const KIND_LABELS: Record<FeedbackKind, string> = {
	bug: "Bug",
	idea: "Idea",
	other: "Feedback",
}

/** The GitHub label a filed report gets. */
const KIND_ISSUE_LABELS: Record<FeedbackKind, string | undefined> = {
	bug: "bug",
	idea: "enhancement",
	other: undefined,
}

const reply = (status: number, body: FeedbackResponse) =>
	Response.json(body, { status })
const refuse = (status: number, error: FeedbackError) =>
	reply(status, { ok: false, error })

/** Whether Cloudflare's Turnstile vouches for the token (a person, on this site). */
export const verifyTurnstile: Verify = async (token, secret, ip) => {
	const form = new FormData()
	form.append("secret", secret)
	form.append("response", token)
	if (ip !== undefined) form.append("remoteip", ip)
	const response = await fetch(SITEVERIFY, { method: "POST", body: form })
	if (!response.ok) return false
	const outcome = (await response.json()) as { success?: unknown }
	return outcome.success === true
}

export async function handleFeedback(
	request: Request,
	env: FeedbackEnv,
	verify: Verify = verifyTurnstile,
): Promise<Response> {
	if (request.method !== "POST") return refuse(405, "method")
	if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
		return refuse(413, "invalid")
	const raw = await request.text()
	if (raw.length > MAX_BODY) return refuse(413, "invalid")
	let body: unknown
	try {
		body = JSON.parse(raw)
	} catch {
		return refuse(400, "invalid")
	}
	const parsed = FeedbackRequest.safeParse(body)
	if (!parsed.success) return refuse(400, "invalid")
	const report = parsed.data

	const ip = request.headers.get("CF-Connecting-IP") ?? undefined
	if (!(await verify(report.token, env.TURNSTILE_SECRET, ip)))
		return refuse(403, "challenge")

	try {
		await env.FEEDBACK_EMAIL.send(composeEmail(report, env.FEEDBACK_TO))
	} catch (error) {
		// eslint-disable-next-line no-console -- the Worker's log (wrangler tail) is where a failed send shows
		console.error("feedback: sending failed", error)
		return refuse(502, "send")
	}
	return reply(200, { ok: true })
}

/** One line, at most `max` characters: for a subject or a title. */
const oneLine = (text: string, max: number) => {
	const line = text.replace(/\s+/g, " ").trim()
	return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}

/** The facts that help reproduce a report, one per line (never the email). */
function contextLines(report: FeedbackRequest): string[] {
	const { context } = report
	return [
		`Kind: ${KIND_LABELS[report.kind]}`,
		`View: ${report.view === undefined ? "not attached" : SITE + report.view}`,
		`Language: ${context.language}, reading level: ${context.reading}`,
		`Browser: ${context.userAgent}`,
		`Screen: ${context.screen}`,
		`App version: ${context.version}`,
	]
}

/** A link that opens the report as a new GitHub issue, ready to file (without the sender's email). */
export function issueLink(report: FeedbackRequest): string {
	const params = new URLSearchParams({
		title: oneLine(report.message, 70),
		body: [
			// a URL that GitHub still opens
			report.message.length > 2000
				? `${report.message.slice(0, 2000)}…`
				: report.message,
			"",
			"---",
			"Sent with the app's feedback form.",
			"",
			...contextLines(report).map((line) => `- ${line}`),
		].join("\n"),
	})
	const label = KIND_ISSUE_LABELS[report.kind]
	if (label !== undefined) params.set("labels", label)
	return `${REPO}/issues/new?${params}`
}

export function composeEmail(report: FeedbackRequest, to: string) {
	const kind = KIND_LABELS[report.kind]
	const text = [
		report.message,
		"",
		"---",
		...contextLines(report),
		`Reply to: ${report.email ?? "no email given"}`,
		"",
		"File it on GitHub (check it holds no personal details first):",
		issueLink(report),
	].join("\n")
	return {
		to,
		from: { email: FEEDBACK_ADDRESS, name: "Orbitalia feedback" },
		...(report.email === undefined ? {} : { replyTo: report.email }),
		subject: `[Orbitalia ${kind}] ${oneLine(report.message, 70)}`,
		text,
	}
}
