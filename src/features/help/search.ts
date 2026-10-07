/**
 * Search params of `/help?q=eclipse&topic=lightFlash` (#43).
 *
 * `q` is the search in the page's box; `topic` scrolls to an entry, a group,
 * `controls`, `about` or `credits` on arrival (onboarding, #44, and the
 * shortcut list link here). Kept free of app imports (only zod): the route
 * module is eager.
 */
import { z } from "zod"

export const helpSearchSchema = z.object({
	q: z.string().optional().catch(undefined),
	topic: z.string().optional().catch(undefined),
})

export type HelpSearch = z.output<typeof helpSearchSchema>
