/**
 * The end of a hunt (#52): a certificate to save or print, which is the
 * postcard of the view (#33) stamped with the hunt and the worlds found.
 * Pure: the words in the active language, today's date.
 */
import type { I18n } from "@/i18n"
import type { PostcardExtra } from "@/store/postcard"

import { worldColor } from "../birthday/card"
import type { ResolvedHunt } from "./hunts"
import { huntTitle } from "./text"

export function certificate(
	hunt: Pick<ResolvedHunt, "id" | "questions">,
	found: readonly string[],
	i18n: Pick<I18n, "t" | "formatLocale" | "chain" | "readingLevel">,
	name: (id: string) => string,
	now = new Date(),
): PostcardExtra {
	const title =
		hunt.id === null
			? i18n.t("solarSystem.hunt.custom.name")
			: huntTitle(hunt.id, i18n).title
	const day = now.toISOString().slice(0, 10)
	return {
		title: i18n.t("solarSystem.hunt.certificate.title"),
		caption: i18n.t("solarSystem.hunt.certificate.caption", {
			hunt: title,
			count: hunt.questions.length,
		}),
		date: new Intl.DateTimeFormat(i18n.formatLocale, {
			dateStyle: "long",
		}).format(now),
		rows: found.map((id, index) => ({
			id: `${index}-${id}`,
			label: i18n.t("solarSystem.hunt.certificate.row", { n: index + 1 }),
			value: name(id),
			color: worldColor(id),
		})),
		note: i18n.t("solarSystem.hunt.certificate.note"),
		fileName: `${i18n.t("solarSystem.hunt.certificate.fileName")}-${day}.png`,
	}
}
