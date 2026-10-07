import { useI18n } from "@/i18n"
import { useBodyName } from "@/i18n/bodies"

import { formatLength, roundCount } from "./lengths"
import {
	landmarkCount,
	type LandmarkId,
	type ModelBody,
	type SolarWalk,
} from "./walk"
import { ratioText } from "./walkText"

import classes from "./SolarWalk.module.css"

/** Model bodies up to this size get a circle printed at their model size (bigger ones would not fit a row). */
const MAX_PRINTED_CIRCLE_MM = 30
/** A speck below this still prints as a dot. */
const MIN_PRINTED_CIRCLE_MM = 0.3

export type WalkTableProps = {
	walk: SolarWalk
	landmark: LandmarkId | null
	/** The body a link opened the walk on (#48): its row is marked. */
	focus?: string | null
}

/**
 * The walk as one table: to project in class, and the printed hand-out a class
 * takes outside (a tick column for each stop reached). Small bodies carry a
 * circle drawn at their model size, which is exact on paper (CSS millimetres).
 */
const WalkTable = ({ walk, landmark, focus = null }: WalkTableProps) => {
	const i18n = useI18n()
	const { t, formatLocale, number } = i18n
	const name = useBodyName()
	const length = (metres: number) => formatLength(metres, formatLocale)
	// below a tenth of a landmark the cell stays empty, as in the walk
	const count = (metres: number) => {
		if (landmark === null) return null
		const n = roundCount(landmarkCount(metres, landmark))
		return n === 0 ? null : number(n)
	}

	const sizeCell = (body: ModelBody) => {
		const mm = body.sizeM * 1000
		return (
			<td className={classes.sizeCell}>
				{length(body.sizeM)}
				{mm <= MAX_PRINTED_CIRCLE_MM && (
					// SVG, not a CSS background: browsers print fills but drop backgrounds by default
					<svg
						className={classes.modelCircle}
						width={`${Math.max(mm, MIN_PRINTED_CIRCLE_MM)}mm`}
						height={`${Math.max(mm, MIN_PRINTED_CIRCLE_MM)}mm`}
						viewBox="0 0 2 2"
						aria-hidden
					>
						<circle cx="1" cy="1" r="1" />
					</svg>
				)}
			</td>
		)
	}
	const focused = (bodyId: string) => (bodyId === focus ? true : undefined)
	const tick = (
		<td className={classes.tick}>
			<span className={classes.box} aria-hidden />
		</td>
	)

	return (
		<table className={classes.table}>
			<caption className={classes.caption}>
				{t("solarWalk.tableCaption", {
					object: t(`solarWalk.sunObject.${walk.sunObject}`),
					ratio: ratioText(walk, i18n),
				})}
			</caption>
			<thead>
				<tr>
					<th scope="col">{t("solarWalk.column.stop")}</th>
					<th scope="col">{t("solarWalk.column.body")}</th>
					<th scope="col">{t("solarWalk.column.size")}</th>
					<th scope="col">{t("solarWalk.column.thing")}</th>
					<th scope="col">{t("solarWalk.column.distance")}</th>
					<th scope="col">{t("solarWalk.column.leg")}</th>
					{landmark !== null && (
						<th scope="col">{t(`solarWalk.landmarkColumn.${landmark}`)}</th>
					)}
					<th scope="col">{t("solarWalk.column.done")}</th>
				</tr>
			</thead>
			<tbody>
				<tr data-row="sun" data-focused={focused("sun")}>
					<td>{t("solarWalk.start")}</td>
					<th scope="row">{name("sun")}</th>
					<td>{length(walk.sun.sizeM)}</td>
					<td>{t(`solarWalk.sunObject.${walk.sunObject}`)}</td>
					<td>{i18n.quantity(0, "meter")}</td>
					<td />
					{landmark !== null && <td />}
					{tick}
				</tr>
				{walk.stops.map((stop, index) => [
					<tr key={stop.id} data-row={stop.id} data-focused={focused(stop.id)}>
						<td>{index + 1}</td>
						<th scope="row">{name(stop.id)}</th>
						{sizeCell(stop)}
						<td>{t(`solarWalk.thing.${stop.thing}`)}</td>
						<td className={classes.num}>{length(stop.distanceM)}</td>
						<td className={classes.num}>{length(stop.legM)}</td>
						{landmark !== null && (
							<td className={classes.num}>{count(stop.distanceM)}</td>
						)}
						{tick}
					</tr>,
					...stop.moons.map((moon) => (
						<tr
							key={moon.id}
							data-row={moon.id}
							data-focused={focused(moon.id)}
							className={classes.moonRow}
						>
							<td />
							<th scope="row">{name(moon.id)}</th>
							{sizeCell(moon)}
							<td>{t(`solarWalk.thing.${moon.thing}`)}</td>
							<td colSpan={2}>
								{t("solarWalk.moonDistance", {
									distance: length(moon.distanceM),
								})}
							</td>
							{landmark !== null && <td />}
							<td />
						</tr>
					)),
				])}
				<tr data-row="nearestStar" className={classes.starRow}>
					<td />
					<th scope="row">{t("solarWalk.starName")}</th>
					{sizeCell(walk.nearestStar)}
					<td>{t(`solarWalk.thing.${walk.nearestStar.thing}`)}</td>
					<td className={classes.num}>{length(walk.nearestStar.distanceM)}</td>
					<td />
					{landmark !== null && <td />}
					<td />
				</tr>
			</tbody>
		</table>
	)
}

export default WalkTable
