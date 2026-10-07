/**
 * Internationalization and reading levels (docs/ARCHITECTURE.md, "i18n").
 *
 * UI strings: `const { t } = useI18n(); t("solarSystem.time.now")`.
 * Editorial body content (names, taglines, descriptions, facts) lives in
 * `@/i18n/bodies`, kept out of this barrel so the eagerly loaded root chunk
 * does not pull in the body data.
 */
export {
	DEFAULT_LOCALE,
	DEFAULT_READING_LEVEL,
	LOCALES,
	READING_LEVELS,
	isReadingLevel,
	type Locale,
	type MessageKey,
	type ReadingLevel,
} from "./catalog"
export { createI18n, type I18n, type I18nOptions } from "./core"
export { useI18n, type I18nContextValue } from "./context"
export {
	formatDateTimeUTC,
	formatNumber,
	formatQuantity,
	formatSignificant,
	isoMinuteUTC,
	MISSING_VALUE,
	type IntlUnit,
} from "./format"
export type { MessageValues } from "./messages"
export {
	capitalized,
	celsiusOf,
	childNumber,
	countArgs,
	dayVsEarth,
	distanceInWords,
	durationInWords,
	EARTH_AS,
	EARTH_DIAMETER_KM,
	EARTH_MASS_KG,
	EARTH_MOON_KM,
	EARTH_SUN_KM,
	everydaySize,
	everydayThing,
	formatCount,
	formatDistance,
	formatScientific,
	formatSize,
	formatSpeed,
	formatTemperature,
	formatTemperatureRange,
	formatWeight,
	isSimple,
	KELVIN_OFFSET,
	kelvinOf,
	LONG_LIFE_YEARS,
	massVsEarth,
	moreThanLimit,
	nearestThing,
	roughly,
	SIMPLE_LIMIT,
	sizeVsEarth,
	sizeWord,
	TEMPERATURE_WORDS,
	temperatureWord,
	thingName,
	THINGS,
	weightVsEarth,
	yearVsEarth,
	type CountArgs,
	type SizeWord,
	type Temperature,
	type TemperatureWord,
	type ThingFit,
	type ThingId,
} from "./quantities"
export { default as I18nProvider } from "./I18nProvider"
export { default as LanguageMenu, nativeLocaleName } from "./LanguageMenu"
export { I18N_SEARCH_KEYS, i18nSearchSchema, type I18nSearch } from "./search"
