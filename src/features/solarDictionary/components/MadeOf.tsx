import type { FC } from "react"
import { IconBath, IconBucket, IconWeight } from "@tabler/icons-react"

import { bodyById } from "@/data"
import type { World } from "@/data/worlds"
import { useI18n } from "@/i18n"

import { densityOf } from "../utils/heft"
import { levelQuantity } from "../utils/quantity"
import { gasName, worldStory } from "../worldText"
import CutAway, { thickened } from "./CutAway"
import Sources from "./Sources"
import classes from "./Stories.module.css"

export type MadeOfProps = { world: World; name: string }

/** What a world is made of: the cut-away picture, its air, how heavy it is. */
const MadeOf: FC<MadeOfProps> = ({ world, name }) => {
	const i18n = useI18n()
	const { t, readingLevel } = i18n
	const body = bodyById.get(world.id)
	const earth = bodyById.get("earth")
	const star = body?.kind === "star" ? "yes" : "no"
	const density = body ? densityOf(body) : null

	return (
		<div className={classes.section}>
			{body ? (
				<CutAway world={world} name={name} radiusKm={body.radiusKm} />
			) : null}
			<p>{worldStory(world.id, "madeOf", i18n)}</p>
			<p className={classes.note}>
				{t("dictionary.madeOf.scaleNote", {
					thickened: thickened(world.madeOf.layers) ? "yes" : "no",
				})}
				{world.madeOf.estimated ? (
					<> {t("dictionary.madeOf.estimateNote")}</>
				) : null}
			</p>

			<h3 className={classes.heading}>
				{t("dictionary.madeOf.air", { star })}
			</h3>
			<p>{worldStory(world.id, "air", i18n)}</p>
			{readingLevel === "simple" ? null : (
				<>
					<ul className={classes.gases}>
						{world.air.gases.map((gas) => (
							<li key={gas.id}>
								{gas.percent === undefined
									? gasName(gas.id, i18n)
									: t("dictionary.madeOf.gas", {
											name: gasName(gas.id, i18n),
											share: gas.percent / 100,
										})}
							</li>
						))}
					</ul>
					{world.air.basis ? (
						<p className={classes.note}>
							{t("dictionary.madeOf.basis", { basis: world.air.basis })}
						</p>
					) : null}
				</>
			)}

			{body?.massKg && earth?.massKg ? (
				<dl className={classes.rows}>
					<div className={classes.row}>
						<IconWeight size={22} aria-hidden className={classes.rowIcon} />
						<dt>{t("dictionary.madeOf.heavy")}</dt>
						<dd>
							{levelQuantity(
								{
									kind: "mass",
									kg: body.massKg,
									earthKg: earth.massKg,
									star: star === "yes",
								},
								i18n,
							)}
						</dd>
					</div>
					{density === null ? null : (
						<div className={classes.row}>
							{density < 1 ? (
								<IconBath size={22} aria-hidden className={classes.rowIcon} />
							) : (
								<IconBucket size={22} aria-hidden className={classes.rowIcon} />
							)}
							<dt>{t("dictionary.madeOf.dense")}</dt>
							<dd>
								{levelQuantity({ kind: "density", gramsPerCm3: density }, i18n)}
							</dd>
						</div>
					)}
				</dl>
			) : null}

			<Sources
				urls={[
					...world.madeOf.sources,
					...world.air.sources,
					...world.heft.sources,
				]}
			/>
		</div>
	)
}

export default MadeOf
