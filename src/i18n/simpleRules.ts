/**
 * The simple reading level's number rule (#51) as a check: what a text for
 * ages 6–11 must not contain. `simpleLevel.test.ts` runs it over every
 * simple-level string of every locale and over the simple-level output of
 * the quantity helpers; other tests (hunts, dictionary) can run it on theirs.
 *
 * Forbidden at the simple level:
 *
 * - a number above `SIMPLE_LIMIT` (100), in the locale's own way of writing
 *   it ("1,300", "1.300", "1 300", "1300"); years count too ("in 2003" is
 *   "long ago" for a six-year-old);
 * - the words for thousand, million, billion (and trillion) in the locale,
 *   also inside compounds ("Jahrmillionen", "tisíce");
 * - scientific units and notation: AU (AE, au, UA), kelvin, m/s², degrees
 *   Celsius or Fahrenheit, "× 10", "1e6", superscript digits.
 *
 * "Hundreds" is fine, small numbers are fine ("11 Earths", "2 moons",
 * "4 hours"), and so are km for short distances ("22 km"). Pure, no React.
 */
import { SIMPLE_LIMIT } from "./quantities"

/** How each language writes numbers: what separates the thousands, what the decimals. */
const SEPARATORS: Readonly<Record<string, { group: string; decimal: string }>> =
	{
		en: { group: ",", decimal: "." },
		de: { group: ".’'", decimal: "," },
		cs: { group: "   ", decimal: "," },
		es: { group: ".   ", decimal: "," },
		fr: { group: "   ", decimal: "," },
	}

/** The words for big numbers, per language (matched without case, inside words too where marked). */
const BIG_WORDS: Readonly<Record<string, RegExp>> = {
	en: /(?<!\p{L})(thousands?|millions?|billions?|trillions?)(?!\p{L})/iu,
	de: /(tausend|million|milliard|billion)/iu,
	cs: /(tisíc|milion|miliard|bilion)/iu,
	es: /(?<!\p{L})(mil|miles|millón|millones|millardos?|billón|billones)(?!\p{L})/iu,
	fr: /(?<!\p{L})(mille|milliers?|millions?|milliards?|billions?)(?!\p{L})/iu,
}

/** The astronomical unit's symbol per language. */
const AU: Readonly<Record<string, RegExp>> = {
	en: /(?<!\p{L})AU(?!\p{L})/u,
	de: /(?<!\p{L})AE(?!\p{L})/u,
	cs: /(?<!\p{L})au(?!\p{L})/u,
	es: /(?<!\p{L})(ua|UA)(?!\p{L})/u,
	fr: /(?<!\p{L})(ua|UA)(?!\p{L})/u,
}

/** Units and notation no child reads, in any language. */
const SCIENTIFIC: readonly (readonly [string, RegExp])[] = [
	["kelvin", /\d\s?K(?!\p{L})|kelvin/iu],
	["m/s²", /m\s?\/\s?s(²|2|\^2)|m s⁻²/u],
	["degrees", /°\s?[CF](?!\p{L})/u],
	["× 10", /[×x]\s?10(?=[\s⁰¹²³⁴⁵⁶⁷⁸⁹^⁻])/u],
	["e-notation", /\d[eE][+-]?\d/u],
	["superscript", /[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/u],
]

const escape = (chars: string): string =>
	[...chars]
		.map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)
		.join("")

const numberPatterns = new Map<string, RegExp>()

/** Digits with the language's thousands groups and decimals: "1,300.5" / "1.300,5" / "1 300,5". */
function numberPattern(language: string): RegExp {
	let pattern = numberPatterns.get(language)
	if (pattern === undefined) {
		const { group, decimal } = SEPARATORS[language] ?? SEPARATORS.en
		pattern = new RegExp(
			`\\d+(?:[${escape(group)}]\\d{3}(?!\\d))*(?:[${escape(decimal)}]\\d+)?`,
			"gu",
		)
		numberPatterns.set(language, pattern)
	}
	return pattern
}

/** The value of a number written in `language`'s style. */
function parseNumber(written: string, language: string): number {
	const { group, decimal } = SEPARATORS[language] ?? SEPARATORS.en
	let plain = ""
	for (const char of written) {
		if (group.includes(char)) continue
		plain += decimal.includes(char) ? "." : char
	}
	return Number(plain)
}

/**
 * What breaks the simple level's rule in `text`, one entry per finding
 * ("1,300", "million", "AU", "kelvin"); empty when the text is fine.
 * `locale` picks the language's number style and words ("de-CH" reads as "de").
 */
export function simpleProblems(text: string, locale: string): string[] {
	const language = locale.split("-")[0]
	const problems: string[] = []
	for (const [written] of text.matchAll(numberPattern(language))) {
		if (parseNumber(written, language) > SIMPLE_LIMIT) problems.push(written)
	}
	const big = text.match(BIG_WORDS[language] ?? BIG_WORDS.en)
	if (big) problems.push(big[0])
	const au = text.match(AU[language] ?? AU.en)
	if (au) problems.push(au[0])
	for (const [name, pattern] of SCIENTIFIC) {
		if (pattern.test(text)) problems.push(name)
	}
	return problems
}
