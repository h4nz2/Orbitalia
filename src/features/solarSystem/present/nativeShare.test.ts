import { afterEach, describe, expect, it, vi } from "vitest"

import { canShareLink, shareLink } from "./nativeShare"

const link = { title: "Jupiter – Orbitalia", url: "https://orbitalia.app/x" }

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("the phone's share sheet (#59)", () => {
	it("is there only where the browser has one", () => {
		vi.stubGlobal("navigator", {})
		expect(canShareLink()).toBe(false)
		vi.stubGlobal("navigator", { share: () => Promise.resolve() })
		expect(canShareLink()).toBe(true)
	})

	it("sends the title and the link", async () => {
		const share = vi.fn(() => Promise.resolve())
		vi.stubGlobal("navigator", { share })
		expect(await shareLink(link)).toBe("shared")
		expect(share).toHaveBeenCalledWith(link)
	})

	it("is silent when the visitor cancels, and says when it cannot share", async () => {
		vi.stubGlobal("navigator", {
			share: () => Promise.reject(new DOMException("no", "AbortError")),
		})
		expect(await shareLink(link)).toBe("cancelled")
		vi.stubGlobal("navigator", {
			share: () => Promise.reject(new DOMException("no", "NotAllowedError")),
		})
		expect(await shareLink(link)).toBe("failed")
		vi.stubGlobal("navigator", {
			share: () => Promise.resolve(),
			canShare: () => false,
		})
		expect(await shareLink(link)).toBe("failed")
	})
})
