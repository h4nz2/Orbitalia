import { afterEach, describe, expect, it } from "vitest"

import { createI18n, type I18n } from "@/i18n"
import { bodyName } from "@/i18n/bodies"
import { useLightStore } from "@/store/light"
import { usePresentationStore } from "@/store/presentation"
import { useScaleStore } from "@/store/scale"
import { useSimStore } from "@/store/sim"

import { runCommand, type CommandContext } from "./commands"

const context = (
	options: Parameters<typeof createI18n>[0] = {},
	instant = false,
): CommandContext => {
	const i18n: I18n = createI18n(options)
	return {
		t: i18n.t,
		bodyName: (id) => bodyName(id, i18n.chain),
		instant,
	}
}

const sim = () => useSimStore.getState()
const presentation = () => usePresentationStore.getState()

afterEach(() => {
	useSimStore.setState(useSimStore.getInitialState(), true)
	usePresentationStore.setState(usePresentationStore.getInitialState(), true)
	useScaleStore.setState(useScaleStore.getInitialState(), true)
	useLightStore.setState(useLightStore.getInitialState(), true)
})

describe("runCommand", () => {
	it("number keys select and fly to a planet; 0 shows the whole system", () => {
		expect(runCommand({ kind: "view", index: 4 }, context())).toBe(
			"Now showing Mars",
		)
		expect(sim().selectedId).toBe("mars")
		expect(sim().view).toEqual({ kind: "body", id: "mars" })
		expect(sim().transition?.durationMs).toBeNull()

		expect(runCommand({ kind: "view", index: 0 }, context())).toBe(
			"The whole solar system",
		)
		expect(sim().view).toEqual({ kind: "overview" })
	})

	it("jumps instead of flying when motion is to be reduced", () => {
		runCommand({ kind: "view", index: 5 }, context({}, true))
		expect(sim().view).toEqual({ kind: "body", id: "jupiter" })
		expect(sim().transition?.durationMs).toBe(0)
		runCommand({ kind: "view", index: 0 }, context({}, true))
		expect(sim().transition?.durationMs).toBe(0)
		runCommand({ kind: "step", direction: 1 }, context({}, true))
		expect(sim().view).toEqual({ kind: "body", id: "mercury" })
		expect(sim().transition?.durationMs).toBe(0)
	})

	it("announces in the active language", () => {
		const de = context({ locale: "de" })
		expect(runCommand({ kind: "view", index: 3 }, de)).toBe(
			"Jetzt zu sehen: Erde",
		)
		expect(runCommand({ kind: "scale" }, de)).toBe("Maßstab: Schulbuch")
		expect(runCommand({ kind: "labels" }, de)).toBe("Namen ausgeblendet")
		expect(runCommand({ kind: "chrome" }, de)).toContain("Drücke H")
	})

	it("S walks the named scale presets, animated", () => {
		const en = context()
		expect(runCommand({ kind: "scale" }, en)).toBe("Scale: Textbook")
		expect(useScaleStore.getState().targetId).toBe("textbook")
		expect(useScaleStore.getState().transition).not.toBeNull()
		expect(runCommand({ kind: "scale" }, en)).toBe("Scale: True scale")
		expect(useScaleStore.getState().targetId).toBe("trueScale")
	})

	it("L, H, P and C toggle and say which way", () => {
		const en = context()
		expect(runCommand({ kind: "labels" }, en)).toBe("Names hidden")
		expect(sim().showLabels).toBe(false)
		expect(runCommand({ kind: "labels" }, en)).toBe("Names shown")

		expect(runCommand({ kind: "chrome" }, en)).toMatch(/Press H/)
		expect(presentation().chromeHidden).toBe(true)
		expect(runCommand({ kind: "chrome" }, en)).toBe("Controls shown")
		expect(presentation().chromeHidden).toBe(false)

		expect(runCommand({ kind: "present" }, en)).toBe("Large text on")
		expect(presentation().presenting).toBe(true)
		expect(runCommand({ kind: "contrast" }, en)).toBe("High contrast on")
		expect(presentation().highContrast).toBe(true)
		expect(runCommand({ kind: "contrast" }, en)).toBe("High contrast off")
	})

	it("X stops the light flash, and says nothing when there is none", () => {
		expect(runCommand({ kind: "stopLight" }, context())).toBeNull()
		useLightStore.getState().send("sun")
		expect(useLightStore.getState().pulse).not.toBeNull()
		expect(runCommand({ kind: "stopLight" }, context())).toBe(
			"Light flash stopped",
		)
		expect(useLightStore.getState().pulse).toBeNull()
	})

	it("? opens and closes the shortcut list without an announcement", () => {
		expect(runCommand({ kind: "help" }, context())).toBeNull()
		expect(presentation().helpOpen).toBe(true)
		runCommand({ kind: "help" }, context())
		expect(presentation().helpOpen).toBe(false)
	})

	it("? over the class QR code replaces it with the list, never under it (#50)", () => {
		presentation().setQrOpen(true)
		runCommand({ kind: "help" }, context())
		expect(presentation().helpOpen).toBe(true)
		expect(presentation().qrOpen).toBe(false)
	})

	it("R goes back to the link the page was opened with", () => {
		presentation().setStartSearch({ focus: "saturn", scale: "trueScale" })
		sim().setFocus("earth")
		expect(runCommand({ kind: "start" }, context())).toBe("Back to the start")
		expect(sim().view).toEqual({ kind: "body", id: "saturn" })
		expect(useScaleStore.getState().targetId).toBe("trueScale")
	})

	it("PageDown during a tour steps the tour and says where it is", () => {
		sim().playSequence([
			{ view: { kind: "body", id: "earth" } },
			{ view: { kind: "body", id: "mars" } },
		])
		expect(runCommand({ kind: "step", direction: 1 }, context())).toBe(
			"Step 2 of 2",
		)
	})
})
