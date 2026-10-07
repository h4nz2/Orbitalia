/**
 * The words of the opening (#30): one short title and one line of detail per
 * beat, at every reading level, plus the hand-over hints. Every number comes
 * from the data and is formatted for the locale. How long each caption stays
 * up follows from these words (#49, `captionReadingMs`).
 */
import { bodyById } from "@/data"
import { LOCALES, createI18n, type I18n, type ReadingLevel } from "@/i18n"
import { bodyName } from "@/i18n/bodies"

import {
	INTRO_BEATS,
	MOON_DISTANCE_KM,
	countWords,
	readingMs,
	type IntroBeat,
	type ReadingTimes,
} from "./script"

export interface Caption {
	title: string
	detail: string
}

const EARTH_DIAMETER_KM = 2 * (bodyById.get("earth")?.radiusKm ?? 6371)

/** How many Earths fit between Earth and the Moon (centre to centre, rounded): 30. */
export const EARTHS_TO_THE_MOON = Math.round(
	MOON_DISTANCE_KM / EARTH_DIAMETER_KM,
)

/** The inner planets, Sun outwards. */
export const INNER_PLANETS = ["mercury", "venus", "earth", "mars"] as const

/** "Mercury, Venus, Earth, and Mars" / "Merkur, Venus, Erde und Mars". */
export function listOfNames(
	ids: readonly string[],
	name: (id: string) => string,
	i18n: Pick<I18n, "locale">,
): string {
	const names = ids.map(name)
	try {
		return new Intl.ListFormat(i18n.locale, {
			style: "long",
			type: "conjunction",
		}).format(names)
	} catch {
		return names.join(", ")
	}
}

/** The caption of `beat`. */
export function introCaption(
	beat: IntroBeat,
	i18n: I18n,
	name: (id: string) => string,
): Caption {
	const { t } = i18n
	switch (beat) {
		case "earth":
			return {
				title: t("solarSystem.intro.earth.title"),
				detail: t("solarSystem.intro.earth.detail"),
			}
		case "moon":
			return {
				title: t("solarSystem.intro.moon.title"),
				detail: t("solarSystem.intro.moon.detail", {
					earths: EARTHS_TO_THE_MOON,
					km: i18n.quantity(
						Math.round(MOON_DISTANCE_KM / 1000) * 1000,
						"kilometer",
					),
				}),
			}
		case "inner":
			return {
				title: t("solarSystem.intro.inner.title"),
				detail: t("solarSystem.intro.inner.detail", {
					planets: listOfNames(INNER_PLANETS, name, i18n),
				}),
			}
		case "system":
			return {
				title: t("solarSystem.intro.system.title"),
				detail: t("solarSystem.intro.system.detail"),
			}
		case "scale":
			return {
				title: t("solarSystem.intro.scale.title"),
				detail: t("solarSystem.intro.scale.detail"),
			}
	}
}

/** The words a caption has to be read in: its title and its detail. */
export const captionWords = (caption: Caption): number =>
	countWords(caption.title) + countWords(caption.detail)

const readingTimes = new Map<ReadingLevel, ReadingTimes>()

/**
 * How long each beat's caption stays up at `readingLevel` (#49): the reading
 * time of its longest translation at that level, so a class reading aloud in
 * a second language finishes it too. Worked out once per level, from the
 * words themselves: a caption that grows in translation gets its time with it.
 */
export function captionReadingMs(readingLevel: ReadingLevel): ReadingTimes {
	const known = readingTimes.get(readingLevel)
	if (known !== undefined) return known
	const longest = Object.fromEntries(
		INTRO_BEATS.map((beat) => [beat, 0]),
	) as Record<IntroBeat, number>
	for (const locale of LOCALES) {
		const i18n = createI18n({ locale, readingLevel })
		const name = (id: string) => bodyName(id, i18n.chain)
		for (const beat of INTRO_BEATS) {
			const words = captionWords(introCaption(beat, i18n, name))
			longest[beat] = Math.max(longest[beat], words)
		}
	}
	const times = Object.fromEntries(
		INTRO_BEATS.map((beat) => [beat, readingMs(longest[beat])]),
	) as Record<IntroBeat, number>
	readingTimes.set(readingLevel, times)
	return times
}
