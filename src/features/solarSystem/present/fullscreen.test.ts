import { describe, expect, it } from "vitest"

import { fullscreenOffer, isIphoneSafari } from "./fullscreen"

const IPHONE_SAFARI =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"
const IPHONE_CHROME =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1"
const IPHONE_INSTAGRAM =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.0"
const IPAD =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15"
const ANDROID =
	"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"

describe("full screen where the browser can (#59)", () => {
	it("knows Safari on an iPhone from other browsers and an iPad", () => {
		expect(isIphoneSafari(IPHONE_SAFARI)).toBe(true)
		expect(isIphoneSafari(IPHONE_CHROME)).toBe(false)
		expect(isIphoneSafari(IPHONE_INSTAGRAM)).toBe(false)
		expect(isIphoneSafari(IPAD)).toBe(false)
		expect(isIphoneSafari(ANDROID)).toBe(false)
	})

	it("offers Full screen wherever the API works", () => {
		for (const userAgent of [IPAD, ANDROID, IPHONE_SAFARI])
			expect(
				fullscreenOffer({ enabled: true, userAgent, standalone: false }),
			).toBe("fullscreen")
	})

	it("on an iPhone in Safari, the Home Screen instead; once opened from there, neither", () => {
		expect(
			fullscreenOffer({
				enabled: false,
				userAgent: IPHONE_SAFARI,
				standalone: false,
			}),
		).toBe("homeScreen")
		expect(
			fullscreenOffer({
				enabled: false,
				userAgent: IPHONE_SAFARI,
				standalone: true,
			}),
		).toBeNull()
		expect(
			fullscreenOffer({
				enabled: false,
				userAgent: IPHONE_CHROME,
				standalone: false,
			}),
		).toBeNull()
	})
})
