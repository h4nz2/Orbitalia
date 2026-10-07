import type { FC } from "react"

import { useI18n } from "@/i18n"

import classes from "./Stories.module.css"

/** "science.nasa.gov" for a link's text. */
const hostOf = (url: string): string =>
	new URL(url).hostname.replace(/^www\./, "")

/** The public sources of a section's facts (#53), one link per page. */
const Sources: FC<{ urls: readonly string[] }> = ({ urls }) => {
	const { t } = useI18n()
	const unique = [...new Set(urls)]
	const seen = new Map<string, number>()
	return (
		<p className={classes.sources}>
			{t("dictionary.sources")}{" "}
			{unique.map((url, i) => {
				const host = hostOf(url)
				const n = (seen.get(host) ?? 0) + 1
				seen.set(host, n)
				const repeated = unique.filter((u) => hostOf(u) === host).length > 1
				return (
					<span key={url}>
						{i > 0 ? " · " : null}
						<a href={url} target="_blank" rel="noreferrer">
							{repeated ? `${host} (${n})` : host}
						</a>
					</span>
				)
			})}
		</p>
	)
}

export default Sources
