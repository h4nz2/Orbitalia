import { afterEach, describe, expect, it } from "vitest"

import { getBody, sun } from "@/data"

import { SCALE_PRESETS, TRUE_SCALE, interpolateScale, mapDistance } from "@/sim"

import {
	DEFAULT_SCALE,
	SCALE_TRANSITION_MS,
	hidesLongTail,
	transitionScale,
	useScaleStore,
} from "./scale"
import { useSimStore } from "./sim"

const reset = () =>
	useScaleStore.setState(useScaleStore.getInitialState(), true)

afterEach(reset)

describe("useScaleStore", () => {
	it("opens in Everything visible", () => {
		const { scale, presetId } = useScaleStore.getState()
		expect(presetId).toBe("everythingVisible")
		expect(scale).toBe(SCALE_PRESETS.everythingVisible)
		expect(DEFAULT_SCALE).toBe(SCALE_PRESETS.everythingVisible)
	})

	it("switches presets and ignores unknown ids", () => {
		const { setPreset } = useScaleStore.getState()
		setPreset("trueScale")
		expect(useScaleStore.getState().scale).toBe(TRUE_SCALE)
		expect(useScaleStore.getState().presetId).toBe("trueScale")
		setPreset("nonsense" as never)
		expect(useScaleStore.getState().presetId).toBe("trueScale")
	})

	it("takes any valid mix, recognising presets by value and keeping their frozen object", () => {
		const { setScale } = useScaleStore.getState()
		const halfway = interpolateScale(TRUE_SCALE, SCALE_PRESETS.textbook, 0.5)
		setScale(halfway)
		expect(useScaleStore.getState().scale).toBe(halfway)
		expect(useScaleStore.getState().presetId).toBeNull()
		setScale({ ...SCALE_PRESETS.textbook })
		expect(useScaleStore.getState().scale).toBe(SCALE_PRESETS.textbook)
		expect(useScaleStore.getState().presetId).toBe("textbook")
	})

	it("adjusts each factor independently and ignores invalid values", () => {
		const { setFactor } = useScaleStore.getState()
		setFactor("bodySize", { exponent: 1 })
		const after = useScaleStore.getState().scale
		expect(after.bodySize.exponent).toBe(1)
		expect(after.orbitDistance).toBe(
			SCALE_PRESETS.everythingVisible.orbitDistance,
		)
		expect(after.moonDistance).toBe(
			SCALE_PRESETS.everythingVisible.moonDistance,
		)
		expect(useScaleStore.getState().presetId).toBeNull()

		setFactor("moonDistance", { knee: 0, exponent: 1, gain: 1 })
		expect(useScaleStore.getState().scale).toBe(after)
		setFactor("orbitDistance", TRUE_SCALE.orbitDistance)
		setFactor("moonDistance", TRUE_SCALE.moonDistance)
		expect(useScaleStore.getState().presetId).toBe("trueScale")
	})
})

describe("animated preset switches (#21)", () => {
	const neptuneRadii =
		(getBody("neptune").orbit?.semiMajorAxisKm ?? 0) / sun.radiusKm
	const neptuneDrawn = () =>
		mapDistance(useScaleStore.getState().scale.orbitDistance, neptuneRadii)

	it("names the destination at once and moves the scale frame by frame", () => {
		const { switchTo, stepTransition } = useScaleStore.getState()
		switchTo("trueScale", 1000)
		let state = useScaleStore.getState()
		// the picker and the URL show the choice from the click on
		expect(state.targetId).toBe("trueScale")
		// the picture has not moved yet
		expect(state.scale).toBe(SCALE_PRESETS.everythingVisible)
		expect(state.transition?.durationMs).toBe(SCALE_TRANSITION_MS)

		// Neptune drifts out monotonically, mid-way the scale is no preset
		let previous = neptuneDrawn()
		for (let ms = 1100; ms < 1000 + SCALE_TRANSITION_MS; ms += 100) {
			stepTransition(ms)
			expect(neptuneDrawn()).toBeGreaterThan(previous)
			previous = neptuneDrawn()
			expect(useScaleStore.getState().presetId).toBeNull()
			expect(useScaleStore.getState().targetId).toBe("trueScale")
		}

		// and lands exactly on the preset's frozen object
		stepTransition(1000 + SCALE_TRANSITION_MS)
		state = useScaleStore.getState()
		expect(state.scale).toBe(TRUE_SCALE)
		expect(state.presetId).toBe("trueScale")
		expect(state.transition).toBeNull()
		expect(neptuneDrawn()).toBeCloseTo(neptuneRadii, 9)
	})

	it("eases in and out, so the change starts and ends gently", () => {
		const transition = {
			from: SCALE_PRESETS.everythingVisible,
			to: "trueScale" as const,
			startMs: 0,
			durationMs: 1000,
		}
		const exponent = (ms: number) =>
			transitionScale(transition, ms).bodySize.exponent
		expect(exponent(-50)).toBe(0.5)
		expect(exponent(500)).toBeCloseTo(0.75, 12)
		// the first and last tenth move less than a tenth of the way each
		expect(exponent(100) - 0.5).toBeLessThan(0.05)
		expect(1 - exponent(900)).toBeLessThan(0.05)
		expect(transitionScale(transition, 1000)).toBe(TRUE_SCALE)
		expect(transitionScale({ ...transition, durationMs: 0 }, 0)).toBe(
			TRUE_SCALE,
		)
	})

	it("turns around mid-way from wherever the picture is", () => {
		const { switchTo, stepTransition } = useScaleStore.getState()
		switchTo("trueScale", 0)
		stepTransition(SCALE_TRANSITION_MS / 2)
		const midway = useScaleStore.getState().scale
		switchTo("everythingVisible", SCALE_TRANSITION_MS / 2)
		const state = useScaleStore.getState()
		expect(state.targetId).toBe("everythingVisible")
		expect(state.transition?.from).toBe(midway)
		// no jump at the turn
		stepTransition(SCALE_TRANSITION_MS / 2)
		expect(useScaleStore.getState().scale).toBe(midway)
		stepTransition(SCALE_TRANSITION_MS * 2)
		expect(useScaleStore.getState().presetId).toBe("everythingVisible")
	})

	it("ignores the preset already shown or on its way, and unknown ids", () => {
		const { switchTo } = useScaleStore.getState()
		switchTo("everythingVisible", 0)
		expect(useScaleStore.getState().transition).toBeNull()
		switchTo("textbook", 0)
		const running = useScaleStore.getState().transition
		switchTo("textbook", 500)
		expect(useScaleStore.getState().transition).toBe(running)
		switchTo("nonsense" as never, 0)
		expect(useScaleStore.getState().targetId).toBe("textbook")
	})

	it("jumps when asked for no animation (reduced motion), and a jump cancels a switch", () => {
		const { switchTo, setPreset } = useScaleStore.getState()
		switchTo("bigPlanets", 0, 0)
		expect(useScaleStore.getState().scale).toBe(SCALE_PRESETS.bigPlanets)
		expect(useScaleStore.getState().transition).toBeNull()

		switchTo("trueScale", 0)
		setPreset("textbook")
		const state = useScaleStore.getState()
		expect(state.transition).toBeNull()
		expect(state.scale).toBe(SCALE_PRESETS.textbook)
		expect(state.targetId).toBe("textbook")
		// a jump back to the preset still on screen stops the switch away from it
		switchTo("trueScale", 0)
		setPreset("textbook")
		expect(useScaleStore.getState().transition).toBeNull()
		expect(useScaleStore.getState().targetId).toBe("textbook")
	})

	it("a custom mix has no target", () => {
		useScaleStore
			.getState()
			.setScale(interpolateScale(TRUE_SCALE, SCALE_PRESETS.textbook, 0.3))
		expect(useScaleStore.getState().targetId).toBeNull()
	})
})

describe("Poster hides the long tail of moons (#54)", () => {
	afterEach(() => useSimStore.setState(useSimStore.getInitialState(), true))

	it("from the click on, and gives it back with the next preset", () => {
		expect(hidesLongTail("poster")).toBe(true)
		expect(hidesLongTail("everythingVisible")).toBe(false)
		expect(hidesLongTail(null)).toBe(false)
		expect(useSimStore.getState().longTailHidden).toBe(false)
		useScaleStore.getState().switchTo("poster", 0)
		// still on its way, already chosen
		expect(useScaleStore.getState().presetId).toBe("everythingVisible")
		expect(useSimStore.getState().longTailHidden).toBe(true)
		useScaleStore.getState().setPreset("trueScale")
		expect(useSimStore.getState().longTailHidden).toBe(false)
		// a link opening in Poster
		useScaleStore.getState().setPreset("poster")
		expect(useSimStore.getState().longTailHidden).toBe(true)
	})
})
