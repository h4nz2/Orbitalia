/**
 * Editorial body content: translated names, taglines, descriptions, facts and
 * comparisons per body, at every reading level (docs/ARCHITECTURE.md, "Body content").
 *
 * Source: `src/locales/<locale>/bodies.json`, keyed by body id (src/data/bodies.json).
 * Physics stays in the body model; this is the human-written layer on top of it,
 * consumed by the dictionary and the HUD today and by labels (#20), comparison
 * (#24), tours (#28) and the scavenger hunt (#34) later.
 *
 * Any text field may be a plain value (the same at every reading level) or an
 * object keyed by reading level; the default level must be present, the others
 * fall back to it. Bodies without authored content (most moons) get a
 * generated fallback built from their data.
 */
import { useMemo } from "react"
import { z } from "zod"

import { bodyById, type Body } from "@/data"

import {
	DEFAULT_READING_LEVEL,
	READING_LEVELS,
	type Locale,
	type ReadingLevel,
} from "./catalog"
import { useI18n } from "./context"
import type { I18n } from "./core"
import { everydaySize } from "./quantities"

const levelIds = READING_LEVELS as readonly string[]

/** A value, or one value per reading level (the default level required). */
export const leveled = <T extends z.ZodType>(value: T) =>
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
				{
					message: `reading levels must be one of ${levelIds.join(", ")}`,
				},
			),
	])

const text = z.string().trim().min(1)
const texts = z.array(text).min(1)

/** One body's entry in a locale's bodies.json. */
export const BodyContent = z
	.object({
		/** Display name; omitted = the catalogue name from bodies.json (never translate provisional designations). */
		name: text.optional(),
		/** A few words for labels: "The red planet". */
		tagline: leveled(text).optional(),
		/** A short paragraph. */
		description: leveled(text).optional(),
		/** Standalone one-sentence facts, most important first. */
		facts: leveled(texts).optional(),
		/** Human-scale comparisons and analogies ("If Earth were a football…"). */
		comparisons: leveled(texts).optional(),
	})
	.strict()

/** A whole `bodies.json`: body id -> content. */
export const BodyContentFile = z.record(z.string(), BodyContent)

export type BodyContent = z.infer<typeof BodyContent>
export type BodyContentFile = z.infer<typeof BodyContentFile>

type Leveled<T> = T | Partial<Record<string, T>>

const modules = import.meta.glob<BodyContentFile>("../locales/*/bodies.json", {
	eager: true,
	import: "default",
})

/** Body content by locale (cast like bodies.json; the resource tests validate it). */
export const bodyContent: ReadonlyMap<Locale, BodyContentFile> = new Map(
	Object.entries(modules).map(([path, file]) => [
		path.replace(/^.*\/locales\//, "").replace(/\/bodies\.json$/, ""),
		file,
	]),
)

const isPlain = (value: unknown): boolean =>
	typeof value === "string" || Array.isArray(value)

/** The value for `level` (else the default level) of a plain-or-leveled field. */
export function pickLevel<T>(
	value: Leveled<T> | undefined,
	level: string,
): T | undefined {
	if (value === undefined || isPlain(value)) return value as T | undefined
	const byLevel = value as Partial<Record<string, T>>
	return byLevel[level] ?? byLevel[DEFAULT_READING_LEVEL]
}

type Field = Exclude<keyof BodyContent, "name">

/** A content field for `id`, walking the locale chain; the level wins within a locale. */
function contentField<K extends Field>(
	id: string,
	field: K,
	chain: readonly Locale[],
	level: string,
): (K extends "facts" | "comparisons" ? string[] : string) | undefined {
	for (const locale of chain) {
		const value = pickLevel(bodyContent.get(locale)?.[id]?.[field], level)
		if (value !== undefined) {
			return value as K extends "facts" | "comparisons" ? string[] : string
		}
	}
	return undefined
}

/**
 * The display name of a body in the locale chain: the translated name where one
 * exists (planets, major moons), else the catalogue name from bodies.json, which
 * is never translated (provisional designations like "S/2003 J 2").
 */
export function bodyName(id: string, chain: readonly Locale[]): string {
	for (const locale of chain) {
		const name = bodyContent.get(locale)?.[id]?.name
		if (name !== undefined) return name
	}
	return bodyById.get(id)?.name ?? id
}

export interface BodyText {
	id: string
	name: string
	/** Authored, else the kind ("Planet", "Moon of Jupiter"). */
	tagline: string
	/** Authored, else generated from the data for moons; "" when neither exists. */
	description: string
	facts: readonly string[]
	comparisons: readonly string[]
	/** Whether the description was written by a person for this body. */
	authored: boolean
}

/** "Star", "Planet", "Moon of Jupiter" in the active language. */
export function bodyKindLabel(body: Body, i18n: I18n): string {
	if (body.kind === "moon" && body.parentId !== null) {
		return i18n.t("bodies.kind.moonOf", {
			parentId: body.parentId,
			parent: bodyName(body.parentId, i18n.chain),
		})
	}
	return i18n.t(`bodies.kind.${body.kind}`)
}

const orbitDuration = (periodDays: number, i18n: I18n): string =>
	periodDays < 1
		? i18n.quantity(periodDays * 24, "hour", "long")
		: i18n.quantity(periodDays, "day", "long")

function fallbackDescription(body: Body, i18n: I18n): string {
	if (body.kind !== "moon" || body.parentId === null || body.orbit === null) {
		return ""
	}
	const name = bodyName(body.id, i18n.chain)
	return i18n.t("bodies.fallback.moonDescription", {
		name,
		parentId: body.parentId,
		parent: bodyName(body.parentId, i18n.chain),
		diameter: i18n.quantity(2 * body.radiusKm, "kilometer"),
		distance: i18n.quantity(body.orbit.semiMajorAxisKm, "kilometer"),
		period: orbitDuration(body.orbit.periodDays, i18n),
		// the simple level's picture of its size (#51)
		everyday:
			everydaySize(
				{ id: body.id, name, diameterKm: 2 * body.radiusKm },
				i18n,
			) ?? "",
	})
}

/** Everything written about a body, in the active language and reading level. */
export function getBodyText(id: string, i18n: I18n): BodyText {
	const { chain, readingLevel } = i18n
	const body = bodyById.get(id)
	const description = contentField(id, "description", chain, readingLevel)
	return {
		id,
		name: bodyName(id, chain),
		tagline:
			contentField(id, "tagline", chain, readingLevel) ??
			(body ? bodyKindLabel(body, i18n) : ""),
		description: description ?? (body ? fallbackDescription(body, i18n) : ""),
		facts: contentField(id, "facts", chain, readingLevel) ?? [],
		comparisons: contentField(id, "comparisons", chain, readingLevel) ?? [],
		authored: description !== undefined,
	}
}

/** `getBodyText` for the active language and reading level. */
export function useBodyText(id: string): BodyText {
	const i18n = useI18n()
	return useMemo(() => getBodyText(id, i18n), [id, i18n])
}

/** A name lookup bound to the active language: `const name = useBodyName(); name("earth")`. */
export function useBodyName(): (id: string) => string {
	const { chain } = useI18n()
	return useMemo(() => (id: string) => bodyName(id, chain), [chain])
}

/** The reading levels a leveled field is written for (for tests and tooling). */
export const levelsOf = (value: unknown): ReadingLevel[] =>
	value === undefined || isPlain(value)
		? []
		: (Object.keys(value as object) as ReadingLevel[])
