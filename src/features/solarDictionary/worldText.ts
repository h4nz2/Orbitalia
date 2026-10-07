/**
 * The words of the dictionary's stories (#53), per locale and reading level:
 * `src/locales/<locale>/worlds.json`, like the hunts' words. The facts and
 * their sources are `src/data/worlds.json`.
 *
 * ```
 * layers.<layerId>                 the name of a layer in the cut-away picture
 * gases.<gasId>                    the name of a gas
 * worlds.<worldId>.madeOf          what it is made of, in a sentence or two
 * worlds.<worldId>.air             its air
 * worlds.<worldId>.weather         how hot or cold it gets, and why
 * worlds.<worldId>.nicknames.<id>  { name, story }: the nickname and how it came about
 * worlds.<worldId>.name            where its name comes from
 * worlds.<worldId>.localName       the story of this language's own name for it (only
 *                                  where src/data/worlds.json lists this locale)
 * worlds.<worldId>.discovery       known since ancient times, or who found it and when
 * ```
 *
 * Every text field is one value for all reading levels or one per level (the
 * default level required), plain text, not ICU. Lookup walks the locale chain
 * (de -> en); within a locale the reading level wins. A local name story is
 * never borrowed from another language: it belongs to the words it explains.
 */
import { z } from "zod"

import type { I18n, Locale } from "@/i18n"
import { leveled, pickLevel } from "@/i18n/bodies"

const text = z.string().trim().min(1)

export const NicknameText = z
	.object({ name: leveled(text), story: leveled(text) })
	.strict()

export const WorldText = z
	.object({
		madeOf: leveled(text),
		air: leveled(text),
		weather: leveled(text),
		nicknames: z.record(z.string(), NicknameText),
		name: leveled(text),
		localName: leveled(text).optional(),
		discovery: leveled(text),
	})
	.strict()
export type WorldText = z.infer<typeof WorldText>

export const WorldTextFile = z
	.object({
		layers: z.record(z.string(), leveled(text)),
		gases: z.record(z.string(), leveled(text)),
		worlds: z.record(z.string(), WorldText),
	})
	.strict()
export type WorldTextFile = z.infer<typeof WorldTextFile>

const modules = import.meta.glob<WorldTextFile>("../../locales/*/worlds.json", {
	eager: true,
	import: "default",
})

/** The stories' words by locale (cast; worlds.test.ts validates every file). */
export const worldText: ReadonlyMap<Locale, WorldTextFile> = new Map(
	Object.entries(modules).map(([path, file]) => [
		path.replace(/^.*\/locales\//, "").replace(/\/worlds\.json$/, ""),
		file,
	]),
)

type Reader = Pick<I18n, "chain" | "readingLevel">

function lookup(
	i18n: Reader,
	read: (file: WorldTextFile) => unknown,
): string | undefined {
	for (const locale of i18n.chain) {
		const file = worldText.get(locale)
		if (file === undefined) continue
		const value = pickLevel<string>(
			read(file) as string | undefined,
			i18n.readingLevel,
		)
		if (value !== undefined) return value
	}
	return undefined
}

/** A layer's name ("Iron core"; "Metal middle" at the simple level). */
export const layerName = (id: string, i18n: Reader): string =>
	lookup(i18n, (file) => file.layers[id]) ?? id

/** A gas's name ("Carbon dioxide"). */
export const gasName = (id: string, i18n: Reader): string =>
	lookup(i18n, (file) => file.gases[id]) ?? id

type StoryField = Exclude<keyof WorldText, "nicknames" | "localName">

/** One of a world's stories in the active language and reading level ("" if none). */
export const worldStory = (
	world: string,
	field: StoryField,
	i18n: Reader,
): string => lookup(i18n, (file) => file.worlds[world]?.[field]) ?? ""

export interface NicknameStory {
	name: string
	story: string
}

/** A nickname and how it came about. */
export const nicknameStory = (
	world: string,
	nickname: string,
	i18n: Reader,
): NicknameStory => ({
	name:
		lookup(i18n, (file) => file.worlds[world]?.nicknames[nickname]?.name) ??
		nickname,
	story:
		lookup(i18n, (file) => file.worlds[world]?.nicknames[nickname]?.story) ??
		"",
})

/**
 * The story of the active language's own name for a world, or null: only the
 * active locale's file is read (never the fallback's), since "Erde" has its
 * story in German only.
 */
export function localNameStory(
	world: string,
	i18n: Pick<I18n, "locale" | "readingLevel">,
): string | null {
	const value = worldText.get(i18n.locale)?.worlds[world]?.localName
	return pickLevel<string>(value, i18n.readingLevel) ?? null
}
