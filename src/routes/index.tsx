import { createFileRoute, redirect } from "@tanstack/react-router"

// The solar system is the app (#45): the bare address opens it. Old links to
// `/` keep their search, so `/?lang=de&reading=simple` lands in German, simple.
export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({ to: "/solar_system", search: true, replace: true })
	},
})
