/**
 * The viewer's explicit language and reading-level choice, remembered across
 * visits. Only the switcher writes it; a shared link (`?lang=de`) shows its
 * language without changing the viewer's own preference. Storage can be
 * missing or throw (private windows, blocked site data): every access is guarded
 * and the app works without it.
 */
export const LOCALE_STORAGE_KEY = "orbitalia.locale"
export const READING_LEVEL_STORAGE_KEY = "orbitalia.readingLevel"

const storage = (): Storage | undefined => {
	try {
		return typeof window === "undefined" ? undefined : window.localStorage
	} catch {
		return undefined
	}
}

export function readPreference(key: string): string | null {
	try {
		return storage()?.getItem(key) ?? null
	} catch {
		return null
	}
}

export function writePreference(key: string, value: string): void {
	try {
		storage()?.setItem(key, value)
	} catch {
		// not persisted; the URL still carries the choice for this session
	}
}

/** `navigator.languages` (or `navigator.language`), most preferred first. */
export function browserLanguages(): readonly string[] {
	if (typeof navigator === "undefined") return []
	if (navigator.languages?.length) return navigator.languages
	return navigator.language ? [navigator.language] : []
}
