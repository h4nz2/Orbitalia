import { describe, expect, it } from "vitest"

import { qrModules } from "./qr"

describe("the QR code", () => {
	it("encodes a view's link as a square of modules", async () => {
		const link =
			"https://orbitalia.app/solar_system?focus=jupiter&cam=-40_15_2&t=2461308.1235&lang=de&reading=simple"
		const modules = await qrModules(link)
		expect(modules).not.toBeNull()
		const size = modules!.length
		expect(size).toBeGreaterThanOrEqual(21)
		expect((size - 17) % 4).toBe(0)
		for (const row of modules!) expect(row).toHaveLength(size)
		// the finder pattern's corner is dark
		expect(modules![0][0]).toBe(true)
	})
})
