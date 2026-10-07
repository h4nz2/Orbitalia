import type { FC } from "react"

import type { Degrees, World } from "@/data/worlds"
import { useI18n } from "@/i18n"

import { TEMPERATURE_ICON } from "../icons"
import { levelQuantity } from "../utils/quantity"
import { worldStory } from "../worldText"
import Sources from "./Sources"
import classes from "./Stories.module.css"

/** Ranges told from the outside in: the surface or the clouds before the core, the high air before the clouds. */
const OUTSIDE_FIRST: readonly World["temperature"]["range"][] = [
	"cloudsCore",
	"cloudLevels",
	"surfaceCore",
]

/** How hot a world gets: both ends of its range, then why. */
const Weather: FC<{ world: World }> = ({ world }) => {
	const i18n = useI18n()
	const { range, high, low } = world.temperature
	const icons = TEMPERATURE_ICON[range]
	const ends: { end: "high" | "low"; degrees: Degrees }[] = [
		{ end: "high", degrees: high },
		...(low ? [{ end: "low" as const, degrees: low }] : []),
	]
	if (OUTSIDE_FIRST.includes(range)) ends.reverse()

	return (
		<div className={classes.section}>
			<dl className={classes.rows}>
				{ends.map(({ end, degrees }) => {
					const Icon = icons[end]
					return (
						<div key={end} className={classes.row} data-end={end}>
							<Icon size={26} aria-hidden className={classes.rowIcon} />
							<dt>{i18n.t(`dictionary.weather.${end}`, { range })}</dt>
							<dd className={classes.value}>
								{levelQuantity({ kind: "temperature", degrees }, i18n)}
							</dd>
						</div>
					)
				})}
			</dl>
			<p>{worldStory(world.id, "weather", i18n)}</p>
			<Sources urls={world.temperature.sources} />
		</div>
	)
}

export default Weather
