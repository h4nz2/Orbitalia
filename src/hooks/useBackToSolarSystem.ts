import { useCanGoBack, useRouter } from "@tanstack/react-router"

import type { SimSearch } from "@/store/simSearch"

/**
 * The way back into the solar system from a page of its own (dictionary,
 * walk, comparison, help; #45). The browser's back when the visitor came from
 * inside the app, so they land exactly where they left (every view is in its
 * address); a page opened straight from a link goes to the solar system at
 * `fallback` instead.
 */
export function useBackToSolarSystem(fallback: SimSearch = {}): () => void {
	const router = useRouter()
	const canGoBack = useCanGoBack()
	return () => {
		if (canGoBack) router.history.back()
		else void router.navigate({ to: "/solar_system", search: fallback })
	}
}
