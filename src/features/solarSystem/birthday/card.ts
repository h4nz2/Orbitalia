/**
 * The birthday result as a picture (issue #26, "shareable as an image"): the
 * words of it. The picture itself is the postcard of the view (#33,
 * ../postcard): the planets on screen with these ages and the distance
 * travelled stamped below, made on the device; nothing is uploaded.
 *
 * The card shows the ages and the distance travelled, never the birth date
 * itself: whoever the picture is passed on to learns how old someone is on
 * Mars, not when they were born.
 */
import { formatCount, type I18n } from "@/i18n"

import type { BirthdayFacts } from "./birthday"

/** Planet colours for the dots in the panel and on the card (the dominant colour of each texture). */
export const WORLD_COLORS: Readonly<Record<string, string>> = {
	sun: "#ffc94d",
	mercury: "#a8a29a",
	venus: "#e8c98f",
	earth: "#4f8fe8",
	moon: "#c9c9c9",
	mars: "#d9623b",
	jupiter: "#d8a878",
	io: "#e6d36a",
	europa: "#c8b89a",
	ganymede: "#9c8f80",
	callisto: "#6f665c",
	saturn: "#e3c887",
	titan: "#d9a441",
	uranus: "#8fd6dc",
	neptune: "#4a6fe0",
	triton: "#c7b6ae",
}

export const worldColor = (id: string): string => WORLD_COLORS[id] ?? "#999"

/** One line of the card: a world and the age there. */
export interface CardRow {
	id: string
	name: string
	age: string
}

/** Everything the card says, in the active language (pure, tested). */
export interface CardText {
	title: string
	date: string
	rows: CardRow[]
	distance: string
	fileName: string
}

/**
 * The simple level's "how far": not billions of kilometres but how many
 * times Earth has carried you around the Sun, your age in Earth years (#51).
 */
export function lapsArgs(
	facts: BirthdayFacts,
	i18n: I18n,
): { laps: number; n: string } {
	const laps = facts.worlds.find((world) => world.id === "earth")?.age ?? 0
	return { laps, n: formatCount(laps, i18n) }
}

export function cardText(
	facts: BirthdayFacts,
	i18n: I18n,
	name: (id: string) => string,
	formatDay: (day: string) => string,
	distance: string,
): CardText {
	return {
		title: i18n.t("solarSystem.birthday.card.title"),
		date: i18n.t("solarSystem.birthday.card.date", {
			date: formatDay(facts.today),
		}),
		rows: facts.worlds.map((world) => ({
			id: world.id,
			name: name(world.id),
			age: i18n.t("solarSystem.birthday.years.age", {
				age: world.age,
				n: formatCount(world.age, i18n),
			}),
		})),
		distance: i18n.t("solarSystem.birthday.card.distance", {
			distance,
			...lapsArgs(facts, i18n),
		}),
		fileName: `${i18n.t("solarSystem.birthday.card.fileName")}.png`,
	}
}
