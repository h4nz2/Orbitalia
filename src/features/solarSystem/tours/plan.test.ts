import { describe, expect, it } from "vitest"

import { bodies } from "@/data"
import type { Tour } from "@/data/tours"
import { AU_KM, J2000_JD, dateToJD } from "@/sim"
import { truePositionAt } from "@/sim/light"
import { HOME_SHOT, OVERVIEW } from "@/store/navigation"
import { WARP_PRESETS } from "@/store/sim"
import type { TourBaseline } from "@/store/tour"

import {
	AUTO_MAX_MS,
	AUTO_MIN_MS,
	LIGHT_ANGLE_DEG,
	autoHoldMs,
	stopCraft,
	stopFrame,
	stopSelection,
	stopSettings,
	stopStep,
	sunlitAzimuthDeg,
	timeJD,
} from "./plan"

const tour: Tour = {
	id: "test",
	order: 0,
	stops: [
		{ id: "a", view: "overview", scale: "textbook", speed: "day" },
		{ id: "b", view: "earth", time: { date: "2025-01-16" } },
		{
			id: "c",
			view: "mars",
			camera: { azimuth: 10, elevation: 20, distance: 2 },
			layers: { markers: false },
			speed: "paused",
		},
		{
			id: "d",
			view: "sun",
			fit: { au: 2 },
			move: "jump",
			scale: "trueScale",
			time: { moment: "moonLanding" },
			layers: { markers: true, labels: false },
		},
		{ id: "e", view: "earth", frame: "earth", fit: { km: 5e5 } },
		{ id: "f", view: "earth", move: "glide", select: null },
	],
}

const baseline: TourBaseline = {
	scale: "everythingVisible",
	warp: 1,
	paused: false,
	layers: {
		orbits: true,
		labels: true,
		moons: true,
		markers: true,
		orbitNames: false,
		allMoons: false,
	},
}

/** Angle (degrees, 0..180) between the camera's direction and the Sun's, seen from `id`. */
function angleToSun(id: string, jd: number, azimuthDeg: number): number {
	const index = new Map(bodies.map((body, i) => [body.id, i]))
	const p = truePositionAt(
		bodies,
		index,
		index.get(id)!,
		jd,
		new Float64Array(3),
	)
	const sun = Math.atan2(-p[0], -p[2])
	const camera = (azimuthDeg * Math.PI) / 180
	const diff = Math.abs(
		((camera - sun + 3 * Math.PI) % (2 * Math.PI)) - Math.PI,
	)
	return (diff * 180) / Math.PI
}

describe("stopStep: the camera of a stop", () => {
	it("frames the overview from the home direction", () => {
		const step = stopStep(tour, 0, J2000_JD)
		expect(step.view).toEqual(OVERVIEW)
		expect(step.shot).toEqual(HOME_SHOT)
		expect(step.profile).toBeUndefined()
	})

	it("flies from one body to another, glides from the overview, and jumps on request", () => {
		expect(stopStep(tour, 1, J2000_JD).profile).toBeUndefined()
		expect(stopStep(tour, 2, J2000_JD).profile).toBe("fly")
		expect(stopStep(tour, 3, J2000_JD)).toMatchObject({ durationMs: 0 })
		expect(stopStep(tour, 5, J2000_JD).profile).toBeUndefined()
	})

	it("takes the camera as written", () => {
		expect(stopStep(tour, 2, J2000_JD).shot).toEqual({
			azimuthDeg: 10,
			elevationDeg: 20,
			distance: 2,
		})
	})

	it("turns a fit into true kilometres round the right body", () => {
		expect(stopStep(tour, 3, J2000_JD).fit).toEqual({
			km: 2 * AU_KM,
			around: "sun",
		})
		expect(stopStep(tour, 4, J2000_JD).fit).toEqual({
			km: 5e5,
			around: "earth",
		})
	})

	it("stands where the body is lit as asked, on the stop's date", () => {
		const jd = dateToJD(new Date("2025-01-16T12:00:00Z"))
		const step = stopStep(tour, 1, jd)
		expect(step.view).toEqual({ kind: "body", id: "earth" })
		expect(angleToSun("earth", jd, step.shot!.azimuthDeg!)).toBeCloseTo(
			LIGHT_ANGLE_DEG.gibbous,
			3,
		)
		for (const light of ["full", "half", "crescent"] as const) {
			const azimuth = sunlitAzimuthDeg("jupiter", jd, LIGHT_ANGLE_DEG[light])!
			expect(angleToSun("jupiter", jd, azimuth)).toBeCloseTo(
				LIGHT_ANGLE_DEG[light],
				3,
			)
		}
		expect(sunlitAzimuthDeg("sun", jd, 50)).toBeNull()
	})
})

describe("what belongs to one stop", () => {
	it("holds still only the body in view", () => {
		expect(stopFrame({ view: "earth", frame: "earth" })).toBe("earth")
		expect(stopFrame({ view: "earth" })).toBe("sun")
		expect(stopFrame({ view: "mars", frame: "earth" })).toBe("sun")
	})

	it("rides along with a spacecraft, in the neighbourhood the view names (#57)", () => {
		const stop = { view: "jupiter", follow: "voyager1" }
		expect(
			stopStep(
				{
					...tour,
					stops: [tour.stops[0], { id: "v", ...stop, camera: { distance: 3 } }],
				},
				1,
				J2000_JD,
			),
		).toMatchObject({
			view: { kind: "craft", id: "voyager1", anchorId: "jupiter" },
			shot: { distance: 3 },
		})
		expect(stopCraft(stop)).toBe("voyager1")
		expect(stopSelection(stop)).toBeNull()
		expect(stopFrame({ ...stop, frame: "jupiter" })).toBe("sun")
		expect(stopCraft({ view: "jupiter", follow: "enterprise" })).toBeNull()
		expect(stopCraft({ view: "jupiter" })).toBeNull()
	})

	it("selects the body in view unless told otherwise", () => {
		expect(stopSelection({ view: "earth" })).toBe("earth")
		expect(stopSelection({ view: "overview" })).toBeNull()
		expect(stopSelection({ view: "earth", select: "moon" })).toBe("moon")
		expect(stopSelection({ view: "earth", select: null })).toBeNull()
		expect(stopSelection({ view: "earth", select: "nowhere" })).toBeNull()
	})
})

describe("stopSettings: what carries forward", () => {
	it("starts from the scene before the tour", () => {
		const first = stopSettings(tour, 0, baseline)
		expect(first).toMatchObject({
			scale: "textbook",
			warp: WARP_PRESETS[3],
			paused: false,
			time: null,
		})
		expect(first.layers).toEqual(baseline.layers)
	})

	it("keeps each setting until a later stop changes it", () => {
		const c = stopSettings(tour, 2, baseline)
		expect(c.scale).toBe("textbook")
		expect(c.paused).toBe(true)
		// pausing keeps the speed to run on at
		expect(c.warp).toBe(WARP_PRESETS[3])
		expect(c.layers.markers).toBe(false)
		expect(c.time).toEqual({ time: { date: "2025-01-16" }, index: 1 })

		const e = stopSettings(tour, 4, baseline)
		expect(e.scale).toBe("trueScale")
		expect(e.layers).toMatchObject({ markers: true, labels: false })
		expect(e.time).toEqual({ time: { moment: "moonLanding" }, index: 3 })
	})

	it("going back to a stop gives it back its own settings", () => {
		expect(stopSettings(tour, 1, baseline).layers.markers).toBe(true)
		expect(stopSettings(tour, 1, baseline).scale).toBe("textbook")
	})
})

describe("timeJD", () => {
	it("reads dates at noon UTC, moments at their instant, and now", () => {
		expect(timeJD({ date: "2025-01-16" })).toBeCloseTo(
			dateToJD(new Date("2025-01-16T12:00:00Z")),
			9,
		)
		expect(timeJD({ moment: "moonLanding" })).toBeCloseTo(
			dateToJD(new Date("1969-07-20T20:17:00Z")),
			9,
		)
		const now = new Date("2030-05-01T00:00:00Z")
		expect(timeJD("now", now)).toBe(dateToJD(now))
		expect(timeJD({ moment: "noSuchMoment" })).toBeNull()
	})
})

describe("autoHoldMs", () => {
	it("allows for reading aloud, within limits, unless the stop says", () => {
		expect(autoHoldMs({}, "Short.")).toBe(AUTO_MIN_MS)
		const words = Array.from({ length: 40 }, () => "word").join(" ")
		const forty = autoHoldMs({}, words)
		expect(forty).toBeGreaterThan(AUTO_MIN_MS)
		expect(forty).toBeLessThan(AUTO_MAX_MS)
		expect(autoHoldMs({}, `${words} ${words} ${words} ${words}`)).toBe(
			AUTO_MAX_MS,
		)
		expect(autoHoldMs({ autoSeconds: 12 }, words)).toBe(12_000)
	})
})
