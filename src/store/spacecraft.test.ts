import { beforeEach, describe, expect, it } from "vitest"

import { useSimStore } from "./sim"
import { useSpacecraftStore } from "./spacecraft"

describe("spacecraft store", () => {
	beforeEach(() => {
		useSimStore.getState().reset()
		useSpacecraftStore.setState(useSpacecraftStore.getInitialState(), true)
	})

	it("hides the layer by default (#70), with only the chosen craft's path", () => {
		const state = useSpacecraftStore.getState()
		expect(state.showSpacecraft).toBe(false)
		expect(state.showAllPaths).toBe(false)
	})

	it("choosing a craft shows the layer, and it stays on after the craft is let go", () => {
		useSpacecraftStore.getState().selectCraft("voyager1")
		expect(useSpacecraftStore.getState().showSpacecraft).toBe(true)
		useSpacecraftStore.getState().selectCraft(null)
		expect(useSpacecraftStore.getState().showSpacecraft).toBe(true)
		// a body chosen or the way out let the craft go too, the layer stays
		useSpacecraftStore.getState().selectCraft("juno")
		useSimStore.getState().setFocus("jupiter")
		useSimStore.getState().reset()
		const state = useSpacecraftStore.getState()
		expect(state.selectedCraftId).toBeNull()
		expect(state.showSpacecraft).toBe(true)
	})

	it("letting go of nothing leaves the layer off", () => {
		useSpacecraftStore.getState().selectCraft(null)
		expect(useSpacecraftStore.getState().showSpacecraft).toBe(false)
	})

	it("a craft already selected with the layer off is shown again when chosen", () => {
		useSpacecraftStore.setState({ selectedCraftId: "jwst" })
		useSpacecraftStore.getState().selectCraft("jwst")
		expect(useSpacecraftStore.getState().showSpacecraft).toBe(true)
	})

	it("selecting a craft clears the body selection", () => {
		useSimStore.getState().select("mars")
		useSpacecraftStore.getState().selectCraft("voyager1")
		expect(useSimStore.getState().selectedId).toBeNull()
		expect(useSpacecraftStore.getState().selectedCraftId).toBe("voyager1")
	})

	it("choosing a body clears the craft selection", () => {
		useSpacecraftStore.getState().selectCraft("voyager1")
		useSimStore.getState().setFocus("jupiter")
		expect(useSpacecraftStore.getState().selectedCraftId).toBeNull()
		expect(useSimStore.getState().selectedId).toBe("jupiter")
	})

	it("the way out (home button, Escape) clears the craft selection", () => {
		useSpacecraftStore.getState().selectCraft("juno")
		useSimStore.getState().reset()
		expect(useSpacecraftStore.getState().selectedCraftId).toBeNull()
	})

	it("flying to a point or a planet keeps the craft selected", () => {
		useSpacecraftStore.getState().selectCraft("juno")
		useSimStore
			.getState()
			.goTo({ kind: "point", anchorId: "jupiter", offsetKm: [1e6, 0, 0] })
		useSimStore.getState().focus("jupiter")
		expect(useSpacecraftStore.getState().selectedCraftId).toBe("juno")
	})

	it("hiding the layer drops the selection and the hover", () => {
		useSpacecraftStore.getState().selectCraft("juno")
		expect(useSpacecraftStore.getState().showSpacecraft).toBe(true)
		useSpacecraftStore.getState().setHoverCraft("jwst")
		useSpacecraftStore.getState().setShowSpacecraft(false)
		const state = useSpacecraftStore.getState()
		expect(state.selectedCraftId).toBeNull()
		expect(state.hoverCraftId).toBeNull()
		expect(state.showSpacecraft).toBe(false)
	})
})
