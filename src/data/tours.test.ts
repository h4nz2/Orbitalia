/**
 * The contract for tour files (#28): a tour is data, so these tests are what
 * a contributor's new tour must pass. Every file matches the schema, refers
 * only to things the app has (bodies, moments, scale presets), and has its
 * words in every shipped locale at every reading level.
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { LOCALES, READING_LEVELS } from "@/i18n"
import { levelsOf } from "@/i18n/bodies"
import { isScalePresetId } from "@/sim"
import { MOMENT_IDS } from "@/features/solarSystem/ui/moments"
import { skyEventById } from "@/data/skyEvents"
import { spacecraftById } from "@/data/spacecraft"
import { ToursTextFile, tourContent } from "@/features/solarSystem/tours/text"

import { bodyById } from "./index"
import { TOURS, TourFile, tourFiles, type Tour } from "./tours"

const localesDir = fileURLToPath(new URL("../locales/", import.meta.url))

const fileId = (path: string) =>
	path.replace(/^.*\//, "").replace(/\.json$/, "")

describe("tour files (src/data/tours)", () => {
	it("ships at least three tours, all of them valid", () => {
		expect(Object.keys(tourFiles).length).toBeGreaterThanOrEqual(3)
		expect(TOURS).toHaveLength(Object.keys(tourFiles).length)
	})

	describe.each(Object.entries(tourFiles))("%s", (path, file) => {
		const parsed = TourFile.safeParse(file)

		it("matches the schema", () => {
			expect(parsed.error?.issues ?? []).toEqual([])
		})

		const tour = parsed.data as Tour

		it("is named after its file, with unique stop ids", () => {
			expect(tour.id).toBe(fileId(path))
			const ids = tour.stops.map((stop) => stop.id)
			expect(new Set(ids).size).toBe(ids.length)
		})

		it("refers only to bodies, moments and presets the app has", () => {
			for (const stop of tour.stops) {
				const where = `${tour.id}/${stop.id}`
				if (stop.view !== "overview") {
					expect(bodyById.has(stop.view), `${where} view`).toBe(true)
				}
				if (stop.select != null) {
					expect(bodyById.has(stop.select), `${where} select`).toBe(true)
				}
				if (stop.follow !== undefined) {
					expect(spacecraftById.has(stop.follow), `${where} follow`).toBe(true)
				}
				if (stop.fit?.around !== undefined) {
					expect(bodyById.has(stop.fit.around), `${where} fit`).toBe(true)
				}
				if (stop.scale !== undefined) {
					expect(isScalePresetId(stop.scale), `${where} scale`).toBe(true)
				}
				if (typeof stop.time === "object" && "moment" in stop.time) {
					expect(MOMENT_IDS, `${where} moment`).toContain(stop.time.moment)
				}
				if (typeof stop.time === "object" && "event" in stop.time) {
					expect(skyEventById.has(stop.time.event), `${where} event`).toBe(true)
				}
				if (typeof stop.time === "object" && "date" in stop.time) {
					const date = new Date(`${stop.time.date}T12:00:00Z`)
					expect(Number.isFinite(date.getTime()), `${where} date`).toBe(true)
				}
			}
		})

		it("holds still only the body in view, and restarts trails only in a held frame", () => {
			for (const stop of tour.stops) {
				if (stop.frame !== undefined) {
					expect(stop.frame, `${tour.id}/${stop.id}`).toBe(stop.view)
				}
				if (stop.trails !== undefined) {
					expect(stop.frame, `${tour.id}/${stop.id} trails`).toBeDefined()
				}
			}
		})
	})
})

describe.each(LOCALES)("tours.json of %s", (locale) => {
	const file = tourContent.get(locale)

	it("exists and matches the schema", () => {
		expect(existsSync(join(localesDir, locale, "tours.json"))).toBe(true)
		const parsed = ToursTextFile.safeParse(file)
		expect(parsed.error?.issues ?? []).toEqual([])
	})

	it("has words for every tour and stop, and none for anything else", () => {
		expect(Object.keys(file ?? {}).sort()).toEqual(
			TOURS.map((tour) => tour.id).sort(),
		)
		for (const tour of TOURS) {
			const stops = file?.[tour.id]?.stops ?? {}
			expect(Object.keys(stops).sort(), tour.id).toEqual(
				tour.stops.map((stop) => stop.id).sort(),
			)
			for (const stop of tour.stops) {
				expect(
					stops[stop.id]?.link !== undefined,
					`${tour.id}/${stop.id} link`,
				).toBe(stop.link !== undefined)
			}
		}
	})

	it("writes the shipped tours' narration for every reading level", () => {
		for (const tour of TOURS) {
			const words = file?.[tour.id]
			expect(levelsOf(words?.summary).sort(), `${tour.id} summary`).toEqual(
				[...READING_LEVELS].sort(),
			)
			for (const stop of tour.stops) {
				expect(
					levelsOf(words?.stops[stop.id]?.text).sort(),
					`${tour.id}/${stop.id}`,
				).toEqual([...READING_LEVELS].sort())
			}
		}
	})
})

it("every locale folder with a ui.json has a tours.json", () => {
	const folders = readdirSync(localesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => existsSync(join(localesDir, name, "ui.json")))
	for (const name of folders) {
		expect(existsSync(join(localesDir, name, "tours.json")), name).toBe(true)
	}
})
