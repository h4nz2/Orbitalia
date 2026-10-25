/**
 * The overlaps known when the guard landed (#76), each with the issue that
 * fixes it. The list can only shrink: e2e/overlap.spec.ts fails on any
 * overlap not listed here, on a listed one that no longer occurs on a screen
 * it names, and on a listed piece missing from a screen it names, so a fix
 * removes its entry in the same change and no entry outlives its pieces. See
 * docs/ARCHITECTURE.md, "Size classes, finger sizes and screen edges".
 *
 * A piece is named by a CSS selector that it or one of its ancestors
 * matches: a test id, a `data-` hook, an id, a role or the structure. A
 * failure prints each piece's path ("[data-testid=dock] section p.text");
 * a CSS module's class is shown without its hash there, and
 * `[class*="_text_"]` matches it whatever the hash.
 */

export type Size = "360x640" | "390x844" | "1366x768"
export type Lang = "en" | "de"

export interface Allowed {
	/** The issue that fixes it. */
	issue: number
	/** What is wrong, in a few words. */
	what: string
	/**
	 * `overlap` (the default): drawn over each other; `cut`: a line of `a`
	 * sliced by the opaque bar or panel `b`; `covered`: the control `a` under
	 * the opaque `b`; `offScreen`: `a` past the screen's edge.
	 */
	kind?: "overlap" | "cut" | "covered" | "offScreen"
	a: string
	b?: string
	/** The screens it occurs on: help entry ids ("lightFlash") or an extra screen's name. */
	screens: string[]
	/** The screen sizes it occurs on; every one when left out. */
	sizes?: Size[]
	/** The languages it occurs in; both when left out. */
	langs?: Lang[]
}

// empty since #74: every name in the scene goes through one layout
export const ALLOWED: Allowed[] = []
