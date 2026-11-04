import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useSheetStore, whenSheetRests } from "./sheet"

describe("whenSheetRests", () => {
	let frames: (() => void)[] = []
	const nextFrame = () => {
		const run = frames
		frames = []
		for (const frame of run) frame()
	}

	beforeEach(() => {
		vi.useFakeTimers()
		frames = []
		vi.stubGlobal("requestAnimationFrame", (frame: () => void) => {
			frames.push(frame)
			return frames.length
		})
		vi.stubGlobal("cancelAnimationFrame", () => {
			frames = []
		})
		useSheetStore.setState({ active: true, bandPending: false })
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
		useSheetStore.setState({ active: false, bandPending: false })
	})

	it("does not wait where there is no sheet", () => {
		useSheetStore.setState({ active: false, bandPending: true })
		const run = vi.fn()
		whenSheetRests(run)
		expect(run).toHaveBeenCalledTimes(1)
	})

	it("gives the sheet a frame to hear of the change, and goes if the band is written", () => {
		const run = vi.fn()
		whenSheetRests(run)
		expect(run).not.toHaveBeenCalled()
		nextFrame()
		expect(run).toHaveBeenCalledTimes(1)
	})

	it("waits for the band, then goes once", () => {
		const run = vi.fn()
		whenSheetRests(run)
		useSheetStore.getState().setBandPending(true)
		nextFrame()
		expect(run).not.toHaveBeenCalled()
		useSheetStore.getState().setBandPending(false)
		expect(run).toHaveBeenCalledTimes(1)
		useSheetStore.getState().setBandPending(true)
		useSheetStore.getState().setBandPending(false)
		vi.advanceTimersByTime(10_000)
		expect(run).toHaveBeenCalledTimes(1)
	})

	it("never goes without its move: a band that never comes has a time cap", () => {
		const run = vi.fn()
		whenSheetRests(run)
		useSheetStore.getState().setBandPending(true)
		nextFrame()
		vi.advanceTimersByTime(1999)
		expect(run).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(run).toHaveBeenCalledTimes(1)
	})

	it("can be called off", () => {
		const run = vi.fn()
		const off = whenSheetRests(run)
		useSheetStore.getState().setBandPending(true)
		nextFrame()
		off()
		useSheetStore.getState().setBandPending(false)
		vi.advanceTimersByTime(10_000)
		expect(run).not.toHaveBeenCalled()
	})
})
