import { afterEach, describe, expect, it } from "vitest"

import {
	MIN_FREE_SHARE,
	NO_INSETS,
	framingNow,
	insetShares,
	isUprightArea,
	useFreeAreaStore,
} from "./freeArea"
import {
	HOME_SHOT,
	OVERVIEW,
	UPRIGHT_HOME_SHOT,
	defaultShotOf,
	homeShot,
} from "./navigation"

afterEach(() =>
	useFreeAreaStore.setState(useFreeAreaStore.getInitialState(), true),
)

describe("the free part of the screen (#61)", () => {
	it("turns the HUD's bands into shares of the height", () => {
		expect(
			insetShares({ width: 390, height: 844, top: 211, bottom: 422 }),
		).toEqual({ top: 0.25, bottom: 0.5 })
		// nothing covered, or nothing measured yet
		expect(
			insetShares({ width: 1366, height: 768, top: 0, bottom: 0 }),
		).toEqual(NO_INSETS)
		expect(insetShares({ width: 0, height: 0, top: 10, bottom: 10 })).toEqual(
			NO_INSETS,
		)
	})

	it("never frames into less than the least band, kept round the free band and on the canvas", () => {
		// a 360 x 640 phone with a tall panel: 5 px left between the stacks
		const thin = insetShares({ width: 360, height: 640, top: 122, bottom: 513 })
		expect(1 - thin.top - thin.bottom).toBeCloseTo(MIN_FREE_SHARE, 12)
		expect((thin.top + 1 - thin.bottom) / 2).toBeCloseTo(
			(122 + 127) / 2 / 640,
			12,
		)
		// covered to the very top: the band stays on the canvas
		const top = insetShares({ width: 360, height: 640, top: 0, bottom: 630 })
		expect(top.top).toBe(0)
		expect(top.bottom).toBeCloseTo(1 - MIN_FREE_SHARE, 12)
	})

	it("ignores a measurement that moved by less than a pixel", () => {
		const { setArea } = useFreeAreaStore.getState()
		setArea({ width: 390, height: 844, top: 122, bottom: 206 })
		const area = useFreeAreaStore.getState().area
		setArea({ width: 390.4, height: 844, top: 122.5, bottom: 206.2 })
		expect(useFreeAreaStore.getState().area).toBe(area)
		setArea({ width: 390, height: 844, top: 122, bottom: 522 })
		expect(useFreeAreaStore.getState().area.bottom).toBe(522)
	})

	it("gives an upright screen the steeper overview, and only the overview", () => {
		expect(isUprightArea({ width: 390, height: 844 })).toBe(true)
		expect(isUprightArea({ width: 844, height: 390 })).toBe(false)
		expect(isUprightArea({ width: 0, height: 0 })).toBe(false)
		expect(UPRIGHT_HOME_SHOT.elevationDeg).toBeGreaterThan(
			HOME_SHOT.elevationDeg,
		)
		useFreeAreaStore
			.getState()
			.setArea({ width: 390, height: 844, top: 0, bottom: 0 })
		expect(homeShot()).toBe(UPRIGHT_HOME_SHOT)
		expect(defaultShotOf(OVERVIEW)).toBe(UPRIGHT_HOME_SHOT)
		expect(defaultShotOf({ kind: "body", id: "earth" })).toBe(HOME_SHOT)
		expect(framingNow().aspect).toBeCloseTo(390 / 844, 12)
		useFreeAreaStore
			.getState()
			.setArea({ width: 1366, height: 768, top: 0, bottom: 0 })
		expect(homeShot()).toBe(HOME_SHOT)
		expect(framingNow().insets).toEqual(NO_INSETS)
	})
})
