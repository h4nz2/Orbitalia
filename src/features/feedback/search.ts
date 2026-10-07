/**
 * Search params of `/feedback?kind=bug&from=%2Fsolar_system%3Ffocus%3Dmars`.
 *
 * `kind` picks what the report is about; `from` is the app path the visitor
 * was looking at, offered to attach so a bug can be seen as they saw it.
 * Kept free of app imports (only zod): the route module is eager.
 */
import { z } from "zod"

import { FEEDBACK_KINDS } from "./schema"

export const feedbackSearchSchema = z.object({
	kind: z.enum(FEEDBACK_KINDS).optional().catch(undefined),
	from: z.string().startsWith("/").max(2000).optional().catch(undefined),
})

export type FeedbackSearch = z.output<typeof feedbackSearchSchema>
