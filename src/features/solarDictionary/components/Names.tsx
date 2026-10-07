import type { FC } from "react"

import type { World } from "@/data/worlds"
import { useI18n } from "@/i18n"

import { DISCOVERY_ICON, NICKNAME_ICON } from "../icons"
import { localNameStory, nicknameStory, worldStory } from "../worldText"
import Sources from "./Sources"
import classes from "./Stories.module.css"

/** A world's nicknames and how they came about, where its name comes from, how it was found. */
const Names: FC<{ world: World }> = ({ world }) => {
	const i18n = useI18n()
	const { t } = i18n
	const local = localNameStory(world.id, i18n)
	const Found = DISCOVERY_ICON[world.discovery.kind]

	return (
		<div className={classes.section}>
			<ul className={classes.nicknames}>
				{world.nicknames.map((nickname) => {
					const Icon = NICKNAME_ICON[nickname.icon]
					const { name, story } = nicknameStory(world.id, nickname.id, i18n)
					return (
						<li key={nickname.id} className={classes.nickname}>
							<Icon size={30} aria-hidden className={classes.bigIcon} />
							<div>
								<p className={classes.nicknameName}>{name}</p>
								<p>{story}</p>
							</div>
						</li>
					)
				})}
			</ul>

			<h3 className={classes.heading}>{t("dictionary.names.origin")}</h3>
			<p>{worldStory(world.id, "name", i18n)}</p>
			{local === null ? null : (
				<>
					<h3 className={classes.heading}>
						{t("dictionary.names.inOurLanguage")}
					</h3>
					<p>{local}</p>
				</>
			)}

			<h3 className={classes.heading}>{t("dictionary.names.discovery")}</h3>
			<div className={classes.nickname}>
				<Found size={30} aria-hidden className={classes.bigIcon} />
				<p>{worldStory(world.id, "discovery", i18n)}</p>
			</div>

			<Sources
				urls={[
					...world.nicknames.flatMap((nickname) => nickname.sources),
					...world.name.sources,
					...(local === null ? [] : (world.localNames?.[i18n.locale] ?? [])),
					...world.discovery.sources,
				]}
			/>
		</div>
	)
}

export default Names
