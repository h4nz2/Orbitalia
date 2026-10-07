import { useId, type FC } from "react"

import type { World } from "@/data/worlds"
import { useI18n } from "@/i18n"

import { levelQuantity } from "../utils/quantity"
import { layerName } from "../worldText"
import classes from "./Stories.module.css"

/** The thinnest band drawn, as a fraction of the radius, so a 30 km crust still shows. */
export const MIN_BAND = 0.045

/**
 * The radii the picture draws, from the centre outwards: the real ones, except
 * that every layer keeps at least `MIN_BAND` (the thin ones push inwards).
 */
export function drawnRadii(layers: World["madeOf"]["layers"]): number[] {
	const radii = layers.map((layer) => layer.outer)
	for (let i = radii.length - 2; i >= 0; i--) {
		radii[i] = Math.min(radii[i]!, radii[i + 1]! - MIN_BAND)
	}
	return radii
}

/** Whether the picture draws some layer thicker than it is. */
export const thickened = (layers: World["madeOf"]["layers"]): boolean =>
	drawnRadii(layers).some((radius, i) => radius < layers[i]!.outer)

const R = 94

/** A quarter of a disc of radius `r`, from twelve to three o'clock. */
const wedge = (r: number) => `M0 0L0 ${-r}A${r} ${r} 0 0 1 ${r} 0Z`

export type CutAwayProps = {
	world: World
	/** The world's display name. */
	name: string
	/** Its mean radius, for the layers' thickness. */
	radiusKm: number
}

/**
 * A cut-away picture drawn from the layer data (radii and colours from
 * `src/data/worlds.json`), with its layers named beside it.
 */
const CutAway: FC<CutAwayProps> = ({ world, name, radiusKm }) => {
	const i18n = useI18n()
	const uid = useId()
	const { layers, surface } = world.madeOf
	const radii = drawnRadii(layers)
	const names = layers.map((layer) => layerName(layer.id, i18n))
	const list = new Intl.ListFormat(i18n.formatLocale, {
		type: "conjunction",
	}).format(names)

	return (
		<figure className={classes.cutAway}>
			<svg
				viewBox="-100 -100 200 200"
				className={classes.picture}
				role="img"
				aria-labelledby={`${uid}t ${uid}d`}
			>
				<title id={`${uid}t`}>
					{i18n.t("dictionary.madeOf.pictureTitle", { name })}
				</title>
				<desc id={`${uid}d`}>
					{i18n.t("dictionary.madeOf.pictureDescription", {
						name,
						layers: list,
					})}
				</desc>
				<defs>
					<radialGradient id={`${uid}s`} cx="35%" cy="30%" r="75%">
						<stop offset="0" stopColor="#fff" stopOpacity="0.3" />
						<stop offset="0.55" stopColor="#fff" stopOpacity="0" />
						<stop offset="1" stopColor="#000" stopOpacity="0.5" />
					</radialGradient>
				</defs>
				<circle r={R} fill={surface} />
				<circle r={R} fill={`url(#${uid}s)`} />
				{layers
					.map((layer, i) => (
						<path
							key={layer.id}
							d={wedge(radii[i]! * R)}
							fill={layer.color}
							stroke="rgba(0, 0, 0, 0.35)"
							strokeWidth={0.6}
							data-layer={layer.id}
						/>
					))
					.reverse()}
				{/* the cut's two faces meet at the centre: a shadow line gives them depth */}
				<path
					d={`M0 ${-R}L0 0L${R} 0`}
					fill="none"
					stroke="rgba(0, 0, 0, 0.45)"
					strokeWidth={1.2}
				/>
			</svg>
			<ul className={classes.legend}>
				{layers.map((layer, i) => {
					const inner = i === 0 ? 0 : layers[i - 1]!.outer
					const size = levelQuantity(
						{ kind: "length", km: (layer.outer - inner) * radiusKm },
						i18n,
					)
					return (
						<li key={layer.id}>
							<span
								className={classes.swatch}
								style={{ background: layer.color }}
								aria-hidden
							/>
							<span>
								{names[i]}
								{size === null ? null : (
									<span className={classes.muted}>
										{" "}
										{i18n.t("dictionary.madeOf.layerSize", {
											centre: i === 0 ? "yes" : "no",
											size,
										})}
									</span>
								)}
							</span>
						</li>
					)
				})}
			</ul>
		</figure>
	)
}

export default CutAway
