import { createFileRoute } from "@tanstack/react-router"

import Feedback from "@/features/feedback"
import { feedbackSearchSchema } from "@/features/feedback/search"

// `/feedback?kind=bug&from=<app path>`: a bug, an idea or a word for the
// people who make Orbitalia, mailed by the Worker; invalid values are dropped.
export const Route = createFileRoute("/feedback")({
	validateSearch: feedbackSearchSchema,
	component: Feedback,
})
