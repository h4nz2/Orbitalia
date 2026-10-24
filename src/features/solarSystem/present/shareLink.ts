/**
 * What the share panel's link opens (#69): **this view**, the address on
 * screen, which holds the whole view; or **a fresh start**, the app's own
 * address with the language, the reading level and `intro=play`: the opening
 * for everyone, returning visitors included, then the quick look's question
 * for anyone not asked before (#44). The address, the copy button, the small
 * code and the class code (#50) all follow the choice.
 *
 * The choice holds while the page is open and is never stored: a teacher
 * makes it for the lesson at hand, and the next visit starts on "This view".
 */
import { create } from "zustand"

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
