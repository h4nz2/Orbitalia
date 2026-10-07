/**
 * The honesty statement of the scale panel (#21): which scale is active and
 * how far from true it is, as sentences about one concrete body ("Earth is
 * drawn 10x too big", "... 13x too close to the Sun"). Pure, so the numbers
 * and the wording can be tested in every locale and reading level.
 *
 * The subject is the body the user is looking at (the selection, else the
 * focus); in the overview, and for the Sun, which is always drawn true, it
 * is Earth: the body every child can relate to.
 */
import { bodyById, sun, type Body } from "@/data"
import {
	formatCount,
	type I18n,
	type MessageKey,
	type MessageValues,
} from "@/i18n"
import { bodyDistortion, type BodyDistortion, type ScaleSettings } from "@/sim"

/** The body the statement talks about when nothing else is in view. */
export const DEFAULT_SUBJECT_ID = "earth"

/** A factor within this share of 1 reads as "true" (rounding would show "1x too big"). */
export const TRUE_TOLERANCE = 0.05

/** A message and its arguments, ready for `t`. */
export interface Sentence {
	key: MessageKey
	values: MessageValues
}

/** The statement's body: the selection, else the focus, else Earth; never the (always true) Sun. */
export function statementSubject(
	selectedId: string | null,
	focusId: string | null,
): Body {
	for (const id of [selectedId, focusId]) {
		if (id === null) continue
		const body = bodyById.get(id)
		if (body !== undefined && body.parentId !== null) return body
	}
	return bodyById.get(DEFAULT_SUBJECT_ID) ?? sun
}

/**
 * A factor as people say it: two significant digits, whole numbers from 10 up
 * ("10x", "67x", "3.2x", "1.4x").
 */
export function roundFactor(factor: number): number {
	if (!Number.isFinite(factor) || factor <= 0) return 1
	if (factor >= 10) return Math.round(factor)
	return Math.round(factor * 10) / 10
}

const isTrue = (factor: number): boolean =>
	Math.abs(factor - 1) <= TRUE_TOLERANCE

/** How far from true `body` is drawn under `scale`. */
export function distortionOf(body: Body, scale: ScaleSettings): BodyDistortion {
	const parent =
		body.parentId === null ? null : (bodyById.get(body.parentId) ?? null)
	return bodyDistortion(body, parent, sun.radiusKm, scale)
}

/**
 * The two sentences of the statement: the size lie and the distance lie
 * (null for a body without a parent), each "true" or by how much it lies.
 *
 * @param name the body name in the active language (`useBodyName()`)
 * @param i18n the active language: `{n}` is the factor as the reading level
 *             shows it ("more than 100" at the simple level, #51)
 */
export function scaleSentences(
	body: Body,
	scale: ScaleSettings,
	name: (id: string) => string,
	i18n: I18n,
): { size: Sentence; distance: Sentence | null } {
	const factor = (value: number) => {
		const rounded = roundFactor(value)
		return { factor: rounded, n: formatCount(rounded, i18n) }
	}
	const distortion = distortionOf(body, scale)
	const subject = { subjectId: body.id, subject: name(body.id) }
	const size: Sentence = isTrue(distortion.size)
		? { key: "solarSystem.scale.sizeTrue", values: subject }
		: {
				key: "solarSystem.scale.sizeBigger",
				values: { ...subject, ...factor(distortion.size) },
			}
	if (body.parentId === null) return { size, distance: null }
	const parent = { parentId: body.parentId, parent: name(body.parentId) }
	const d = distortion.distance
	const distance: Sentence = isTrue(d)
		? {
				key: "solarSystem.scale.distanceTrue",
				values: { ...subject, ...parent },
			}
		: d < 1
			? {
					key: "solarSystem.scale.distanceCloser",
					values: { ...subject, ...parent, ...factor(1 / d) },
				}
			: {
					key: "solarSystem.scale.distanceFarther",
					values: { ...subject, ...parent, ...factor(d) },
				}
	return { size, distance }
}
