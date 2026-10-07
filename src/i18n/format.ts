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

const dateTimeFormat = (locale: string, withEra: boolean) => {
	const key = `${locale}|${withEra}`
	let format = dateTimeFormats.get(key)
	if (format === undefined) {
		format = new Intl.DateTimeFormat(locale, {
			era: withEra ? "short" : undefined,
			year: "numeric",
			month: "short",
			day: "numeric",
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
