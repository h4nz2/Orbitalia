/**
 * A stand-in for the browser's voices (#52): headless Chromium has none, so
 * the hunt's read-aloud would hide its speaker buttons. `stubSpeech` installs
 * a `speechSynthesis` with one voice per given language that records what it
 * is asked to say (`spoken`) and how often it is stopped (`cancels`). Its
 * voice is done after 200 ms; with `untilStopped` it goes on until it is
 * stopped, for a test of stopping a voice still talking, which a test's own
 * clicks could otherwise only sometimes catch.
 */
import type { Page } from "@playwright/test"

declare global {
	interface Window {
		__speech?: { spoken: string[]; cancels: number }
	}
}

export async function stubSpeech(
	page: Page,
	langs: readonly string[] = ["en-US"],
	{ untilStopped = false }: { untilStopped?: boolean } = {},
): Promise<void> {
	await page.addInitScript(
		({ langs, untilStopped }) => {
			const record = { spoken: [] as string[], cancels: 0 }
			window.__speech = record
			const voices = langs.map((lang) => ({
				lang,
				name: `Test ${lang}`,
				default: false,
				localService: true,
				voiceURI: `test-${lang}`,
			}))
			class Utterance extends EventTarget {
				text: string
				voice: unknown = null
				lang = ""
				rate = 1
				constructor(text: string) {
					super()
					this.text = text
				}
			}
			const synth = {
				getVoices: () => voices,
				speak: (utterance: Utterance) => {
					record.spoken.push(utterance.text)
					if (untilStopped) return
					setTimeout(() => utterance.dispatchEvent(new Event("end")), 200)
				},
				cancel: () => {
					record.cancels++
				},
				pause: () => undefined,
				resume: () => undefined,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
			}
			Object.defineProperty(window, "speechSynthesis", {
				value: synth,
				configurable: true,
			})
			Object.defineProperty(window, "SpeechSynthesisUtterance", {
				value: Utterance,
				configurable: true,
			})
		},
		{ langs, untilStopped },
	)
}

/** What the stub was asked to say so far. */
export const spoken = (page: Page): Promise<string[]> =>
	page.evaluate(() => window.__speech?.spoken ?? [])
