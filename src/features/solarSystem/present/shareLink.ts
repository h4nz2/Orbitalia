/**
 * What the share panel's link opens (#69): **this view**, the address on
 * screen, which holds the whole view, with the moment on screen (`viewLink`);
 * or **a fresh start**, the app's own
 * address with the language, the reading level and `intro=play`: the opening
 * for everyone, returning visitors included, then the quick look's question
 * for anyone not asked before (#44). The address, the copy button, the small
 * code and the class code (#50) all follow the choice.
 *
 * The choice holds while the page is open and is never stored: a teacher
 * makes it for the lesson at hand, and the next visit starts on "This view".
 */
import {
	defaultParseSearch,
	defaultStringifySearch,
} from "@tanstack/react-router"
import { create } from "zustand"

import { isLive, type LiveClock } from "@/sim"
import { hidesTimeInUrl, useBirthdayStore } from "@/store/birthday"
import { useSimStore } from "@/store/sim"
import { roundJD } from "@/store/urlSync"

export type ShareKind = "view" | "fresh"

export interface ShareState {
	kind: ShareKind
	setKind: (kind: ShareKind) => void
}

export const useShareStore = create<ShareState>()((set) => ({
	kind: "view",
	setKind: (kind) => set({ kind }),
}))

/**
 * The fresh start's link: `<origin><base>solar_system?lang=…&reading=…&intro=play`
 * and nothing else (no view, no presentation settings), so every student
 * starts the same way in the teacher's language. `base` is Vite's
 * `BASE_URL` (it ends with a slash).
 */
export function freshStartLink(
	origin: string,
	base: string,
	lang: string,
	reading: string,
): string {
	const url = new URL(`${base}solar_system`, origin)
	url.searchParams.set("lang", lang)
	url.searchParams.set("reading", reading)
	url.searchParams.set("intro", "play")
	return url.toString()
}

/**
 * This view's link (#69): the address on screen (`href`, which the URL sync
 * keeps current) with the moment on screen as its `t`. At a fast clock the
 * address keeps the moment the clock left "now" and is not rewritten every
 * second, so a link taken a minute later at 1 day/s would open two months
 * off; like the postcard's link (`postcardLink`) it pins what the viewer
 * sees. A live clock's link has no `t` (it opens on the viewer's own "now"),
 * nor has one while a birth date is entered (#26): both are the address as it
 * is. Otherwise only `t` changes, written as the router writes it.
 */
export function viewLink(
	href: string,
	clock: LiveClock,
	hideTime: boolean,
	now: Date,
): string {
	if (hideTime || isLive(clock, now)) return href
	const url = new URL(href)
	const t = roundJD(clock.simTimeJD)
	const search: Record<string, unknown> = defaultParseSearch(url.search)
	if (search.t === t) return href
	url.search = defaultStringifySearch({ ...search, t })
	return url.toString()
}

/**
 * This view's link as it is at this instant. Read when a link is taken (the
 * share panel or the class code opening, the phone's share sheet), not every
 * frame: a fast clock's QR code would change under the camera.
 */
export const currentViewLink = (): string =>
	viewLink(
		window.location.href,
		useSimStore.getState(),
		hidesTimeInUrl(useBirthdayStore.getState()),
		new Date(),
	)
