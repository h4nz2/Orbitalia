import { describe, expect, it } from "vitest"

import { createI18n, type I18n } from "@/i18n"
import { AU_KM } from "@/sim"

import {
	approx,
	distanceLine,
	formatDistance,
	formatTravelTime,
	travelTimes,
} from "./flightFacts"

const en = createI18n({ locale: "en" })
const de = createI18n({ locale: "de" })
const LEVELS = ["simple", "standard", "advanced"] as const

/** Earth -> Jupiter at about 4.2 AU, the issue's example. */
const JUPITER_KM = 6.28e8

const times = (km: number, i18n: I18n) =>
	Object.fromEntries(travelTimes(km, i18n).map((t) => [t.mode, t]))

describe("figures for reading aloud", () => {
	it("keeps one decimal below 10, whole numbers below 100, two digits above", () => {
		expect(approx(1.2821)).toBe(1.3)
		expect(approx(34.9)).toBe(35)
		expect(approx(716.9)).toBe(720)
		expect(approx(5287)).toBe(5300)
	})

	it("says distances in km, million km and billion km", () => {
		expect(formatDistance(384_400, en)).toBe("384,000 km")
		expect(formatDistance(JUPITER_KM, en)).toBe("628 million km")
		expect(formatDistance(4.35e9, en)).toBe("4.35 billion km")
		expect(formatDistance(4.35e9, de)).toBe("4,35 Mrd. km")
		expect(formatDistance(JUPITER_KM, de)).toBe("628 Mio. km")
		expect(formatDistance(0, en)).toBe("0 km")
	})

	it("picks the unit a person would use for a travel time", () => {
		expect(formatTravelTime(1.28, en)).toBe("1.3 seconds")
		expect(formatTravelTime(2095, en)).toBe("35 minutes")
		expect(formatTravelTime(4.2 * 3600, en)).toBe("4.2 hours")
		expect(formatTravelTime(160 * 86400, en)).toBe("160 days")
		expect(formatTravelTime(1.22 * 365.25 * 86400, en)).toBe("1.2 years")
		expect(formatTravelTime(1.22 * 365.25 * 86400, de)).toBe("1,2 Jahre")
	})
})

describe("the readout's travel times", () => {
	it("Earth -> Jupiter: light, the fastest launch and a car", () => {
		const t = times(JUPITER_KM, en)
		expect(t.light).toEqual({
			mode: "light",
			label: "Light",
			time: "35 minutes",
		})
		expect(t.probe.label).toBe("New Horizons, the fastest launch ever")
		expect(t.probe.time).toBe("1.2 years")
		expect(t.car.label).toBe("A car at 100 km/h")
		expect(t.car.time).toBe("720 years")
	})

	it("Earth -> Moon: seconds for light, hours for the probe, months for a car", () => {
		const t = times(384_400, en)
		expect(t.light.time).toBe("1.3 seconds")
		expect(t.probe.time).toBe("6.6 hours")
		expect(t.car.time).toBe("160 days")
	})

	it("is translated at every reading level, with the speeds in the locale's format", () => {
		const labels = (i18n: I18n) =>
			travelTimes(JUPITER_KM, i18n).map((t) => t.label)
		expect(labels(createI18n({ locale: "de" }))).toEqual([
			"Licht",
			"New Horizons, der schnellste Start aller Zeiten",
			"Ein Auto mit 100 km/h",
		])
		expect(
			labels(createI18n({ locale: "en", readingLevel: "advanced" })),
		).toEqual([
			"Light (299,792 km/s)",
			"New Horizons' launch speed (16.26 km/s)",
			"A car at 100 km/h, non-stop",
		])
		expect(
			labels(createI18n({ locale: "de", readingLevel: "advanced" }))[0],
		).toBe("Licht (299.792 km/s)")
		expect(
			labels(createI18n({ locale: "en", readingLevel: "simple" }))[2],
		).toBe("A car that never stops")
	})

	it("states the true distance, with the AU for advanced readers", () => {
		expect(distanceLine(JUPITER_KM, en)).toBe(
			"628 million km apart on this date",
		)
		expect(
			distanceLine(
				4.2 * AU_KM,
				createI18n({ locale: "en", readingLevel: "advanced" }),
			),
		).toBe("628 million km (4.2 AU) in a straight line on this date")
		expect(
			distanceLine(
				JUPITER_KM,
				createI18n({ locale: "de", readingLevel: "simple" }),
			),
		).toBe("Das ist 4-mal so weit wie die Erde von der Sonne")
	})

	it("leaves no message unformatted in any locale or reading level", () => {
		for (const locale of ["en", "de"] as const) {
			for (const readingLevel of LEVELS) {
				const i18n = createI18n({ locale, readingLevel })
				const texts = [
					distanceLine(JUPITER_KM, i18n),
					...travelTimes(JUPITER_KM, i18n).flatMap((t) => [t.label, t.time]),
					i18n.t("solarSystem.flight.route", { from: "A", to: "B" }),
					i18n.t("solarSystem.flight.crossed", { distance: "1 km" }),
				]
				for (const text of texts) {
					expect(text).not.toMatch(/[{}]|solarSystem\./)
				}
			}
		}
	})
})
