import { describe, expect, it, vi } from "vitest"

import type { FeedbackRequest } from "../src/features/feedback/schema"

import {
	MAX_BODY,
	composeEmail,
	handleFeedback,
	issueLink,
	type FeedbackEnv,
	type SendEmail,
} from "./feedback"

const report: FeedbackRequest = {
	kind: "bug",
	message: "Saturn's rings vanish\nwhen I zoom in close.",
	email: "teacher@example.org",
	view: "/solar_system?focus=saturn&lang=en",
	context: {
		language: "en",
		reading: "standard",
		userAgent: "Mozilla/5.0 Test",
		screen: "1366×768 @1x",
		version: "0.2.0+abc1234",
	},
	token: "token",
}

function setup(send: SendEmail["send"] = async () => ({ messageId: "1" })) {
	const env: FeedbackEnv = {
		FEEDBACK_EMAIL: { send: vi.fn(send) },
		FEEDBACK_TO: "inbox@example.org",
		TURNSTILE_SECRET: "secret",
	}
	return env
}

const post = (body: unknown) =>
	new Request("https://orbitalia.app/api/feedback", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"CF-Connecting-IP": "1.2.3.4",
		},
		body: typeof body === "string" ? body : JSON.stringify(body),
	})

const human = vi.fn(async () => true)

describe("handleFeedback", () => {
	it("mails a valid report from a person to the inbox", async () => {
		const env = setup()
		const response = await handleFeedback(post(report), env, human)
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ ok: true })
		expect(human).toHaveBeenCalledWith("token", "secret", "1.2.3.4")
		const mail = vi.mocked(env.FEEDBACK_EMAIL.send).mock.calls[0][0]
		expect(mail.to).toBe("inbox@example.org")
		expect(mail.from.email).toBe("feedback@orbitalia.app")
		expect(mail.replyTo).toBe("teacher@example.org")
		expect(mail.subject).toBe(
			"[Orbitalia Bug] Saturn's rings vanish when I zoom in close.",
		)
	})

	it("turns down what a bot sends", async () => {
		const env = setup()
		const response = await handleFeedback(post(report), env, async () => false)
		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({ ok: false, error: "challenge" })
		expect(env.FEEDBACK_EMAIL.send).not.toHaveBeenCalled()
	})

	it("turns down anything that is not a report, before asking Turnstile", async () => {
		const verify = vi.fn(async () => true)
		for (const body of [
			"not json",
			{ ...report, message: "  " },
			{ ...report, kind: "praise" },
			{ ...report, email: "not an address" },
			{ ...report, view: "https://elsewhere.example" },
			{ ...report, extra: true },
			{ ...report, token: undefined },
		]) {
			const response = await handleFeedback(post(body), setup(), verify)
			expect(response.status, JSON.stringify(body)).toBe(400)
		}
		const huge = { ...report, message: "x".repeat(MAX_BODY) }
		expect((await handleFeedback(post(huge), setup(), verify)).status).toBe(413)
		expect(verify).not.toHaveBeenCalled()
	})

	it("only takes POST", async () => {
		const response = await handleFeedback(
			new Request("https://orbitalia.app/api/feedback"),
			setup(),
			human,
		)
		expect(response.status).toBe(405)
	})

	it("says so when the mail cannot be sent", async () => {
		const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
		const env = setup(async () => {
			throw new Error("E_SENDER_NOT_VERIFIED")
		})
		const response = await handleFeedback(post(report), env, human)
		expect(response.status).toBe(502)
		expect(await response.json()).toEqual({ ok: false, error: "send" })
		quiet.mockRestore()
	})
})

describe("composeEmail", () => {
	it("carries the message, the view as a link and what helps reproduce it", () => {
		const { text } = composeEmail(report, "inbox@example.org")
		expect(text).toContain("Saturn's rings vanish\nwhen I zoom in close.")
		expect(text).toContain(
			"View: https://orbitalia.app/solar_system?focus=saturn&lang=en",
		)
		expect(text).toContain("Browser: Mozilla/5.0 Test")
		expect(text).toContain("App version: 0.2.0+abc1234")
		expect(text).toContain("Reply to: teacher@example.org")
	})

	it("has no reply address without an email, and says the view was not attached", () => {
		const mail = composeEmail(
			{ ...report, email: undefined, view: undefined, kind: "idea" },
			"inbox@example.org",
		)
		expect(mail).not.toHaveProperty("replyTo")
		expect(mail.subject).toMatch(/^\[Orbitalia Idea\] /)
		expect(mail.text).toContain("View: not attached")
		expect(mail.text).toContain("Reply to: no email given")
	})

	it("keeps a long first line out of the subject", () => {
		const { subject } = composeEmail(
			{ ...report, message: "word ".repeat(100) },
			"inbox@example.org",
		)
		expect(subject.length).toBeLessThanOrEqual("[Orbitalia Bug] ".length + 70)
		expect(subject.endsWith("…")).toBe(true)
	})
})

describe("issueLink", () => {
	it("opens a labelled GitHub issue without the sender's email", () => {
		const url = new URL(issueLink(report))
		expect(url.origin + url.pathname).toBe(
			"https://github.com/h4nz2/Orbitalia/issues/new",
		)
		expect(url.searchParams.get("labels")).toBe("bug")
		expect(url.searchParams.get("title")).toBe(
			"Saturn's rings vanish when I zoom in close.",
		)
		expect(url.searchParams.get("body")).toContain("Saturn's rings vanish")
		expect(url.toString()).not.toContain("teacher")
		expect(
			new URL(issueLink({ ...report, kind: "other" })).searchParams.has(
				"labels",
			),
		).toBe(false)
	})

	it("stays short enough for GitHub to open", () => {
		const long = { ...report, message: "x".repeat(5000) }
		expect(issueLink(long).length).toBeLessThan(8000)
	})
})
