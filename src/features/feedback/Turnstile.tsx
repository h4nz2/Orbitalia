/**
 * Cloudflare Turnstile: shows the Worker a person sent the report, without a
 * puzzle in the usual case. The script loads only on the feedback page, and
 * only when the form is on screen.
 */
import { useEffect, useRef } from "react"

const SCRIPT =
	"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

/** The widget for orbitalia.app (public; its secret is the Worker's). */
const SITE_KEY = "0x4AAAAAAFQLalosbJAszFHY"
/** Cloudflare's test key, which always passes: for localhost, previews and forks. */
const TEST_SITE_KEY = "1x00000000000000000000AA"

interface TurnstileApi {
	render(
		element: HTMLElement,
		options: {
			sitekey: string
			theme?: "auto" | "light" | "dark"
			language?: string
			callback(token: string): void
			"expired-callback"(): void
			"error-callback"(): void
		},
	): string
	remove(widgetId: string): void
}

declare global {
	interface Window {
		turnstile?: TurnstileApi
	}
}

let loading: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
	if (window.turnstile !== undefined) return Promise.resolve(window.turnstile)
	loading ??= new Promise((resolve, reject) => {
		const script = document.createElement("script")
		script.src = SCRIPT
		script.async = true
		script.onload = () =>
			window.turnstile === undefined
				? reject(new Error("Turnstile did not load"))
				: resolve(window.turnstile)
		script.onerror = () => {
			loading = null
			script.remove()
			reject(new Error("Turnstile did not load"))
		}
		document.head.appendChild(script)
	})
	return loading
}

export interface TurnstileProps {
	/** The page's language, for the widget's own words. */
	language: string
	/** A fresh token, or null when it expired or the check failed. */
	onToken(token: string | null): void
	/** The script could not load (blocked, offline): the page offers the email address instead. */
	onUnavailable(): void
}

export default function Turnstile({
	language,
	onToken,
	onUnavailable,
}: TurnstileProps) {
	const element = useRef<HTMLDivElement>(null)
	// the latest callbacks, so the widget is rendered once per mount
	const callbacks = useRef({ onToken, onUnavailable })
	useEffect(() => {
		callbacks.current = { onToken, onUnavailable }
	})

	useEffect(() => {
		let widgetId: string | null = null
		let gone = false
		loadTurnstile().then(
			(turnstile) => {
				if (gone || element.current === null) return
				widgetId = turnstile.render(element.current, {
					sitekey:
						window.location.hostname === "orbitalia.app"
							? SITE_KEY
							: TEST_SITE_KEY,
					theme: "dark",
					language,
					callback: (token) => callbacks.current.onToken(token),
					"expired-callback": () => callbacks.current.onToken(null),
					"error-callback": () => callbacks.current.onToken(null),
				})
			},
			() => {
				if (!gone) callbacks.current.onUnavailable()
			},
		)
		return () => {
			gone = true
			if (widgetId !== null) window.turnstile?.remove(widgetId)
		}
	}, [language])

	return <div ref={element} data-testid="turnstile" />
}
