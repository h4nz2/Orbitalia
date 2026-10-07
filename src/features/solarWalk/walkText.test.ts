import { describe, expect, it } from "vitest"

import { createI18n, type Locale, type ReadingLevel } from "@/i18n"
import { bodyName } from "@/i18n/bodies"

import { buildWalk, landmarkOnWalk, type SunObjectId } from "./walk"
import {
	landmarkCountText,
	landmarkMarkerText,
	leadText,
	starText,
	stopText,
	summaryText,
	sunStopText,
	titleText,
} from "./walkText"

const setup = (
	sun: SunObjectId = "basketball",
	locale: Locale = "en",
	readingLevel: ReadingLevel = "standard",
) => {
	const i18n = createI18n({ locale, readingLevel })
	const walk = buildWalk(sun)
	const name = (id: string) => bodyName(id, i18n.chain)
	const stop = (id: string) => {
		const found = walk.stops.find((s) => s.id === id)
		if (found === undefined) throw new Error(id)
		return stopText(found, "pitch", i18n, name)
	}
	return { i18n, walk, stop }
}

describe("the walk in English", () => {
	it("opens with the Sun as the object and Earth as the hook", () => {
		const { i18n, walk } = setup()
		expect(titleText(walk, i18n)).toBe("If the Sun were a basketball…")
		expect(leadText(walk, i18n)).toMatch(
			/^…Earth would be a pinhead, 26 m away\. /,
		)
		expect(summaryText(walk, i18n)).toBe(
			"The whole walk to Neptune: 776 m, about 12 minutes on foot.",
		)
		expect(sunStopText(walk, i18n)).toBe(
			"Here the Sun is a basketball, 24 cm across. Put it at the start: the school gate or a corner of the field.",
		)
	})

	it("says each stop's size, distance, leg, landmark and big moons", () => {
		const { stop } = setup()
		expect(stop("earth")).toEqual({
			leg: "Walk 7.1 m",
			size: "2.2 mm across – about the size of a pinhead",
			distance: "26 m from the Sun",
			landmark: "0.2 football pitches",
			moons: [
				"Moon: 0.6 mm, about the size of a grain of sugar, 6.6 cm from the planet",
			],
		})
		expect(stop("jupiter").size).toBe(
			"2.4 cm across – about the size of a cherry",
		)
		expect(stop("jupiter").moons[2]).toBe(
			"Ganymede: 0.91 mm, about the size of a poppy seed, 18 cm from the planet",
		)
		expect(stop("neptune").distance).toBe("776 m from the Sun")
		expect(stop("neptune").landmark).toBe("7.4 football pitches")
	})

	it("ends with the shock of the nearest star", () => {
		const { i18n, walk } = setup()
		expect(starText(walk, i18n)).toBe(
			"Now keep going. At this scale the nearest star after the Sun, Proxima Centauri, is 6,900 km away – about 7.5 hours by plane. Your whole walk to Neptune fits into that 8,900 times.",
		)
	})

	it("adds the true values at the advanced level and drops the numbers at the simple one", () => {
		const advanced = setup("basketball", "en", "advanced")
		expect(advanced.stop("earth").size).toBe(
			"2.2 mm across (really 12,742 km) – about the size of a pinhead",
		)
		expect(advanced.stop("earth").distance).toBe(
			"26 m from the Sun (really 149.6 million km)",
		)
		expect(leadText(advanced.walk, advanced.i18n)).toContain(
			"a true-scale model at 1 : 5.8 billion",
		)
		const simple = setup("basketball", "en", "simple")
		expect(simple.stop("earth").size).toBe("About as big as a pinhead")
		expect(starText(simple.walk, simple.i18n)).toBe(
			"And the next star? At this scale it is so far away that even a plane would need about 7.5 hours to get there!",
		)
		// above 100 m the simple level counts football pitches (#51)
		expect(simple.stop("neptune").distance).toBe(
			"7.5 football pitches from the Sun",
		)
		expect(summaryText(simple.walk, simple.i18n)).toBe(
			"The walk to Neptune is 7.5 football pitches long. It takes about 12 minutes.",
		)
	})

	it("recomputes everything for another Sun", () => {
		const { i18n, walk, stop } = setup("exerciseBall")
		expect(titleText(walk, i18n)).toBe("If the Sun were an exercise ball…")
		expect(stop("earth").size).toBe("9.2 mm across – about the size of a pea")
		expect(stop("earth").distance).toBe("108 m from the Sun")
		expect(stop("earth").landmark).toBe("1 football pitch")
		expect(summaryText(walk, i18n)).toBe(
			"The whole walk to Neptune: 3.2 km, about 49 minutes on foot.",
		)
	})
})

describe("landmarks", () => {
	it("marks the landmark and splits the leg around it", () => {
		const { i18n, walk } = setup()
		expect(landmarkMarkerText("pitch", i18n)).toBe(
			"The end of a football pitch: 105 m from the Sun",
		)
		const marker = landmarkOnWalk(walk, "pitch")!
		const jupiter = walk.stops[marker.before]
		expect(
			stopText(jupiter, "pitch", i18n, (id) => id, marker.toNextM).leg,
		).toBe("Walk 29 m")
	})

	it("never says zero landmarks", () => {
		const { i18n } = setup("orange")
		expect(landmarkCountText(3.3, "pitch", i18n)).toBeNull()
		expect(landmarkCountText(12, "pitch", i18n)).toBe("0.1 football pitches")
		expect(landmarkCountText(400, "track", i18n)).toBe("1 lap of the track")
	})
})

describe("the walk in German", () => {
	it("reads naturally at every level", () => {
		const standard = setup("basketball", "de")
		expect(titleText(standard.walk, standard.i18n)).toBe(
			"Wenn die Sonne ein Basketball wäre …",
		)
		expect(leadText(standard.walk, standard.i18n)).toMatch(
			/^… wäre die Erde ein Stecknadelkopf, 26 m entfernt\. /,
		)
		expect(standard.stop("earth")).toEqual({
			leg: "Geh 7,1 m weiter",
			size: "2,2 mm Durchmesser – etwa so groß wie ein Stecknadelkopf",
			distance: "26 m von der Sonne",
			landmark: "0,2 Fußballfelder",
			moons: [
				"Mond: 0,6 mm, etwa so groß wie ein Zuckerkorn, 6,6 cm vom Planeten",
			],
		})
		expect(starText(standard.walk, standard.i18n)).toBe(
			"Und jetzt weiter. In diesem Maßstab ist der nächste Stern nach der Sonne, Proxima Centauri, 6.900 km entfernt – mit dem Flugzeug etwa 7,5 Stunden. Dein ganzer Weg bis zum Neptun passt 8.900-mal hinein.",
		)
		const simple = setup("orange", "de", "simple")
		expect(titleText(simple.walk, simple.i18n)).toBe(
			"Wenn die Sonne eine Orange wäre …",
		)
		expect(simple.stop("jupiter").size).toBe("Etwa so groß wie eine Erbse")
		const advanced = setup("basketball", "de", "advanced")
		expect(advanced.stop("saturn").distance).toBe(
			"246 m von der Sonne (in Wirklichkeit 1,427 Milliarden km)",
		)
	})
})
