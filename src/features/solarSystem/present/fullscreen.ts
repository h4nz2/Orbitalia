/**
 * Full screen where the browser can do it (#29, #59). The Fullscreen API
 * exists on laptops, Android and iPads, but not on an iPhone: there the only
 * full screen is Orbitalia added to the Home Screen, which Safari opens as a
 * web app (WebKit, Safari 26). So on an iPhone in Safari the menu explains
 * that instead; once opened from the Home Screen it already fills the screen,
 * and neither is offered.
 */
import { useEffect, useState } from "react"

/** Whether the page is in full screen, following the browser (F11, Escape, the button). */
export function useFullscreen(): boolean {
	const [full, setFull] = useState(
		() => typeof document !== "undefined" && !!document.fullscreenElement,
	)
	useEffect(() => {
		const update = () => setFull(!!document.fullscreenElement)
		document.addEventListener("fullscreenchange", update)
		return () => document.removeEventListener("fullscreenchange", update)
	}, [])
	return full
}

/** What the menu offers for a full screen. */
export type FullscreenOffer = "fullscreen" | "homeScreen" | null

/** An iPhone or iPod touch (an iPad's Safari asks for the desktop site and has the API). */
const IPHONE = /\b(?:iPhone|iPod)\b/

/** Safari itself: other browsers on an iPhone name themselves, and in-app browsers leave out "Safari/". */
const OTHER_BROWSER =
	/\b(?:CriOS|FxiOS|EdgiOS|OPiOS|OPT|GSA|YaBrowser|DuckDuckGo|Brave)\//

/** Whether `userAgent` is Safari on an iPhone. Pure. */
export const isIphoneSafari = (userAgent: string): boolean =>
	IPHONE.test(userAgent) &&
	/\bSafari\//.test(userAgent) &&
	!OTHER_BROWSER.test(userAgent)

/**
 * What to offer (pure): Full screen where the API works; on an iPhone in
 * Safari, not yet opened from the Home Screen, how to add it there; else
 * nothing.
 */
export function fullscreenOffer({
	enabled,
	userAgent,
	standalone,
}: {
	/** `document.fullscreenEnabled` */
	enabled: boolean
	userAgent: string
	/** opened from the Home Screen (`display-mode: standalone`, `navigator.standalone`) */
	standalone: boolean
}): FullscreenOffer {
	if (enabled) return "fullscreen"
	if (standalone) return null
	return isIphoneSafari(userAgent) ? "homeScreen" : null
}

/** What this browser can do, now. */
export function currentFullscreenOffer(): FullscreenOffer {
	if (typeof document === "undefined" || typeof navigator === "undefined")
		return null
	const standalone =
		(typeof window.matchMedia === "function" &&
			window.matchMedia("(display-mode: standalone)").matches) ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	return fullscreenOffer({
		enabled: document.fullscreenEnabled === true,
		userAgent: navigator.userAgent,
		standalone,
	})
}
