import { afterEach, describe, expect, it } from "vitest"

import {
	HOME_SHOT,
	OVERVIEW,
	formatShot,
	isValidView,
	parseShot,
	roundShot,
	sanitizeShot,
	viewBodyId,
	viewMode,
	type SequenceStep,
} from "./navigation"
import { useSimStore } from "./sim"

const store = () => useSimStore.getState()
const reset = () => useSimStore.setState(useSimStore.getInitialState(), true)

afterEach(reset)

/** Settles whatever transition is running, as the camera rig does on arrival. */
const arrive = (now = 0) => {
	const { transition, settle } = store()
	if (transition !== null) settle(transition.id, now)
}

describe("view states", () => {
	it("starts in the overview with nothing selected", () => {
		expect(viewMode(store())).toBe("overview")
		expect(store().view).toEqual(OVERVIEW)
		expect(store().focusId).toBe("sun")
		expect(store().selectedId).toBeNull()
		expect(store().transition).toBeNull()
		expect(store().sequence).toBeNull()
	})

	it("drives select -> focus -> overview with no camera involved", () => {
		store().select("saturn")
		expect(store().selectedId).toBe("saturn")
		// selecting never moves the camera
		expect(viewMode(store())).toBe("overview")
		expect(store().transition).toBeNull()

		store().focus("saturn")
		expect(viewMode(store())).toBe("transit")
		expect(store().focusId).toBe("saturn")
		arrive()
		expect(viewMode(store())).toBe("focused")
		expect(store().view).toEqual({ kind: "body", id: "saturn" })

		store().overview()
		expect(viewMode(store())).toBe("transit")
		expect(store().transition?.shot).toEqual(HOME_SHOT)
		arrive()
		expect(viewMode(store())).toBe("overview")
		expect(store().focusId).toBe("sun")
		// the overview keeps the selection; only reset clears it
		expect(store().selectedId).toBe("saturn")
	})

	it("names the body every view is centred on", () => {
		expect(viewBodyId(OVERVIEW)).toBe("sun")
		expect(viewBodyId({ kind: "body", id: "io" })).toBe("io")
		expect(
			viewBodyId({ kind: "point", anchorId: "mars", offsetKm: [1, 0, 0] }),
		).toBe("mars")
		store().settleAt({ kind: "point", anchorId: "mars", offsetKm: [1, 0, 0] })
		expect(viewMode(store())).toBe("free")
		expect(store().focusId).toBe("mars")
	})

	it("ignores invalid views and unknown bodies", () => {
		store().focus("planet-x")
		store().goTo({ kind: "point", anchorId: "earth", offsetKm: [0, NaN, 0] })
		store().goTo({ kind: "point", anchorId: "vulcan", offsetKm: [0, 0, 0] })
		store().select("vulcan")
		store().setFocus("vulcan")
		expect(store().transition).toBeNull()
		expect(store().selectedId).toBeNull()
		expect(isValidView({ kind: "body", id: "io" })).toBe(true)
		expect(isValidView({ kind: "nowhere" } as never)).toBe(false)
	})
})

describe("selection and focus", () => {
	it("setFocus is the click gesture: select and focus", () => {
		store().setFocus("mars")
		expect(store().selectedId).toBe("mars")
		expect(store().view).toEqual({ kind: "body", id: "mars" })
		expect(viewMode(store())).toBe("transit")
	})

	it("does not restart a transition toward, or at, the current focus", () => {
		store().setFocus("mars")
		const first = store().transition
		store().setFocus("mars")
		expect(store().transition).toBe(first)
		arrive()
		store().setFocus("mars")
		expect(store().transition).toBeNull()
	})

	it("focuses the Sun from the overview (the two are different views)", () => {
		store().setFocus("sun")
		expect(store().view).toEqual({ kind: "body", id: "sun" })
		expect(viewMode(store())).toBe("transit")
	})

	it("clears the selection without touching the view", () => {
		store().setFocus("io")
		arrive()
		store().select(null)
		expect(store().selectedId).toBeNull()
		expect(viewMode(store())).toBe("focused")
	})
})

describe("transitions", () => {
	it("gives every request a new id, so a second request mid-flight retargets", () => {
		store().focus("jupiter")
		const first = store().transition!
		store().focus("mars")
		const second = store().transition!
		expect(second.id).not.toBe(first.id)
		expect(second.view).toEqual({ kind: "body", id: "mars" })
		// the rig finishing the first one late changes nothing
		store().settle(first.id)
		expect(store().transition).toBe(second)
		store().settle(second.id)
		expect(viewMode(store())).toBe("focused")
		expect(store().focusId).toBe("mars")
	})

	it("carries the request: shot, duration, profile", () => {
		store().goTo(
			{ kind: "body", id: "earth" },
			{
				shot: { elevationDeg: 95, distance: -1 },
				durationMs: 2500,
				profile: "smooth",
			},
		)
		expect(store().transition).toMatchObject({
			shot: { elevationDeg: 89.9 },
			durationMs: 2500,
			profile: "smooth",
			handedOver: false,
		})
		// a partial shot keeps the published shot unknown until arrival
		expect(store().shot).toBeNull()
		store().jumpTo({ kind: "body", id: "earth" }, HOME_SHOT)
		expect(store().transition?.durationMs).toBe(0)
		// a complete one is where the camera will be
		expect(store().shot).toEqual(HOME_SHOT)
	})

	it("hands a transition over to the user once", () => {
		store().focus("venus")
		store().userInput()
		const handed = store().transition!
		expect(handed.handedOver).toBe(true)
		store().userInput()
		expect(store().transition).toBe(handed)
		// user input with nothing running is not an event
		arrive()
		const before = store()
		store().userInput()
		expect(store()).toBe(before)
	})

	it("skips to the end of a transition", () => {
		store().focus("neptune", { shot: { distance: 3 } })
		const running = store().transition!
		store().skip()
		const skipped = store().transition!
		expect(skipped.id).not.toBe(running.id)
		expect(skipped.durationMs).toBe(0)
		expect(skipped.view).toEqual(running.view)
		expect(skipped.shot).toEqual({ distance: 3 })
		// nothing to skip once settled
		arrive()
		store().skip()
		expect(store().transition).toBeNull()
	})

	it("resets from any state: mid-transition, mid-sequence, handed over", () => {
		store().setFocus("uranus")
		store().userInput()
		store().playSequence([{ view: { kind: "body", id: "earth" } }])
		store().reset()
		expect(store().view).toEqual(OVERVIEW)
		expect(store().selectedId).toBeNull()
		expect(store().sequence).toBeNull()
		expect(store().transition).toMatchObject({
			shot: HOME_SHOT,
			handedOver: false,
		})
		arrive()
		expect(viewMode(store())).toBe("overview")
	})

	it("publishes the camera at URL precision and ignores equal or broken shots", () => {
		store().publishShot({
			azimuthDeg: 370.04,
			elevationDeg: 10.06,
			distance: 1.23456,
		})
		const shot = store().shot
		expect(shot).toEqual({ azimuthDeg: 10, elevationDeg: 10.1, distance: 1.23 })
		store().publishShot({
			azimuthDeg: 10.01,
			elevationDeg: 10.09,
			distance: 1.231,
		})
		expect(store().shot).toBe(shot)
		store().publishShot({ azimuthDeg: NaN, elevationDeg: 0, distance: 1 })
		expect(store().shot).toBe(shot)
	})

	it("moves the pivot without a transition only while settled", () => {
		const point = {
			kind: "point",
			anchorId: "earth",
			offsetKm: [1e5, 0, 0],
		} as const
		store().focus("earth")
		store().settleAt(point)
		expect(store().view).toEqual({ kind: "body", id: "earth" })
		arrive()
		store().settleAt(point)
		expect(store().view).toEqual(point)
		expect(store().transition).toBeNull()
	})
})

describe("sequences", () => {
	const steps: SequenceStep[] = [
		{ view: { kind: "body", id: "earth" }, holdMs: 1000 },
		{ view: { kind: "body", id: "moon" }, shot: { distance: 2 } },
		{ view: OVERVIEW, holdMs: 500 },
	]

	it("plays steps in order: travel, hold, advance; manual steps wait", () => {
		store().playSequence(steps)
		expect(store().sequence).toMatchObject({ index: 0, phase: "moving" })
		expect(store().view).toEqual(steps[0].view)
		const firstId = store().transition!.id
		expect(store().sequence!.transitionId).toBe(firstId)

		store().settle(firstId, 100)
		expect(store().sequence).toMatchObject({
			phase: "holding",
			holdUntil: 1100,
		})
		store().tickSequence(1099)
		expect(store().sequence!.index).toBe(0)
		store().tickSequence(1100)
		expect(store().sequence).toMatchObject({ index: 1, phase: "moving" })
		expect(store().transition!.shot).toEqual({ distance: 2 })

		// no hold: wait for the presenter
		arrive(2000)
		expect(store().sequence).toMatchObject({ index: 1, phase: "waiting" })
		store().tickSequence(1e9)
		expect(store().sequence!.index).toBe(1)
		store().nextStep()
		expect(store().sequence).toMatchObject({ index: 2, phase: "moving" })

		// the last hold ends the sequence where it stands
		arrive(3000)
		store().tickSequence(3500)
		expect(store().sequence).toBeNull()
		expect(viewMode(store())).toBe("overview")
	})

	it("lets the user look around and resume where they left off", () => {
		store().playSequence(steps, 1)
		store().userInput()
		expect(store().sequence).toMatchObject({ index: 1, phase: "interrupted" })
		// a click on another body leaves the sequence interrupted, not lost
		store().setFocus("mars")
		expect(store().sequence).toMatchObject({ index: 1, phase: "interrupted" })
		store().resumeSequence()
		expect(store().sequence).toMatchObject({ index: 1, phase: "moving" })
		expect(store().view).toEqual(steps[1].view)
	})

	it("does not interrupt a stop that waits for the presenter", () => {
		store().playSequence(steps, 1)
		arrive()
		store().userInput()
		expect(store().sequence!.phase).toBe("waiting")
	})

	it("pauses on a stop and carries on with what was left of the hold (#49)", () => {
		store().playSequence(steps)
		arrive(100)
		expect(store().sequence).toMatchObject({
			phase: "holding",
			holdUntil: 1100,
		})
		store().setSequencePaused(true, 400)
		expect(store().sequence).toMatchObject({
			index: 0,
			phase: "waiting",
			paused: true,
			holdUntil: null,
			holdLeftMs: 700,
		})
		store().tickSequence(1e9)
		expect(store().sequence!.index).toBe(0)
		// looking around while paused is not an interruption
		store().userInput()
		expect(store().sequence!.phase).toBe("waiting")
		store().setSequencePaused(false, 5000)
		expect(store().sequence).toMatchObject({
			phase: "holding",
			paused: false,
			holdUntil: 5700,
		})
		store().tickSequence(5700)
		expect(store().sequence!.index).toBe(1)
	})

	it("paused while moving, arrives and waits with the whole hold to come", () => {
		store().playSequence(steps)
		store().setSequencePaused(true, 50)
		expect(store().sequence).toMatchObject({ phase: "moving", paused: true })
		store().userInput()
		expect(store().sequence!.phase).toBe("moving")
		arrive(100)
		expect(store().sequence).toMatchObject({
			phase: "waiting",
			holdLeftMs: 1000,
		})
		store().setSequencePaused(false, 2000)
		expect(store().sequence).toMatchObject({
			phase: "holding",
			holdUntil: 3000,
		})
	})

	it("stays paused when stepped, and ignores a pause without a running sequence", () => {
		store().setSequencePaused(true)
		expect(store().sequence).toBeNull()
		store().playSequence(steps)
		store().setSequencePaused(true, 0)
		store().nextStep()
		expect(store().sequence).toMatchObject({ index: 1, paused: true })
		store().goToStep(0)
		expect(store().sequence).toMatchObject({ index: 0, paused: true })
		// a new sequence starts unpaused; an interrupted one cannot be paused
		store().playSequence(steps)
		expect(store().sequence!.paused ?? false).toBe(false)
		store().userInput()
		store().setSequencePaused(true)
		expect(store().sequence).toMatchObject({ phase: "interrupted" })
		expect(store().sequence!.paused ?? false).toBe(false)
	})

	it("skips a whole sequence to its last view", () => {
		store().playSequence(steps)
		store().skip()
		expect(store().sequence).toBeNull()
		expect(store().view).toEqual(OVERVIEW)
		expect(store().transition!.durationMs).toBe(0)
	})

	it("jumps to a step, stops, and ignores empty or invalid sequences", () => {
		store().playSequence(steps)
		store().goToStep(2)
		expect(store().sequence!.index).toBe(2)
		store().goToStep(3)
		expect(store().sequence).toBeNull()
		store().playSequence([])
		store().playSequence([{ view: { kind: "body", id: "vulcan" } }])
		expect(store().sequence).toBeNull()
		store().playSequence(steps, 99)
		expect(store().sequence!.index).toBe(2)
		store().stopSequence()
		expect(store().sequence).toBeNull()
	})
})

describe("camera shots in the URL", () => {
	it("formats and parses az_el_distance", () => {
		const shot = { azimuthDeg: -30.04, elevationDeg: 12.46, distance: 2.5 }
		expect(formatShot(shot)).toBe("-30_12.5_2.5")
		expect(parseShot("-30_12.5_2.5")).toEqual({
			azimuthDeg: -30,
			elevationDeg: 12.5,
			distance: 2.5,
		})
		expect(parseShot(formatShot(HOME_SHOT))).toEqual(HOME_SHOT)
		// tiny and huge distances stay plain numbers that parse back
		for (const distance of [0.000123, 45600]) {
			const text = formatShot({ ...HOME_SHOT, distance })
			expect(text).not.toMatch(/e/)
			expect(parseShot(text)?.distance).toBe(distance)
		}
	})

	it("rejects malformed shots instead of failing", () => {
		for (const text of [
			undefined,
			"",
			"1_2",
			"1_2_3_4",
			"a_b_c",
			"0_45_0",
			"0_45_-2",
			"0__1",
			"Infinity_0_1",
		]) {
			expect(parseShot(text)).toBeNull()
		}
		// out-of-range elevations are clamped, azimuths wrapped
		expect(parseShot("540_120_1")).toEqual({
			azimuthDeg: 180,
			elevationDeg: 89.9,
			distance: 1,
		})
	})

	it("keeps only usable fields of a requested shot", () => {
		expect(sanitizeShot(undefined)).toBeNull()
		expect(sanitizeShot({ distance: 0 })).toBeNull()
		expect(sanitizeShot({ azimuthDeg: 10, distance: Infinity })).toEqual({
			azimuthDeg: 10,
		})
		expect(
			roundShot({ azimuthDeg: -180, elevationDeg: -0.01, distance: 1 }),
		).toEqual({ azimuthDeg: 180, elevationDeg: 0, distance: 1 })
	})
})

describe("steps (#46)", () => {
	/** How many steps `act` marks. */
	const marks = (act: () => void) => {
		const before = store().step
		act()
		return store().step - before
	}

	it("are marked by choosing a body and by holding one still, before anything changes", () => {
		const seen: (string | null)[] = []
		const unsubscribe = useSimStore.subscribe((state, previous) => {
			// the view being left is still there when the mark arrives
			if (state.step !== previous.step) seen.push(state.view.kind)
		})
		expect(marks(() => store().setFocus("mars"))).toBe(1)
		expect(seen).toEqual(["overview"])
		unsubscribe()
		expect(marks(() => store().anchorFrame("mars"))).toBe(1)
		expect(marks(() => store().releaseFrame())).toBe(1)
		// unknown bodies are no step
		expect(marks(() => store().setFocus("vulcan"))).toBe(0)
		expect(marks(() => store().anchorFrame("vulcan"))).toBe(0)
	})

	it("are never marked by the camera, the rig or plain requests", () => {
		expect(marks(() => store().focus("mars"))).toBe(0)
		expect(marks(() => store().goTo({ kind: "body", id: "earth" }))).toBe(0)
		expect(marks(() => store().select("venus"))).toBe(0)
		expect(marks(() => arrive())).toBe(0)
		expect(
			marks(() =>
				store().publishShot({ azimuthDeg: 5, elevationDeg: 5, distance: 3 }),
			),
		).toBe(0)
		expect(
			marks(() =>
				store().settleAt({
					kind: "point",
					anchorId: "earth",
					offsetKm: [1e5, 0, 0],
				}),
			),
		).toBe(0)
		// the way out is a step where the user takes it (the house, Escape), not in the slice
		expect(marks(() => store().reset())).toBe(0)
		expect(marks(() => store().markStep())).toBe(1)
	})
})
