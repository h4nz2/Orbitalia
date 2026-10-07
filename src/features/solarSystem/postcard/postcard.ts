/**
 * What the postcard says (issue #33), pure and tested: whom the picture is of,
 * the date on screen, a caption, how honest the scale is, and the link back
 * to the view. Everything in the active language and reading level.
 */
import type { I18n, MessageKey } from "@/i18n"
import { getBodyText } from "@/i18n/bodies"
import { jdToDate, type ScalePresetId } from "@/sim"
import type { PostcardRow, PostcardSnapshot } from "@/store/postcard"
import type { SimState } from "@/store/sim"
import { roundJD } from "@/store/urlSync"

/** The body the picture is of: the selection, else the focused body; none for the overview or a free view. */
export const postcardSubject = (
	state: Pick<SimState, "selectedId" | "view">,
): string | null =>
	state.selectedId ?? (state.view.kind === "body" ? state.view.id : null)

/**
 * A link that opens the view in the picture: the page's own link (focus,
 * camera, layers, scale, language, which the URL sync keeps current) with the
 * moment on screen pinned. While a birth date is entered the time is left
 * out, as in every link (#26).
 */
export function postcardLink(
	href: string,
	jd: number,
	hideTime: boolean,
): string {
	const url = new URL(href)
	url.hash = ""
	url.searchParams.delete("birthday")
	if (hideTime) url.searchParams.delete("t")
	else url.searchParams.set("t", String(roundJD(jd)))
	return url.toString()
}

/** The one-line scale statement on the picture, so a copy passed around never pretends to be to scale. */
const SCALE_NOTE: Record<ScalePresetId, MessageKey> = {
	trueScale: "solarSystem.postcard.scaleNote.trueScale",
	textbook: "solarSystem.postcard.scaleNote.textbook",
	bigPlanets: "solarSystem.postcard.scaleNote.bigPlanets",
	everythingVisible: "solarSystem.postcard.scaleNote.everythingVisible",
	poster: "solarSystem.postcard.scaleNote.poster",
}

/** Everything written on the postcard. */
export interface PostcardText {
	title: string
	/** The simulation date (UTC), or none. */
	date: string | null
	/** The suggested caption (the visitor may change it). */
	caption: string
	scaleNote: string | null
	rows: readonly PostcardRow[]
	facts: readonly string[]
	note: string | null
	/** The app's name: where the picture came from. */
	footer: string
	/** Under the QR code. */
	scan: string
	fileName: string
}

/** "2026-09-25" for a JD (UTC), for file names. */
const isoDay = (jd: number): string => {
	const date = jdToDate(jd)
	return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10)
}

export function postcardText(
	snapshot: Omit<PostcardSnapshot, "shot">,
	i18n: I18n,
): PostcardText {
	const { subjectId, extra } = snapshot
	const body = subjectId === null ? null : getBodyText(subjectId, i18n)
	const simDate = snapshot.hideDate
		? null
		: i18n.dateTimeUTC(jdToDate(snapshot.jd))
	const day = snapshot.hideDate ? "" : isoDay(snapshot.jd)
	return {
		title:
			extra?.title ?? body?.name ?? i18n.t("solarSystem.postcard.overview"),
		date: extra?.date !== undefined ? extra.date : simDate,
		caption:
			extra?.caption ??
			body?.tagline ??
			i18n.t("solarSystem.postcard.overviewCaption"),
		scaleNote:
			extra?.scaleNote !== undefined
				? extra.scaleNote
				: snapshot.scalePreset === null
					? null
					: i18n.t(SCALE_NOTE[snapshot.scalePreset]),
		rows: extra?.rows ?? [],
		facts: extra?.facts ?? [],
		note: extra?.note ?? null,
		footer: i18n.t("app.title"),
		scan: i18n.t("solarSystem.postcard.scan"),
		fileName:
			extra?.fileName ??
			`orbitalia-${subjectId ?? "solar-system"}${day === "" ? "" : `-${day}`}.png`,
	}
}
