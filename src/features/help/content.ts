/**
 * The help page's content (#43): which features exist and where their "try it"
 * links go (`src/data/help.json`), and their words in every locale and reading
 * level (`src/locales/<locale>/help.json`, like the hunts' words).
 *
 * ```
 * groups.<groupId>         { title, intro }
 * entries.<entryId>        { title, what, why, how[] }
 * controls.<controlId>     { action, mouse?, touch?, keys? }
 * creditSections.<section> { title, intro }
 * creditNames.<creditId>   a credit's name, where it is a description (not a proper name)
 * credits.<creditId>       what the source gave the app
 * licences.<licenceId>     the licence's name
 * ```
 *
 * Every text field is one value for all reading levels or one per level (the
 * default level required), plain text, not ICU. Lookup walks the locale chain
 * (de -> en); within a locale the reading level wins, else the default level.
 * `help.test.ts` is the contract: every entry has its words at the simple and
 * standard level in every locale, and every "try it" link opens a real view.
 *
 * Kept free of the body data (`@/i18n/bodies`, `@/data`), so the help page's
 * chunk stays light.
 */
import { z } from "zod"

import {
	DEFAULT_READING_LEVEL,
	READING_LEVELS,
	type I18n,
	type Locale,
	type ReadingLevel,
} from "@/i18n"
import imageCreditData from "@/data/credits.json"
import helpData from "@/data/help.json"

const levelIds = READING_LEVELS as readonly string[]

/** A value, or one value per reading level (the default level required). */
const leveled = <T extends z.ZodType>(value: T) =>
	z.union([
		value,
		z
			.record(z.string(), value)
			.refine((byLevel) => DEFAULT_READING_LEVEL in byLevel, {
				message: `a per-level value needs the default level "${DEFAULT_READING_LEVEL}"`,
			})
			.refine(
				(byLevel) =>
					Object.keys(byLevel).every((level) => levelIds.includes(level)),
				{ message: `reading levels must be one of ${levelIds.join(", ")}` },
			),
	])

const text = z.string().trim().min(1)

// ---------------------------------------------------------------- structure

export const HELP_GROUP_IDS = [
	"lookingAround",
	"time",
	"sizeDistance",
	"light",
	"comparing",
	"teachers",
	"games",
	"community",
] as const
export type HelpGroupId = (typeof HELP_GROUP_IDS)[number]

/** The groups whose simple level may fall back to the standard text (#43: the teacher section). */
export const STANDARD_ONLY_GROUPS: readonly HelpGroupId[] = ["teachers"]

export const CREDIT_SECTIONS = [
	"data",
	"maps",
	"sounds",
	"software",
	"app",
] as const
export type CreditSection = (typeof CREDIT_SECTIONS)[number]

const id = z.string().regex(/^[a-z][a-zA-Z0-9]*$/)

export const HelpFile = z
	.object({
		$comment: z.string().optional(),
		/** The groups in page order. */
		groups: z.array(z.enum(HELP_GROUP_IDS)),
		/** The entries in page order within their group. */
		entries: z.array(
			z
				.object({
					id,
					group: z.enum(HELP_GROUP_IDS),
					/** An app path with its search params, e.g. `/solar_system?focus=saturn` (never `lang` or `reading`). */
					try: z.string().startsWith("/"),
				})
				.strict(),
		),
		/** The rows of the controls table, in order. */
		controls: z.array(id),
		credits: z.array(
			z
				.object({
					id,
					section: z.enum(CREDIT_SECTIONS),
					/** The source's own name, never translated; absent: `creditNames.<id>` in the locale (a description, not a name). */
					name: text.optional(),
					url: z.url().optional(),
					licence: id,
				})
				.strict(),
		),
	})
	.strict()
export type HelpFile = z.infer<typeof HelpFile>
export type HelpEntry = HelpFile["entries"][number]
export type HelpCredit = HelpFile["credits"][number]

/** The structure (cast; help.test.ts validates it). */
export const helpFile = helpData as HelpFile
export const HELP_ENTRIES: readonly HelpEntry[] = helpFile.entries
export const HELP_CONTROLS: readonly string[] = helpFile.controls
export const HELP_CREDITS: readonly HelpCredit[] = helpFile.credits
export const helpEntryById: ReadonlyMap<string, HelpEntry> = new Map(
	HELP_ENTRIES.map((entry) => [entry.id, entry]),
)

// ---------------------------------------------------------------- words

export const HelpTextFile = z
	.object({
		groups: z.record(
			z.string(),
			z.object({ title: leveled(text), intro: leveled(text) }).strict(),
		),
		entries: z.record(
			z.string(),
			z
				.object({
					/** A few words, the feature's name. */
					title: leveled(text),
					/** What it is, one sentence. */
					what: leveled(text),
					/** Why it is worth using, one sentence: ideally the lesson it teaches. */
					why: leveled(text),
					/** How to use it: the steps, the gesture or the key. */
					how: leveled(z.array(text).min(1)),
				})
				.strict(),
		),
		controls: z.record(
			z.string(),
			z
				.object({
					action: leveled(text),
					mouse: leveled(text).optional(),
					touch: leveled(text).optional(),
					keys: leveled(text).optional(),
				})
				.strict(),
		),
		creditSections: z.record(
			z.string(),
			z.object({ title: text, intro: text }).strict(),
		),
		/** Names of credits that are descriptions rather than proper names (no `name` in help.json). */
		creditNames: z.record(z.string(), text),
		credits: z.record(z.string(), text),
		licences: z.record(z.string(), text),
	})
	.strict()
export type HelpTextFile = z.infer<typeof HelpTextFile>

const modules = import.meta.glob<HelpTextFile>("../../locales/*/help.json", {
	eager: true,
	import: "default",
})

/** The help page's words by locale (cast; help.test.ts validates every file). */
export const helpText: ReadonlyMap<Locale, HelpTextFile> = new Map(
	Object.entries(modules).map(([path, file]) => [
		path.replace(/^.*\/locales\//, "").replace(/\/help\.json$/, ""),
		file,
	]),
)

type Leveled<T> = T | Partial<Record<string, T>>

/** The value for `level`, else the default level's; undefined when absent. */
export function pickLevel<T>(
	value: Leveled<T> | undefined,
	level: ReadingLevel,
): T | undefined {
	if (value === undefined) return undefined
	if (typeof value === "string" || Array.isArray(value)) return value as T
	const byLevel = value as Partial<Record<string, T>>
	return byLevel[level] ?? byLevel[DEFAULT_READING_LEVEL]
}

type Reader = Pick<I18n, "chain" | "readingLevel">

function lookup<T>(
	i18n: Reader,
	read: (file: HelpTextFile) => Leveled<T> | undefined,
): T | undefined {
	for (const locale of i18n.chain) {
		const file = helpText.get(locale)
		if (file === undefined) continue
		const value = pickLevel<T>(read(file), i18n.readingLevel)
		if (value !== undefined) return value
	}
	return undefined
}

export interface EntryText {
	title: string
	what: string
	why: string
	how: readonly string[]
}

/** An entry's words in the active language and reading level. */
export const entryText = (entryId: string, i18n: Reader): EntryText => ({
	title:
		lookup<string>(i18n, (file) => file.entries[entryId]?.title) ?? entryId,
	what: lookup<string>(i18n, (file) => file.entries[entryId]?.what) ?? "",
	why: lookup<string>(i18n, (file) => file.entries[entryId]?.why) ?? "",
	how: lookup<string[]>(i18n, (file) => file.entries[entryId]?.how) ?? [],
})

export const groupText = (
	groupId: string,
	i18n: Reader,
): { title: string; intro: string } => ({
	title: lookup<string>(i18n, (file) => file.groups[groupId]?.title) ?? groupId,
	intro: lookup<string>(i18n, (file) => file.groups[groupId]?.intro) ?? "",
})

export interface ControlText {
	action: string
	mouse?: string
	touch?: string
	keys?: string
}

export const controlText = (controlId: string, i18n: Reader): ControlText => ({
	action:
		lookup<string>(i18n, (file) => file.controls[controlId]?.action) ??
		controlId,
	mouse: lookup<string>(i18n, (file) => file.controls[controlId]?.mouse),
	touch: lookup<string>(i18n, (file) => file.controls[controlId]?.touch),
	keys: lookup<string>(i18n, (file) => file.controls[controlId]?.keys),
})

export const creditSectionText = (
	section: CreditSection,
	i18n: Reader,
): { title: string; intro: string } => ({
	title:
		lookup<string>(i18n, (file) => file.creditSections[section]?.title) ??
		section,
	intro:
		lookup<string>(i18n, (file) => file.creditSections[section]?.intro) ?? "",
})

/** A credit's name: its own (data), else the locale's description of it. */
export const creditName = (credit: HelpCredit, i18n: Reader): string =>
	credit.name ??
	lookup<string>(i18n, (file) => file.creditNames[credit.id]) ??
	credit.id

/**
 * The image sources of #37 (`src/data/credits.json`, written by `pnpm build:data`):
 * every moon map with its credit and licence, listed under "Surface maps". Read
 * as JSON, not through `@/data`, so the help page does not load the body data.
 */
interface ImageCreditLike {
	id: string
	kind: string
	title: string
	credit: string
	url: string
	licence: string
}
export const IMAGE_CREDITS: readonly ImageCreditLike[] =
	imageCreditData as ImageCreditLike[]

/** credits.json licence names -> `licences.<id>` in the help locales (a new licence needs a line here). */
export const IMAGE_LICENCE_IDS: Readonly<Record<string, string>> = {
	"Public domain": "publicDomainPlain",
	"No known restrictions": "noKnownRestrictions",
	MIT: "mit",
}

export interface CreditRow {
	id: string
	name: string
	url?: string
	what: string
	licence: string
}

/** Everything credited in a section, in order: the help page's own credits, then (maps) every image source. */
export function creditRows(section: CreditSection, i18n: Reader): CreditRow[] {
	const own = HELP_CREDITS.filter((credit) => credit.section === section).map(
		(credit) => ({
			id: credit.id,
			name: creditName(credit, i18n),
			url: credit.url,
			what: creditText(credit.id, i18n),
			licence: licenceText(credit.licence, i18n),
		}),
	)
	if (section !== "maps") return own
	return [
		...own,
		...IMAGE_CREDITS.map((credit) => ({
			id: `image-${credit.id}`,
			name: credit.title,
			url: credit.url,
			what: credit.credit,
			licence:
				IMAGE_LICENCE_IDS[credit.licence] === undefined
					? credit.licence
					: licenceText(IMAGE_LICENCE_IDS[credit.licence], i18n),
		})),
	]
}

export const creditText = (creditId: string, i18n: Reader): string =>
	lookup<string>(i18n, (file) => file.credits[creditId]) ?? ""

export const licenceText = (licenceId: string, i18n: Reader): string =>
	lookup<string>(i18n, (file) => file.licences[licenceId]) ?? licenceId

// ---------------------------------------------------------------- search

/** Lower case, without accents, so "eclipse" finds "Éclipse" and "zeme" finds "Země". */
export const foldText = (value: string): string =>
	value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase()

/** The words of a query, folded; empty for a blank query. */
export const queryWords = (query: string): string[] =>
	foldText(query).split(/\s+/).filter(Boolean)

/** True when every word of the query occurs somewhere in the texts (any order). */
export const matchesQuery = (
	texts: readonly (string | undefined)[],
	words: readonly string[],
): boolean => {
	if (words.length === 0) return true
	const haystack = foldText(texts.filter(Boolean).join(" \n "))
	return words.every((word) => haystack.includes(word))
}

/** The entries matching a query, in page order: every word in its title, what, why or how. */
export function searchEntries(
	query: string,
	i18n: Reader,
	entries: readonly HelpEntry[] = HELP_ENTRIES,
): HelpEntry[] {
	const words = queryWords(query)
	return entries.filter((entry) => {
		const { title, what, why, how } = entryText(entry.id, i18n)
		const group = groupText(entry.group, i18n).title
		return matchesQuery([title, what, why, group, ...how], words)
	})
}
