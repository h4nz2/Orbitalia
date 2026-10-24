/**
 * Locale-aware number, unit and date formatting (pure, no React).
 *
 * Every function takes the BCP 47 tag to format for (`I18n.formatLocale`, e.g.
 * "de-CH"), never the browser default: a number formatted in the browser's
 * locale inside a German sentence is the classic i18n bug. Components use the
 * bound versions on `useI18n()`; these are for tests and non-React code.
 */

/** Shown for values that cannot be formatted (non-finite numbers, invalid dates). */
export const MISSING_VALUE = "—"

/** Units the CLDR data in `Intl` knows by name, so they need no translation. */
export type IntlUnit =
	| "millimeter"
	| "centimeter"
	| "kilometer"
	| "meter"
	| "second"
	| "minute"
	| "hour"
	| "day"
	| "week"
	| "month"
	| "year"
	| "kilometer-per-second"
	| "kilometer-per-hour"
	| "kilogram"
	| "celsius"

/** Decimals worth showing for a magnitude: none from 1000 up, three below 1. */
export const fractionDigitsFor = (abs: number): number =>
	abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 3

const numberFormats = new Map<string, Intl.NumberFormat>()

const numberFormat = (
	locale: string,
	options: Intl.NumberFormatOptions,
): Intl.NumberFormat => {
	const key = `${locale}|${JSON.stringify(options)}`
	let format = numberFormats.get(key)
	if (format === undefined) {
		format = new Intl.NumberFormat(locale, options)
		numberFormats.set(key, format)
	}
	return format
}

/**
 * Grouping separators and magnitude-dependent decimals in the locale's style:
 * 149,598,261 / 365.3 / 27.32 / 0.295 in English, 149.598.261 / 365,3 in German,
 * 149’598’261 in Swiss German.
 */
export function formatNumber(value: number, locale: string): string {
	if (!Number.isFinite(value)) return MISSING_VALUE
	return numberFormat(locale, {
		maximumFractionDigits: fractionDigitsFor(Math.abs(value)),
	}).format(value)
}

/** A number to `digits` significant digits: 1 / 5.203 / 0.00257 (used for AU). */
export function formatSignificant(
	value: number,
	locale: string,
	digits = 4,
): string {
	if (!Number.isFinite(value)) return MISSING_VALUE
	return numberFormat(locale, { maximumSignificantDigits: digits }).format(
		value,
	)
}

/**
 * A value with a unit the platform can name in every language, pluralised by
 * CLDR: "6,371 km", "1 day" / "365.3 days", "1 Tag" / "365,3 Tage". `long`
 * spells the unit out, which is what children read best for time units.
 * Decimals follow `formatNumber`.
 */
export function formatQuantity(
	value: number,
	unit: IntlUnit,
	locale: string,
	display: "short" | "long" | "narrow" = "short",
): string {
	if (!Number.isFinite(value)) return MISSING_VALUE
	return numberFormat(locale, {
		style: "unit",
		unit,
		unitDisplay: display,
		maximumFractionDigits: fractionDigitsFor(Math.abs(value)),
	}).format(value)
}

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>()

type Day = "numeric" | "2-digit"

const dateTimeFormat = (
	locale: string,
	withEra: boolean,
	day: Day = "numeric",
) => {
	const key = `${locale}|${withEra}|${day}`
	let format = dateTimeFormats.get(key)
	if (format === undefined) {
		format = new Intl.DateTimeFormat(locale, {
			era: withEra ? "short" : undefined,
			year: "numeric",
			month: "short",
			day,
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
			timeZone: "UTC",
			timeZoneName: "short",
		})
		dateTimeFormats.set(key, format)
	}
	return format
}

/**
 * The simulation clock in the locale's date order, always in UTC and labelled
 * so: "Sep 24, 2026, 10:35 UTC" / "24. Sept. 2026, 10:35 UTC". Years before
 * 1 AD get the era ("Jan 1, 501 BC, …"), so the proleptic Gregorian calendar
 * never shows a bare negative year; an invalid Date becomes a dash.
 */
export function formatDateTimeUTC(date: Date, locale: string): string {
	if (!Number.isFinite(date.getTime())) return MISSING_VALUE
	return dateTimeFormat(locale, date.getUTCFullYear() <= 0).format(date)
}

/** The time bar's clock in its two halves, which together read as the whole. */
export interface DateTimeParts {
	/** "Sep 04, 2026" */
	date: string
	/** what joins them in the locale: ", " in English, " " in Czech */
	separator: string
	/** "10:35 UTC" */
	time: string
}

const clockDays = new Map<string, Day>()

/**
 * The time bar's day (#71): two digits, so the date keeps its length through
 * the month ("01. Mai 2026"). Where the locale writes the month as a number
 * too, the day stays as the locale has it, since "01. 1. 2026" reads wrong
 * in Czech ("1. 1. 2026"); `clockWidths` keeps such a date steady anyway.
 */
const clockDay = (locale: string): Day => {
	let day = clockDays.get(locale)
	if (day === undefined) {
		const month = dateTimeFormat(locale, false)
			.formatToParts(new Date(Date.UTC(2000, 0, 1)))
			.find((part) => part.type === "month")
		day =
			month !== undefined && /^\d+$/.test(month.value) ? "numeric" : "2-digit"
		clockDays.set(locale, day)
	}
	return day
}

/**
 * The simulation clock on the time bar and the time chip: `formatDateTimeUTC`
 * with a two-digit day where the locale allows it ("Sep 04, 2026, 10:35 UTC",
 * see `clockDay`), split before the hour, so a phone (#58) can show the date
 * over the time on a narrow time bar: `date + separator + time` is the whole
 * string. Sentences, cards and the postcard keep `formatDateTimeUTC`'s day.
 * An invalid Date is all date (a dash).
 */
export function formatClockUTC(date: Date, locale: string): DateTimeParts {
	if (!Number.isFinite(date.getTime()))
		return { date: MISSING_VALUE, separator: "", time: "" }
	const parts = dateTimeFormat(
		locale,
		date.getUTCFullYear() <= 0,
		clockDay(locale),
	).formatToParts(date)
	const hour = parts.findIndex((part) => part.type === "hour")
	const join = (from: number, to?: number) =>
		parts
			.slice(from, to)
			.map((part) => part.value)
			.join("")
	if (hour <= 0) return { date: join(0), separator: "", time: "" }
	const literal = parts[hour - 1].type === "literal" ? hour - 1 : hour
	return {
		date: join(0, literal),
		separator: join(literal, hour),
		time: join(hour),
	}
}

/** How many characters the clock takes at most: its date, its time, and the whole. */
export interface ClockWidths {
	date: number
	time: number
	whole: number
}

const clockWidthsByLocale = new Map<string, ClockWidths>()

/**
 * The most characters `formatClockUTC` gives in a locale over a year (#71):
 * every month, on the 28th at 23:59. In a monospaced font that is a width in
 * `ch`, which the clock keeps as its least width, so the buttons beside it
 * never move while time runs ("28. Sept. 2026" is two characters longer than
 * "01. Mai 2026"). Years outside 1000–9999 and years BC may still widen it
 * once.
 */
export function clockWidths(locale: string): ClockWidths {
	let widths = clockWidthsByLocale.get(locale)
	if (widths === undefined) {
		const length = (text: string) => [...text].length
		widths = { date: 0, time: 0, whole: 0 }
		for (let month = 0; month < 12; month++) {
			const { date, separator, time } = formatClockUTC(
				new Date(Date.UTC(2000, month, 28, 23, 59)),
				locale,
			)
			widths.date = Math.max(widths.date, length(date))
			widths.time = Math.max(widths.time, length(time))
			widths.whole = Math.max(widths.whole, length(date + separator + time))
		}
		clockWidthsByLocale.set(locale, widths)
	}
	return widths
}

const pad = (value: number, width = 2): string =>
	String(Math.abs(Math.trunc(value))).padStart(width, "0")

/**
 * The machine-readable twin of `formatDateTimeUTC` for `<time dateTime>`:
 * "2026-09-24T10:35Z". Years outside 0..9999 keep their sign and all their
 * digits (the HTML format allows them); an invalid Date gives "".
 */
export function isoMinuteUTC(date: Date): string {
	if (!Number.isFinite(date.getTime())) return ""
	const year = date.getUTCFullYear()
	const sign = year < 0 ? "-" : ""
	return `${sign}${pad(year, 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}Z`
}
