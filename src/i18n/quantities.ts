/**
 * Quantities at every reading level (#51): the one place that decides how a
 * size, a distance, a duration, a temperature, a weight or a count reaches the
 * reader. Features call these instead of formatting a number themselves.
 *
 * The `simple` level is written for ages 6–11. A child cannot picture
 * "149.6 million km" or "5,778 K", but can picture "11 Earths wide" and
 * "hotter than an oven". So at `simple`:
 *
 * - no number above `SIMPLE_LIMIT` (100), and small numbers rounded to what a
 *   child can picture (halves below 10, whole numbers above: "2.5", "11");
 * - no thousands, millions or billions, no km for big distances, no AU, K,
 *   m/s² or scientific notation (`simpleRules.ts` checks it, the guard test
 *   `simpleLevel.test.ts` keeps it so);
 * - words instead: tiny … gigantic, hotter than an oven, colder than any
 *   freezer; long spans in long human lives (80 years each), then "longer
 *   than there have been people";
 * - Earth as the yardstick ("11 Earths wide", "a day there lasts as long as
 *   10 days at home"), then the Moon's and the Sun's distance for the way
 *   out ("5 times as far as Earth is from the Sun");
 * - everyday objects, the walk's set (#25, `THINGS`), on the scale the
 *   simple texts use, Earth as an orange: "If Earth were as small as an
 *   orange, the Sun would be as big as a house".
 *
 * `standard` and `advanced` keep their exact numbers; temperatures are °C at
 * `standard` and kelvin only at `advanced`.
 *
 * Every result is a phrase without final punctuation, ready for a card line
 * or a message argument. Fragments start in lower case ("11 Earths wide",
 * "hotter than an oven"), whole clauses with a capital ("A day there lasts as
 * long as 10 days at home"). Pure: the `I18n` object comes in as a parameter,
 * and nothing here imports the body data (the yardsticks are constants), so
 * the barrel stays light.
 */
import type { I18n } from "./core"
import { MISSING_VALUE } from "./format"

/** The largest number the simple reading level shows (#51). */
export const SIMPLE_LIMIT = 100

/** Whether the simple level's rules apply (ages 6–11, no big numbers). */
export const isSimple = (i18n: Pick<I18n, "readingLevel">): boolean =>
	i18n.readingLevel === "simple"

// ------------------------------------------------------------- yardsticks

/** Earth's mean diameter, km (2 × 6,371 km; the yardstick for sizes and short distances). */
export const EARTH_DIAMETER_KM = 12_742
/** The Moon's mean distance from Earth, km. */
export const EARTH_MOON_KM = 384_400
/** Earth's mean distance from the Sun (1 AU), km. */
export const EARTH_SUN_KM = 149_597_870.7
/** Earth's mass, kg. */
export const EARTH_MASS_KG = 5.972e24
/** Absolute zero in °C: kelvin minus this is degrees Celsius. */
export const KELVIN_OFFSET = 273.15

const MINUTE = 60
const HOUR = 3600
const DAY = 86_400
const YEAR = 365.25 * DAY
const MONTH = YEAR / 12

// ----------------------------------------------------------------- counts

/**
 * A number a child can picture: halves below 10 ("2.5", "0.5"), whole
 * numbers from 10 ("11", "100"); null above `SIMPLE_LIMIT`, where a sentence
 * says "more than 100" instead. Negative values keep their sign.
 */
export function childNumber(value: number): number | null {
	if (!Number.isFinite(value)) return null
	const abs = Math.abs(value)
	if (abs === 0) return 0
	const rounded =
		abs < 9.75 ? Math.max(0.5, Math.round(abs * 2) / 2) : Math.round(abs)
	return rounded > SIMPLE_LIMIT ? null : Math.sign(value) * rounded
}

/** "more than 100" in the active language. */
export const moreThanLimit = (i18n: I18n): string =>
	i18n.t("quantity.moreThan", { limit: SIMPLE_LIMIT })

/** The two arguments of a counted phrase: `count` picks the plural, `n` is shown. */
export type CountArgs = {
	count: number
	n: string
}

/**
 * A count or a ratio for a message: `{count, plural, …}` chooses the words,
 * `{n}` shows the number. At `simple`, `childNumber` rounding and above the
 * limit `n` = "more than 100" (`count` 101, the plural of "more than 100").
 * At the other levels the value as the caller rounded it.
 */
export function countArgs(value: number, i18n: I18n): CountArgs {
	return isSimple(i18n)
		? childArgs(value, i18n)
		: { count: value, n: i18n.number(value) }
}

/** `countArgs` by the simple level's rule, at any level (the yardstick phrases). */
function childArgs(value: number, i18n: I18n): CountArgs {
	const child = childNumber(value)
	return child === null
		? { count: SIMPLE_LIMIT + 1, n: moreThanLimit(i18n) }
		: { count: child, n: i18n.number(child) }
}

/** `countArgs(…).n`: "11", "2.5", "more than 100" at `simple`, "1,321" above it. */
export const formatCount = (value: number, i18n: I18n): string =>
	countArgs(value, i18n).n

/**
 * A phrase standing on its own as a value (a dictionary line, a list
 * entry): its first letter capitalized in the active language ("Colder than
 * any freezer"). The helpers return phrases in lower case so they also fit
 * inside a sentence.
 */
export const capitalized = (
	text: string,
	i18n: Pick<I18n, "locale">,
): string =>
	text.length === 0
		? text
		: text.charAt(0).toLocaleUpperCase(i18n.locale) + text.slice(1)

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹"

/**
 * A number in scientific notation for the exact levels: "1.9 × 10²⁷" in the
 * locale's decimal style (nobody reads 27 zeros). Never at `simple`.
 */
export function formatScientific(value: number, i18n: I18n): string {
	if (!Number.isFinite(value) || value === 0) return MISSING_VALUE
	const exponent = Math.floor(Math.log10(Math.abs(value)))
	const power = String(Math.abs(exponent)).replace(
		/\d/g,
		(digit) => SUPERSCRIPT[Number(digit)]!,
	)
	return `${i18n.significant(value / 10 ** exponent, 3)} × 10${exponent < 0 ? "⁻" : ""}${power}`
}

/** One decimal below 10, whole numbers above: the exact levels' figure for a ratio ("1.9", "11"). */
export const roughly = (value: number): number =>
	Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10

/** A ratio as a count: rounded for the exact levels, `countArgs` for the simple one. */
const ratioArgs = (ratio: number, i18n: I18n): CountArgs =>
	countArgs(isSimple(i18n) ? ratio : roughly(ratio), i18n)

/**
 * A comparison in three cases: `ratio` from `band` up is "more", from
 * 1/`band` down "less", everything between "similar", and so is a ratio that
 * would read "1 time" once rounded (1.1 is "1" for a child).
 */
function compared(
	ratio: number,
	band: number,
	i18n: I18n,
): { case: "more" | "less"; args: CountArgs } | { case: "similar" } {
	if (ratio >= band) {
		const args = ratioArgs(ratio, i18n)
		if (args.count > 1) return { case: "more", args }
	} else if (ratio <= 1 / band) {
		const args = ratioArgs(1 / ratio, i18n)
		if (args.count > 1) return { case: "less", args }
	}
	return { case: "similar" }
}

// ------------------------------------------------------------ temperature

/**
 * A temperature: kelvin as a number, or as its source states it (`{ c }` in
 * degrees Celsius, `{ k }` in kelvin), which keeps a big round figure round
 * when converted ("15 million °C" is 15 million K, not 15,000,273 K).
 */
export type Temperature =
	number | { readonly c: number } | { readonly k: number }

/** Degrees Celsius of a temperature. */
export const celsiusOf = (temperature: Temperature): number =>
	typeof temperature === "number"
		? temperature - KELVIN_OFFSET
		: "c" in temperature
			? temperature.c
			: temperature.k - KELVIN_OFFSET

/** Kelvin of a temperature. */
export const kelvinOf = (temperature: Temperature): number =>
	celsiusOf(temperature) + KELVIN_OFFSET

/** The simple level's temperatures, hottest first. */
export const TEMPERATURE_WORDS = [
	"hotterThanSun",
	"fire",
	"oven",
	"boiling",
	"desert",
	"warm",
	"mild",
	"chilly",
	"freezer",
	"colderThanEarth",
	"airFreezes",
] as const

export type TemperatureWord = (typeof TEMPERATURE_WORDS)[number]

/**
 * From which temperature (°C) each word applies: the Sun's surface is about
 * 5,500 °C, a fire up to 1,000 °C, a kitchen oven 250 °C, the hottest desert
 * 57 °C, a freezer −18 °C, the coldest place on Earth −89 °C; below −210 °C
 * even air (nitrogen) freezes.
 */
const TEMPERATURE_FROM_C: Readonly<Record<TemperatureWord, number>> = {
	hotterThanSun: 6000,
	fire: 1000,
	oven: 250,
	boiling: 100,
	desert: 40,
	warm: 25,
	mild: 5,
	chilly: -20,
	freezer: -90,
	colderThanEarth: -210,
	airFreezes: -Infinity,
}

/** The word for a temperature: Mercury "oven", Earth "mild", Mars "freezer", Neptune "airFreezes". */
export function temperatureWord(temperature: Temperature): TemperatureWord {
	const celsius = celsiusOf(temperature)
	return (
		TEMPERATURE_WORDS.find((word) => celsius >= TEMPERATURE_FROM_C[word]) ??
		"airFreezes"
	)
}

/**
 * A converted temperature: to the whole degree, but for the huge ones to the
 * step their source was stated in (15 million °C is 15 million K).
 */
function converted(value: number, stated: number): number {
	if (Math.abs(stated) < 10_000) return Math.round(value)
	const whole = String(Math.abs(Math.round(stated)))
	const step = 10 ** (whole.length - whole.replace(/0+$/, "").length)
	return Math.round(value / step) * step
}

/** Up to a million with grouping ("5,499"), beyond it in words ("15 million"). */
function degreesCount(value: number, i18n: I18n): string {
	if (Math.abs(value) < 1e6) return i18n.number(value)
	return compactFormat(i18n.formatLocale).format(value)
}

const compactFormats = new Map<string, Intl.NumberFormat>()

const compactFormat = (locale: string): Intl.NumberFormat => {
	let format = compactFormats.get(locale)
	if (format === undefined) {
		format = new Intl.NumberFormat(locale, {
			notation: "compact",
			compactDisplay: "long",
			maximumSignificantDigits: 2,
		})
		compactFormats.set(locale, format)
	}
	return format
}

/**
 * A temperature: words at `simple` ("colder than any freezer"), °C at
 * `standard` ("−63 °C", "15 million °C"), kelvin with °C at `advanced`
 * ("210 K (−63 °C)"). Whole degrees; a value stated in the other unit keeps
 * its source's round figure.
 */
export function formatTemperature(
	temperature: Temperature,
	i18n: I18n,
): string {
	const celsius = celsiusOf(temperature)
	if (!Number.isFinite(celsius)) return MISSING_VALUE
	if (isSimple(i18n)) {
		return i18n.t(`quantity.temperature.${temperatureWord(temperature)}`)
	}
	const stated =
		typeof temperature === "number" ? { k: temperature } : temperature
	const c = "c" in stated ? Math.round(stated.c) : converted(celsius, stated.k)
	// "15 millones de °C": Spanish and French join a number in words to its unit
	const big = Math.abs(c) >= 1e6 ? "yes" : "no"
	if (i18n.readingLevel !== "advanced") {
		return i18n.t("quantity.celsius", { value: degreesCount(c, i18n), big })
	}
	const k =
		"k" in stated ? Math.round(stated.k) : converted(kelvinOf(stated), stated.c)
	return i18n.t("quantity.kelvin", {
		kelvin: degreesCount(k, i18n),
		celsius: degreesCount(c, i18n),
		big,
	})
}

/**
 * A range of temperatures, coldest first: "from −173 °C to 427 °C", "from
 * colder than any freezer to hotter than an oven"; one phrase when both ends
 * share it.
 */
export function formatTemperatureRange(
	min: Temperature,
	max: Temperature,
	i18n: I18n,
): string {
	const [low, high] = celsiusOf(min) <= celsiusOf(max) ? [min, max] : [max, min]
	const from = formatTemperature(low, i18n)
	const to = formatTemperature(high, i18n)
	return from === to
		? from
		: i18n.t("quantity.temperatureRange", { min: from, max: to })
}

// ------------------------------------------------------------------ sizes

export type SizeWord = "gigantic" | "huge" | "big" | "small" | "tiny"

/** A size in one word, against Earth: the Sun gigantic, Jupiter huge, Earth big, Mars small, Pluto tiny. */
export function sizeWord(diameterKm: number): SizeWord {
	const earths = diameterKm / EARTH_DIAMETER_KM
	return earths >= 30
		? "gigantic"
		: earths >= 3
			? "huge"
			: earths >= 0.75
				? "big"
				: earths >= 0.2
					? "small"
					: "tiny"
}

/**
 * A diameter: one word at `simple` ("huge"), the kilometres above it
 * ("139,822 km"; callers round it as their numbers need).
 */
export const formatSize = (diameterKm: number, i18n: I18n): string =>
	isSimple(i18n)
		? i18n.t(`quantity.size.${sizeWord(diameterKm)}`)
		: i18n.quantity(diameterKm, "kilometer")

/**
 * A diameter with Earth as the yardstick: "11 Earths wide", "about as wide
 * as Earth", "so small that 4 of them would fit across Earth", "more than 100
 * Earths wide" at `simple`.
 */
export function sizeVsEarth(diameterKm: number, i18n: I18n): string {
	const ratio = diameterKm / EARTH_DIAMETER_KM
	if (ratio >= 1.25) {
		return i18n.t("quantity.sizeVsEarth.wider", ratioArgs(ratio, i18n))
	}
	if (ratio > 0.8) return i18n.t("quantity.sizeVsEarth.similar")
	return i18n.t("quantity.sizeVsEarth.narrower", ratioArgs(1 / ratio, i18n))
}

/**
 * Everyday things by typical size (#25, the walk's set, shared so the
 * comparisons fit together across the app): familiar in every shipped
 * language (no national coins or foods), close enough together that the
 * nearest one is never off by more than about 1.4x up to the football; then
 * the exercise ball the walk's Sun can be, and a house for the Sun when Earth
 * is an orange. Their names: `quantity.thing.<id>`.
 */
export const THINGS = {
	fineSand: { diameterM: 0.0002 }, // fine sand: 0.125–0.25 mm
	salt: { diameterM: 0.0003 }, // a grain of table salt: about 0.3 mm
	sugar: { diameterM: 0.0006 }, // a grain of granulated sugar: 0.5–0.8 mm
	poppySeed: { diameterM: 0.001 }, // about 1 mm
	pinhead: { diameterM: 0.002 }, // the head of a dressmaker's pin: 1.5–2 mm
	peppercorn: { diameterM: 0.0045 }, // black pepper: 4–5 mm
	pea: { diameterM: 0.008 }, // a garden pea: 7–10 mm
	marble: { diameterM: 0.016 }, // the standard marble
	cherry: { diameterM: 0.022 }, // 2–2.5 cm
	walnut: { diameterM: 0.032 }, // 3–3.5 cm
	tableTennisBall: { diameterM: 0.04 }, // exactly 40 mm (ITTF)
	tennisBall: { diameterM: 0.067 }, // 6.54–6.86 cm (ITF)
	orange: { diameterM: 0.08 },
	grapefruit: { diameterM: 0.11 },
	melon: { diameterM: 0.15 }, // a small melon (Galia, cantaloupe)
	football: { diameterM: 0.22 }, // a size 5 football
	exerciseBall: { diameterM: 1 }, // a large exercise (gym) ball, the walk's biggest Sun
	house: { diameterM: 9 }, // a two- or three-storey house, as tall as it is wide
} as const satisfies Record<string, { diameterM: number }>

export type ThingId = keyof typeof THINGS

const THING_IDS = Object.keys(THINGS) as ThingId[]

/** The everyday thing closest in size to `diameterM` (nearest on a log scale). */
export function nearestThing(diameterM: number): ThingId {
	let best: ThingId = THING_IDS[0]
	let bestMiss = Infinity
	for (const id of THING_IDS) {
		const miss = Math.abs(Math.log(diameterM / THINGS[id].diameterM))
		if (miss < bestMiss) {
			best = id
			bestMiss = miss
		}
	}
	return best
}

/**
 * The object Earth becomes in the everyday comparisons, the scale of the
 * simple texts (bodies.json, tours): Earth an orange, the Moon a cherry 30
 * oranges away, Jupiter about an exercise ball, the Sun as big as a house.
 */
export const EARTH_AS: ThingId = "orange"

/** How well the nearest thing fits: "as big as", or beyond the ends of the set "even smaller/bigger than". */
export type ThingFit = "about" | "smaller" | "bigger"

/** The thing a body of `diameterKm` would be if Earth were `earthAs`. */
export function everydayThing(
	diameterKm: number,
	earthAs: ThingId = EARTH_AS,
): { thing: ThingId; fit: ThingFit } {
	const metres = (diameterKm / EARTH_DIAMETER_KM) * THINGS[earthAs].diameterM
	const thing = nearestThing(metres)
	const miss = metres / THINGS[thing].diameterM
	return {
		thing,
		fit: miss < 1 / 1.5 ? "smaller" : miss > 1.5 ? "bigger" : "about",
	}
}

/** The name of an everyday thing with its article: "a pea", "eine Erbse". */
export const thingName = (id: ThingId, i18n: I18n): string =>
	i18n.t(`quantity.thing.${id}`)

/**
 * "If Earth were as small as an orange, Jupiter would be as big as an
 * exercise ball"; null for Earth itself. `name` is the body's name in the
 * active language.
 */
export function everydaySize(
	body: { id: string; name: string; diameterKm: number },
	i18n: I18n,
	earthAs: ThingId = EARTH_AS,
): string | null {
	if (body.id === "earth") return null
	const { thing, fit } = everydayThing(body.diameterKm, earthAs)
	return i18n.t("quantity.everyday", {
		earth: thingName(earthAs, i18n),
		bodyId: body.id,
		body: body.name,
		thing: thingName(thing, i18n),
		fit,
	})
}

// -------------------------------------------------------------- distances

/** Three significant digits, for the kilometres of a trip. */
const threeDigits = (value: number): number =>
	value > 0 ? Number(value.toPrecision(3)) : 0

/**
 * A distance in words for children, from short to long yardsticks:
 * "12 km", "less than the width of one Earth", "as far as 30 Earths in a
 * row", "4 times as far as the Moon is from Earth", "about half as far as
 * Earth is from the Sun", "5 times as far as Earth is from the Sun", "more
 * than 100 times as far as Earth is from the Sun". Works after "It is …" and
 * as a value of its own. Any level (the simple one's words).
 */
export function distanceInWords(km: number, i18n: I18n): string {
	const distance = Math.abs(km)
	if (!Number.isFinite(distance)) return MISSING_VALUE
	if (distance <= SIMPLE_LIMIT) {
		return i18n.quantity(childNumber(distance) ?? 0, "kilometer")
	}
	const earths = distance / EARTH_DIAMETER_KM
	if (earths < 0.75) return i18n.t("quantity.distance.lessThanEarth")
	if (childNumber(earths) !== null) {
		return i18n.t("quantity.distance.earths", childArgs(earths, i18n))
	}
	const moons = distance / EARTH_MOON_KM
	if (childNumber(moons) !== null) {
		return i18n.t("quantity.distance.moons", childArgs(moons, i18n))
	}
	const suns = distance / EARTH_SUN_KM
	if (suns < 0.85) {
		const part =
			suns < 0.29
				? "quarter"
				: suns < 0.42
					? "third"
					: suns < 0.6
						? "half"
						: "threeQuarters"
		return i18n.t("quantity.distance.partOfSun", { part })
	}
	if (suns < 1.25) return i18n.t("quantity.distance.sun")
	return i18n.t("quantity.distance.suns", childArgs(suns, i18n))
}

/**
 * A distance: `distanceInWords` at `simple`; above it "384,000 km",
 * "628 million km", "4.35 billion km" (three significant digits).
 */
export function formatDistance(km: number, i18n: I18n): string {
	if (isSimple(i18n)) return distanceInWords(km, i18n)
	if (!Number.isFinite(km)) return MISSING_VALUE
	if (km < 1e6) return i18n.quantity(threeDigits(km), "kilometer")
	if (km < 1e9) {
		return i18n.t("units.millionKm", { value: i18n.significant(km / 1e6, 3) })
	}
	return i18n.t("units.billionKm", { value: i18n.significant(km / 1e9, 3) })
}

// -------------------------------------------------------------- durations

/** A long human life, the yardstick for spans beyond 100 years (years). */
export const LONG_LIFE_YEARS = 80

/** Spans too long to count even in lives, in years from which each applies, longest first. */
const AGES = [
	// the dinosaurs died out 66 million years ago
	["dinosaurs", 66e6],
	// our species is about 300,000 years old
	["people", 300_000],
	// the Great Pyramid of Giza is about 4,500 years old; 100 long lives are 8,000 years
	["pyramids", 0],
] as const

/** The units a child counts time in, each up to where the next takes over. */
const SPANS: readonly (readonly [
	"second" | "minute" | "hour" | "day" | "month" | "year",
	number,
	number,
])[] = [
	["second", 1, 90],
	["minute", MINUTE, 90],
	["hour", HOUR, 48],
	["day", DAY, 100],
	["month", MONTH, 18],
	["year", YEAR, SIMPLE_LIMIT + 0.5],
]

/**
 * A length of time for children: "less than a second", "8 minutes",
 * "4 hours", "10 days", "4 months", "12 years", then in long human lives
 * of 80 years ("9 long human lives"), then words: "longer than since the
 * pyramids were built", "… there have been people", "… since the dinosaurs
 * died out". Any level (the simple one's words). Negative spans are measured
 * as positive.
 */
export function durationInWords(seconds: number, i18n: I18n): string {
	const span = Math.abs(seconds)
	if (!Number.isFinite(span)) return MISSING_VALUE
	if (span < 0.75) return i18n.t("quantity.duration.lessThanSecond")
	for (const [unit, size, below] of SPANS) {
		const value = span / size
		if (value < below) {
			// messages, not Intl's unit names: they read right after "in", "for"
			// and "za" (Czech "za 1 sekundu", German frames take no dative)
			return i18n.t(`quantity.unit.${unit}`, {
				count: childNumber(value) ?? SIMPLE_LIMIT,
			})
		}
	}
	const years = span / YEAR
	const lives = years / LONG_LIFE_YEARS
	if (childNumber(lives) !== null) {
		return i18n.t("quantity.duration.lifetimes", childArgs(lives, i18n))
	}
	const [age] = AGES.find(([, from]) => years >= from) ?? AGES[AGES.length - 1]
	return i18n.t(`quantity.duration.${age}`)
}

/**
 * A day with the day at home as the yardstick (`solarDayDays` in Earth days,
 * sunrise to sunrise): "A day there lasts as long as 10 days at home", "A
 * day there lasts about as long as at home", "A day there is over in 10
 * hours".
 */
export function dayVsEarth(solarDayDays: number, i18n: I18n): string {
	const days = Math.abs(solarDayDays)
	if (days >= 1.5) {
		return i18n.t("quantity.dayVsEarth.longer", ratioArgs(days, i18n))
	}
	if (days > 0.75) return i18n.t("quantity.dayVsEarth.similar")
	return i18n.t("quantity.dayVsEarth.shorter", {
		time: isSimple(i18n)
			? durationInWords(days * DAY, i18n)
			: i18n.quantity(roughly(days * 24), "hour", "long"),
	})
}

/**
 * A year with the year at home as the yardstick (`yearDays` in Earth days):
 * "A year there lasts as long as 12 years at home", "A year there lasts
 * about as long as at home", "In one year at home, it goes around the Sun 4
 * times".
 */
export function yearVsEarth(yearDays: number, i18n: I18n): string {
	const years = Math.abs(yearDays) / 365.25
	if (years >= 1.25) {
		return i18n.t("quantity.yearVsEarth.longer", ratioArgs(years, i18n))
	}
	if (years > 0.8) return i18n.t("quantity.yearVsEarth.similar")
	return i18n.t("quantity.yearVsEarth.shorter", ratioArgs(1 / years, i18n))
}

// ------------------------------------------------- weight, mass and speed

/**
 * Weight on another world against weight at home (`ratio` = its surface
 * gravity / Earth's): "You would weigh twice as much as at home", "You would
 * weigh about as much as at home", "You would be 6 times lighter than at home".
 */
export function weightVsEarth(ratio: number, i18n: I18n): string {
	const result = compared(ratio, 1.1, i18n)
	return result.case === "similar"
		? i18n.t("quantity.weightVsEarth.similar")
		: i18n.t(`quantity.weightVsEarth.${result.case}`, result.args)
}

/** A weight: "76 kg", "more than 100 kg" at `simple`; one decimal below 100 kg above it. */
export function formatWeight(kg: number, i18n: I18n): string {
	if (!isSimple(i18n)) {
		return i18n.quantity(
			kg < 100 ? Math.round(kg * 10) / 10 : Math.round(kg),
			"kilogram",
		)
	}
	return i18n.t("quantity.weight", { n: formatCount(kg, i18n) })
}

/**
 * A mass with Earth as the yardstick: "as heavy as 318 Earths", "about as
 * heavy as Earth", "so light that 10 of them would weigh as much as Earth"
 * ("more than 100" at `simple`).
 */
export function massVsEarth(kg: number, i18n: I18n): string {
	const result = compared(kg / EARTH_MASS_KG, 1.1, i18n)
	return result.case === "similar"
		? i18n.t("quantity.massVsEarth.similar")
		: i18n.t(`quantity.massVsEarth.${result.case}`, result.args)
}

/** A speed: "17 km every second" at `simple` (to 100), "17 km/s" above it. */
export function formatSpeed(kmPerSecond: number, i18n: I18n): string {
	return isSimple(i18n)
		? i18n.t("quantity.speed", countArgs(kmPerSecond, i18n))
		: i18n.quantity(kmPerSecond, "kilometer-per-second")
}
