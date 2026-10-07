import { bodyById, planets, sun } from "@/data"

/**
 * The index of a body's entry in the visual dictionary
 * (`/solar_dictionary?entity=<index>`), or null when it has none: the Sun is 0,
 * the planets 1..8 from the Sun outwards (`src/data/solarDictionary.ts`).
 * Worked out from the body model, so the solar system page never loads the
 * dictionary's data.
 */
export function dictionaryEntry(id: string): number | null {
	if (id === sun.id) return 0
	const index = planets.findIndex((planet) => planet.id === id)
	return index < 0 ? null : index + 1
}

/**
 * The entry to open for whatever is in view (Tools → the dictionary, #45): the
 * body's own, else that of the world it circles (Io opens Jupiter), else the
 * Sun's (an asteroid, a spacecraft, the overview).
 */
export function nearestDictionaryEntry(id: string | null): number {
	let body = id === null ? undefined : bodyById.get(id)
	while (body !== undefined) {
		const entry = dictionaryEntry(body.id)
		if (entry !== null) return entry
		body = body.parentId === null ? undefined : bodyById.get(body.parentId)
	}
	return 0
}
