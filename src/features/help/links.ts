/**
 * "Try it" links (#43): an entry's `try` (`/solar_system?focus=saturn`) as the
 * route and search object a TanStack `<Link>` takes. The search is parsed the
 * way the router parses an address (`defaultParseSearch`: numbers and booleans
 * become values), so a link means exactly what the same address typed into the
 * browser means. `lang` and `reading` are never part of a link: the root
 * route's `retainSearchParams` keeps the viewer's own.
 */
import { defaultParseSearch } from "@tanstack/react-router"

/** The pages a "try it" link may open. */
export const TRY_ROUTES = [
	"/solar_system",
	"/solar_dictionary",
	"/solar_walk",
	"/compare",
	"/help",
] as const
export type TryRoute = (typeof TRY_ROUTES)[number]

export interface TryLink {
	to: TryRoute
	search: Record<string, unknown>
}

const isTryRoute = (path: string): path is TryRoute =>
	(TRY_ROUTES as readonly string[]).includes(path)

/** The route and search of a `try` path; null for a path that is not a page of the app. */
export function parseTryLink(path: string): TryLink | null {
	const at = path.indexOf("?")
	const pathname = at === -1 ? path : path.slice(0, at)
	if (!isTryRoute(pathname)) return null
	const search = defaultParseSearch(at === -1 ? "" : path.slice(at)) as Record<
		string,
		unknown
	>
	return { to: pathname, search }
}
