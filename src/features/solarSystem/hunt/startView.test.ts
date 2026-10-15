import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getBody } from "@/data"
import { SCALE_PRESETS } from "@/sim"
import { NO_INSETS, insetShares } from "@/store/freeArea"
import { HOME_SHOT, OVERVIEW, UPRIGHT_HOME_SHOT } from "@/store/navigation"
import { useScaleStore } from "@/store/scale"
import { useSimStore } from "@/store/sim"
import { useTourStore } from "@/store/tour"
import { createRecorder, waypointOf, type Waypoint } from "@/store/viewHistory"

import { CAMERA_FOV_DEG, overviewDistance } from "../camera/framing"
import { questionById } from "./hunts"
import {
	BAR_ROOM_PX,
	EDGE_ROOM_PX,
	clearFitDistance,
	clearanceOf,
	drawnPosition,
	framedMoons,
	goToStart,
	moonsShotDistance,
	overviewPx,
	overviewShot,
	overviewShotDistance,
} from "./startView"

const scale = SCALE_PRESETS.everythingVisible

describe("where an Easy clue is asked from (#52)", () => {
	it("keeps clear of a panel at the right, or of a sheet from the bottom", () => {
		const side = 640 - EDGE_ROOM_PX
		const bars = 400 - BAR_ROOM_PX
		expect(clearanceOf(1280, 800, null)).toEqual({
			width: 1280,
			height: 800,
			insets: NO_INSETS,
			left: side,
			right: side,
			up: bars,
			down: bars,
		})
		// the dock beside the scene at x = 880: only the right side shrinks
		expect(clearanceOf(1280, 800, { left: 880, top: 380 })).toMatchObject({
			left: side,
			right: 880 - 640 - EDGE_ROOM_PX,
			up: bars,
			down: bars,
		})
		// a phone: the panel is a sheet over the lower part
		expect(clearanceOf(390, 844, { left: 8, top: 560 })).toMatchObject({
			left: 195 - EDGE_ROOM_PX,
			right: 195 - EDGE_ROOM_PX,
			down: 560 - 422 - EDGE_ROOM_PX,
		})
	})

	it("backs off further the less room there is", () => {
		const wide = clearanceOf(1280, 800, null)
		const narrow = clearanceOf(1280, 800, { left: 800, top: 300 })
		expect(clearFitDistance(1, narrow)).toBeGreaterThan(
			clearFitDistance(1, wide),
		)
		expect(clearFitDistance(2, wide)).toBeCloseTo(2 * clearFitDistance(1, wide))
	})

	it("places a planet in the overview where the scene draws it", () => {
		// 7 Oct 2026, 13:00 UTC at 1280 x 800: Neptune measured at (917, 395)
		const jd = 2461321.04
		const base = overviewDistance(scale, CAMERA_FOV_DEG, 1280 / 800)
		const at = overviewPx(
			drawnPosition(getBody("neptune"), scale, jd),
			base,
			800,
		)
		expect(at.x).toBeCloseTo(917 - 640, -1)
		expect(at.y).toBeCloseTo(395 - 400, -1)
		expect(drawnPosition(getBody("sun"), scale, jd)).toEqual({
			x: 0,
			y: 0,
			z: 0,
		})
	})

	it("leaves the overview alone unless a panel would cover the answer or its name", () => {
		const jd = 2461321.04
		const beside = clearanceOf(1280, 800, { left: 880, top: 380 })
		const where = (id: string) => [drawnPosition(getBody(id), scale, jd)]
		const label = { width: 110, height: 24 }
		expect(overviewShotDistance(where("sun"), scale, beside, label)).toBe(1)
		expect(overviewShotDistance(where("earth"), scale, beside, label)).toBe(1)
		// Neptune and its name would sit under a panel at the right: back off
		const neptune = overviewShotDistance(where("neptune"), scale, beside, label)
		expect(neptune).toBeGreaterThan(1)
		const at = overviewPx(
			where("neptune")[0],
			neptune * overviewDistance(scale, CAMERA_FOV_DEG, 1280 / 800),
			800,
		)
		expect(at.x + label.width).toBeLessThanOrEqual(beside.right + 1)
		// with no panel the whole system already fits
		expect(
			overviewShotDistance(
				where("neptune"),
				scale,
				clearanceOf(1280, 800, null),
				label,
			),
		).toBe(1)
	})

	it("turns the overview round the Sun rather than shrinking it, Poster too (#54)", () => {
		const jd = 2461321.04
		const beside = clearanceOf(1280, 800, { left: 880, top: 380 })
		const label = { width: 110, height: 24 }
		for (const preset of ["everythingVisible", "poster"] as const) {
			const lie = SCALE_PRESETS[preset]
			const neptune = [drawnPosition(getBody("neptune"), lie, jd)]
			// Neptune on the right, under the panel: turned until it is clear
			const shot = overviewShot(neptune, lie, beside, label)
			expect(shot.distance, preset).toBe(1)
			expect(shot.azimuthDeg, preset).not.toBe(0)
			const base = overviewDistance(lie, CAMERA_FOV_DEG, 1280 / 800)
			const at = overviewPx(neptune[0], base, 800, shot.azimuthDeg)
			expect(Math.abs(at.x) + label.width, preset).toBeLessThanOrEqual(
				at.x >= 0 ? beside.right : beside.left,
			)
			// a clear answer keeps the home view
			const earth = [drawnPosition(getBody("earth"), lie, jd)]
			expect(overviewShot(earth, lie, beside, label), preset).toEqual({
				azimuthDeg: 0,
				distance: 1,
			})
		}
		// half a turn mirrors the picture
		const p = { x: 3, y: 0.5, z: -2 }
		const front = overviewPx(p, 50, 800, 0)
		const back = overviewPx({ x: -3, y: 0.5, z: 2 }, 50, 800, 180)
		expect(back.x).toBeCloseTo(front.x)
		expect(back.y).toBeCloseTo(front.y)
	})

	it("on a phone, keeps the answer in the band the HUD leaves above the clue (#61)", () => {
		const jd = 2461321.04
		// 390 x 844 with the clue's panel from 369 px down: the band from 122 to 361
		const insets = insetShares({
			width: 390,
			height: 844,
			top: 122,
			bottom: 483,
		})
		const clear = clearanceOf(390, 844, { left: 8, top: 369 }, insets)
		const band = 844 - 122 - 483
		expect(clear.up).toBeCloseTo(band / 2 - EDGE_ROOM_PX, 9)
		expect(clear.down).toBe(clear.up)
		expect(clear.insets).toBe(insets)
		for (const preset of [
			"everythingVisible",
			"poster",
			"trueScale",
		] as const) {
			const lie = SCALE_PRESETS[preset]
			for (const id of ["earth", "mars", "jupiter", "saturn", "neptune"]) {
				const at = [drawnPosition(getBody(id), lie, jd)]
				// the whole system is framed in the band: the home view, as it is
				expect(overviewShot(at, lie, clear), `${preset} ${id}`).toEqual({
					azimuthDeg: 0,
					distance: 1,
				})
				const px = overviewPx(
					at[0],
					overviewDistance(lie, CAMERA_FOV_DEG, 390 / 844, insets),
					844,
					0,
					CAMERA_FOV_DEG,
					UPRIGHT_HOME_SHOT.elevationDeg,
				)
				expect(Math.abs(px.y), `${preset} ${id}`).toBeLessThanOrEqual(band / 2)
				expect(Math.abs(px.x), `${preset} ${id}`).toBeLessThanOrEqual(195)
			}
		}
	})

	it("frames a moon with the moons out to the next one, as company", () => {
		const ids = (planet: string, answer: string) =>
			framedMoons(getBody(planet), [answer]).map((moon) => moon.id)
		expect(ids("earth", "moon")).toEqual(["moon"])
		expect(ids("jupiter", "io")).toEqual(["io", "europa"])
		expect(ids("saturn", "titan")).toEqual([
			"mimas",
			"enceladus",
			"tethys",
			"dione",
			"rhea",
			"titan",
			"hyperion",
		])
	})

	it("backs off from a moon system until it is clear of the panel", () => {
		const saturn = getBody("saturn")
		const moons = framedMoons(saturn, ["titan"])
		const free = moonsShotDistance(
			saturn,
			moons,
			scale,
			clearanceOf(1280, 800, null),
		)
		const beside = moonsShotDistance(
			saturn,
			moons,
			scale,
			clearanceOf(1280, 800, { left: 880, top: 380 }),
		)
		expect(free).toBeGreaterThanOrEqual(1)
		expect(beside).toBeGreaterThan(free)
	})
})

describe("an Easy clue's start view is a step of Back (#46)", () => {
	const pushed: Waypoint[] = []
	const writes: boolean[] = []
	let pending: (() => void)[] = []
	let stop: () => void = () => undefined
	/** Runs what the recorder deferred to the end of the task. */
	const endTask = () => {
		const run = pending
		pending = []
		for (const fn of run) fn()
	}
	const ask = (id: string) => {
		goToStart(questionById.get(id)!)
		endTask()
	}

	beforeEach(() => {
		vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800 })
		vi.stubGlobal("document", { querySelector: () => null })
		useScaleStore.getState().setPreset("everythingVisible")
		useSimStore.getState().releaseFrame()
		useSimStore.getState().jumpTo(OVERVIEW, HOME_SHOT)
		useSimStore.getState().select(null)
		pushed.length = 0
		writes.length = 0
		pending = []
		const now = () =>
			waypointOf(useSimStore.getState(), useTourStore.getState(), null)
		const recorder = createRecorder({
			now,
			write: (push) => {
				writes.push(push)
				if (push) pushed.push(now())
			},
			arrive: () => undefined,
			defer: (fn) => pending.push(fn),
		})
		stop = useSimStore.subscribe((state, previous) => {
			if (state.step !== previous.step) recorder.step()
		})
	})

	afterEach(() => {
		stop()
		vi.unstubAllGlobals()
	})

	it("leaves no entry when the clue is asked where the camera already is", () => {
		ask("seeRed")
		expect(writes).toEqual([false])
		// asked again (the panel reopened): still nothing to go back to
		ask("seeRed")
		expect(pushed).toEqual([])
	})

	it("is one entry from the world just found, and one more to a planet's moons", () => {
		useSimStore.getState().setFocus("mars") // the answer, a step of its own
		endTask()
		expect(pushed).toHaveLength(1)
		ask("seeBiggest")
		expect(pushed).toHaveLength(2)
		expect(pushed[1]).toMatchObject({
			kind: "view",
			view: { kind: "overview" },
			selectedId: null,
		})
		ask("seeMoon")
		expect(pushed).toHaveLength(3)
		expect(pushed[2]).toMatchObject({ view: { kind: "body", id: "earth" } })
		// the same moon clue again: the view does not change, no new entry
		ask("seeMoon")
		expect(pushed).toHaveLength(3)
	})
})
