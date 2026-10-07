import { describe, expect, it } from "vitest"

import { LOCALES, READING_LEVELS, createI18n } from "@/i18n"
import { bodyName } from "@/i18n/bodies"

import {
	EARTHS_TO_THE_MOON,
	INNER_PLANETS,
	captionReadingMs,
	introCaption,
	listOfNames,
} from "./captions"
import {
	CAPTION_FADE_MS,
	INTRO_BEATS,
	SCALE_REVEAL_MS,
	introSteps,
	sequenceLengthMs,
} from "./script"

const captions = (
	locale: (typeof LOCALES)[number],
	readingLevel = "standard",
) => {
	const i18n = createI18n({
		locale,
		readingLevel: readingLevel as (typeof READING_LEVELS)[number],
	})
	const name = (id: string) => bodyName(id, i18n.chain)
	return Object.fromEntries(
		INTRO_BEATS.map((beat) => [beat, introCaption(beat, i18n, name)]),
	)
}

describe("the opening's captions", () => {
	it("says 30 Earths fit between Earth and the Moon", () => {
		expect(EARTHS_TO_THE_MOON).toBe(30)
	})

	for (const locale of LOCALES) {
		for (const level of READING_LEVELS) {
			it(`has a title and a detail for every beat (${locale}, ${level})`, () => {
				for (const caption of Object.values(captions(locale, level))) {
					expect(caption.title.length).toBeGreaterThan(3)
					expect(caption.detail.length).toBeGreaterThan(3)
					// every argument was filled in, no key leaked through
					expect(caption.title + caption.detail).not.toMatch(
						/[{}]|solarSystem\./,
					)
					// short enough to read in a beat
					expect(caption.title.length).toBeLessThanOrEqual(50)
					expect(caption.detail.length).toBeLessThanOrEqual(160)
				}
			})
		}
	}

	it("reads naturally in English and German", () => {
		const en = captions("en")
		expect(en.earth.title).toBe("This is Earth.")
		expect(en.moon.detail).toBe("30 Earths would fit in the gap.")
		expect(en.inner.detail).toBe(
			"Mercury, Venus, Earth, and Mars, the four rocky worlds nearest the Sun.",
		)
		const de = captions("de")
		expect(de.earth.title).toBe("Das ist die Erde.")
		expect(de.inner.detail).toBe(
			"Merkur, Venus, Erde und Mars: die vier Gesteinswelten nahe der Sonne.",
		)
		expect(captions("de", "advanced").moon.detail).toBe(
			"384.000 km entfernt: 30 Erddurchmesser.",
		)
		expect(captions("en", "simple").system.title).toBe(
			"Everything, at its real size",
		)
	})

	it("lists names in the locale's own way", () => {
		const names = (id: string) => id.toUpperCase()
		expect(listOfNames(INNER_PLANETS, names, { locale: "de" })).toBe(
			"MERCURY, VENUS, EARTH und MARS",
		)
	})
})

describe("the opening's reading time (#49)", () => {
	/** Words as a reader counts them: runs of letters or digits between spaces. */
	const words = (text: string) =>
		text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
	/** Read aloud at a calm pace (about 130 words a minute), never under 3.5 s. */
	const toRead = (text: string) => Math.max(3500, 1500 + 450 * words(text))

	for (const level of READING_LEVELS) {
		for (const reducedMotion of [false, true]) {
			const steps = introSteps({
				earthAzimuthDeg: 0,
				reducedMotion,
				readMs: captionReadingMs(level),
			})
			const how = `${level}${reducedMotion ? ", reduced motion" : ""}`

			it(`lets every caption be read aloud in every language (${how})`, () => {
				for (const locale of LOCALES) {
					const shown = captions(locale, level)
					for (const [index, beat] of INTRO_BEATS.entries()) {
						const { title, detail } = shown[beat]
						const move = steps[index].durationMs ?? 0
						const end = move + (steps[index].holdMs ?? 0)
						// from the moment the caption is fully in and nothing moves: the camera
						// has arrived, the fade is over, the scale switch has landed
						const readFrom = reducedMotion
							? 0
							: Math.max(
									move,
									CAPTION_FADE_MS,
									beat === "scale" ? SCALE_REVEAL_MS : 0,
								)
						expect(
							end - readFrom,
							`${locale}, ${level}, ${beat}: “${title} ${detail}”`,
						).toBeGreaterThanOrEqual(toRead(`${title} ${detail}`))
					}
				}
			})

			it(`takes the reading time of that level's longest translations and no more (${how})`, () => {
				const longest = INTRO_BEATS.map((beat) =>
					Math.max(
						...LOCALES.map((locale) => {
							const { title, detail } = captions(locale, level)[beat]
							return toRead(`${title} ${detail}`)
						}),
					),
				)
				const reading = longest.reduce((ms, read) => ms + read, 0)
				const total = sequenceLengthMs(steps)
				expect(total).toBeGreaterThanOrEqual(reading)
				// the moves, one fade and the scale switch on top, nothing else
				expect(total).toBeLessThan(reading + (reducedMotion ? 1 : 12_000))
			})
		}
	}

	it("keeps every caption short: 20 words at most, 24 at the advanced level", () => {
		for (const locale of LOCALES) {
			for (const level of READING_LEVELS) {
				for (const [beat, { title, detail }] of Object.entries(
					captions(locale, level),
				)) {
					expect(
						words(`${title} ${detail}`),
						`${locale}, ${level}, ${beat}: “${title} ${detail}”`,
					).toBeLessThanOrEqual(level === "advanced" ? 24 : 20)
				}
			}
		}
	})
})
