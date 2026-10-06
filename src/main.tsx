import "@mantine/core/styles.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createRouter, RouterProvider } from "@tanstack/react-router"

import { routeTree } from "./routeTree.gen"

// Vite's BASE_URL ends with a slash ("/", "/orbitalia/"); TanStack wants "/orbitalia".
const basepath = import.meta.env.BASE_URL.replace(/\/$/, "") || "/"

// Routes are code-split (autoCodeSplitting): preload a route's chunk on link hover/focus/touch,
// like the old Next.js <Link> did, so the first click does not wait for the download.
const router = createRouter({ routeTree, basepath, defaultPreload: "intent" })

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router
	}
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
)
