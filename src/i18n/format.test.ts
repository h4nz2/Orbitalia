import { describe, expect, it } from "vitest"

import { J2000_JD, jdToDate } from "@/sim"

import { LOCALES } from "./catalog"
import {
	clockWidths,
	formatClockUTC,
	formatDateTimeUTC,
	formatNumber,
	formatQuantity,
	formatSignificant,
	isoMinuteUTC,
	type DateTimeParts,
} from "./format"

// CLDR's Swiss grouping separator (U+2019 in current ICU, an ASCII apostrophe in older data)
const swissGroup = new Intl.NumberFormat("de-CH").format(1000).charAt(1)

describe("formatNumber", () => {
	it("adds grouping and scales the decimals with the magnitude", () => {
		expect(formatNumber(149598261, "en")).toBe("149,598,261")
		expect(formatNumber(6371.0084, "en")).toBe("6,371")
		expect(formatNumber(365.256, "en")).toBe("365.3")
		expect(formatNumber(27.3217, "en")).toBe("27.32")
		expect(formatNumber(0.29478, "en")).toBe("0.295")
		expect(formatNumber(-5832.5, "en")).toBe("-5,833")
	})

	it("uses the given locale's separators, never the browser's", () => {
		expect(formatNumber(149598261, "de")).toBe("149.598.261")
		expect(formatNumber(365.256, "de")).toBe("365,3")
		expect(formatNumber(149598261, "de-CH")).toBe(
			`149${swissGroup}598${swissGroup}261`,
		)
	})

	it("shows a dash for non-finite values", () => {
		expect(formatNumber(Number.POSITIVE_INFINITY, "en")).toBe("—")
		expect(formatNumber(Number.NaN, "de")).toBe("—")
	})
})

describe("formatSignificant", () => {
	it("keeps 4 significant digits by default", () => {
		expect(formatSignificant(1, "en")).toBe("1")
		expect(formatSignificant(5.20336301, "en")).toBe("5.203")
		expect(formatSignificant(0.0025695, "en")).toBe("0.00257")
		expect(formatSignificant(5.20336301, "de")).toBe("5,203")
	})
})

describe("formatQuantity", () => {
	it("names and pluralises the unit in the locale's words", () => {
		expect(formatQuantity(1, "day", "en", "long")).toBe("1 day")
		expect(formatQuantity(365.256, "day", "en", "long")).toBe("365.3 days")
		expect(formatQuantity(1, "day", "de", "long")).toBe("1 Tag")
		expect(formatQuantity(365.256, "day", "de", "long")).toBe("365,3 Tage")
		expect(formatQuantity(9.925, "hour", "de", "long")).toBe("9,93 Stunden")
	})

	it("formats short units with the locale's grouping", () => {
		expect(formatQuantity(6371.0084, "kilometer", "en")).toBe("6,371 km")
		expect(formatQuantity(6371.0084, "kilometer", "de")).toBe("6.371 km")
	})
})

describe("formatDateTimeUTC", () => {
	const date = new Date(Date.UTC(2026, 8, 24, 10, 35, 59))

	it("follows the locale's date order and always says UTC", () => {
		expect(formatDateTimeUTC(date, "en")).toBe("Sep 24, 2026, 10:35 UTC")
		expect(formatDateTimeUTC(date, "de")).toBe("24. Sept. 2026, 10:35 UTC")
		expect(formatDateTimeUTC(jdToDate(J2000_JD), "en")).toBe(
			"Jan 1, 2000, 12:00 UTC",
		)
	})

	it("adds the era before 1 AD instead of a negative year", () => {
		const bc = new Date(Date.UTC(-500, 0, 1))
		expect(formatDateTimeUTC(bc, "en")).toBe("Jan 1, 501 BC, 00:00 UTC")
		expect(formatDateTimeUTC(bc, "de")).toBe("1. Jan. 501 v. Chr., 00:00 UTC")
	})

	it("shows a dash for a Date out of range", () => {
		expect(formatDateTimeUTC(new Date(Number.NaN), "en")).toBe("—")
	})
})

describe("formatClockUTC", () => {
	const date = new Date(Date.UTC(2026, 8, 24, 10, 35, 59))
	const whole = ({ date, separator, time }: DateTimeParts) =>
		date + separator + time

	it("splits before the hour, and the halves read as the whole", () => {
		expect(formatClockUTC(date, "en")).toEqual({
			date: "Sep 24, 2026",
			separator: ", ",
			time: "10:35 UTC",
		})
		// from the 10th on, the clock is the date in a sentence
		for (const locale of ["en", "de", "cs", "es", "fr", "de-CH"])
			expect(whole(formatClockUTC(date, locale))).toBe(
				formatDateTimeUTC(date, locale),
			)
		const bc = new Date(Date.UTC(-500, 0, 1))
		expect(formatClockUTC(bc, "de").date).toBe("01. Jan. 501 v. Chr.")
		expect(whole(formatClockUTC(bc, "en"))).toBe("Jan 01, 501 BC, 00:00 UTC")
	})

	it("gives the day two digits, where the month is a word (#71)", () => {
		const may = new Date(Date.UTC(2026, 4, 1, 9, 5))
		expect(formatClockUTC(may, "en").date).toBe("May 01, 2026")
		expect(formatClockUTC(may, "de").date).toBe("01. Mai 2026")
		expect(formatClockUTC(may, "es").date).toBe("01 may 2026")
		expect(formatClockUTC(may, "fr").date).toBe("01 mai 2026")
		// a month written as a number keeps the locale's day: "01. 5. 2026" reads wrong
		expect(formatClockUTC(may, "cs").date).toBe("1. 5. 2026")
		// a sentence keeps its own day
		expect(formatDateTimeUTC(may, "en")).toBe("May 1, 2026, 09:05 UTC")
	})

	it("keeps the dash for a Date out of range", () => {
		expect(whole(formatClockUTC(new Date(Number.NaN), "en"))).toBe("—")
	})
})

describe("clockWidths", () => {
	const length = (text: string) => [...text].length

	it("covers every month of the year in every language (#71)", () => {
		for (const locale of [...LOCALES, "de-CH", "en-GB", "fr-CA", "es-MX"]) {
			const widths = clockWidths(locale)
			for (let month = 0; month < 12; month++)
				for (const day of [1, 9, 10, 28])
					for (const [hour, minute] of [
						[0, 0],
						[23, 59],
					]) {
						const at = new Date(Date.UTC(2026, month, day, hour, minute))
						const { date, separator, time } = formatClockUTC(at, locale)
						const what = `${locale}: ${date + separator + time}`
						expect(widths.date, what).toBeGreaterThanOrEqual(length(date))
						expect(widths.time, what).toBeGreaterThanOrEqual(length(time))
						expect(widths.whole, what).toBeGreaterThanOrEqual(
							length(date + separator + time),
						)
					}
		}
	})

	it("is the widest date of the year, worked out once per locale", () => {
		// "28. Sept. 2026, 23:59 UTC"
		expect(clockWidths("de")).toEqual({ date: 14, time: 9, whole: 25 })
		expect(clockWidths("de")).toBe(clockWidths("de"))
	})
})

describe("isoMinuteUTC", () => {
	it("is the machine-readable instant for <time dateTime>", () => {
		expect(isoMinuteUTC(new Date(Date.UTC(2026, 8, 24, 10, 35, 59)))).toBe(
			"2026-09-24T10:35Z",
		)
		expect(isoMinuteUTC(new Date(Date.UTC(-500, 0, 1)))).toBe(
			"-0500-01-01T00:00Z",
		)
		expect(isoMinuteUTC(new Date(Date.UTC(12345, 11, 31, 23, 59)))).toBe(
			"12345-12-31T23:59Z",
		)
		expect(isoMinuteUTC(new Date(Number.NaN))).toBe("")
	})
})
