/**
 * What the feedback form sends to `/api/feedback`: the contract the page
 * (`features/feedback`) and the Worker (`worker/feedback.ts`) share, so both
 * check the same thing. Only zod here: the Worker bundles this file.
 */
import { z } from "zod"

/** Where reports go; also the way in for anyone whose form does not send. */
export const FEEDBACK_ADDRESS = "feedback@orbitalia.app"

export const FEEDBACK_KINDS = ["bug", "idea", "other"] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

/** The longest message, in characters: a long bug report, not an essay. */
export const MESSAGE_MAX = 5000
/** The shortest message worth sending. */
export const MESSAGE_MIN = 3

export const FeedbackRequest = z
	.object({
		kind: z.enum(FEEDBACK_KINDS),
		message: z.string().trim().min(MESSAGE_MIN).max(MESSAGE_MAX),
		/** Only for an answer: never published, never stored by the app. */
		email: z.email().max(254).optional(),
		/** The app path the visitor was looking at (`/solar_system?focus=mars`), when they attach it. */
		view: z.string().startsWith("/").max(2000).optional(),
		/** What helps to reproduce a bug: no names, no location. */
		context: z
			.object({
				language: z.string().max(20),
				reading: z.string().max(20),
				userAgent: z.string().max(500),
				screen: z.string().max(40),
				version: z.string().max(60),
			})
			.strict(),
		/** The Turnstile token that shows a person sent it. */
		token: z.string().min(1).max(4096),
	})
	.strict()
export type FeedbackRequest = z.infer<typeof FeedbackRequest>

/** Why the Worker turned a report down (`{ ok: false, error }`). */
export type FeedbackError = "invalid" | "challenge" | "send" | "method"

export type FeedbackResponse =
	{ ok: true } | { ok: false; error: FeedbackError }
