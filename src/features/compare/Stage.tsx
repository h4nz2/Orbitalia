/**
 * The bodies side by side at true relative size (#24): one scale for all
 * (`layoutStage`), centres on one line, in the order of the solar system.
 * Plain DOM, no WebGL: every globe is a disc painted with the body's own
 * texture and shaded to read as a sphere, its axis tilted as in space, rings
 * seen a little from above. A body too small to see at the common scale is
 * circled and said to be so, never enlarged. A click on a body outside the
 * pair makes it the second of the pair.
 */
import { useMemo, type CSSProperties } from "react"
import { useElementSize } from "@mantine/hooks"

import { getBody, type Body } from "@/data"
import { formatSize, isSimple, useI18n } from "@/i18n"
import { useBodyName } from "@/i18n/bodies"
import { assetUrl } from "@/utils/assetUrl"

import { MIN_DRAWN_PX, RING_OPENING, layoutStage, stageBody } from "./layout"
import { drawOrder } from "./selection"

import classes from "./Compare.module.css"

/** Room under the drawing for the names, px. */
const LABEL_SPACE = 52
/** A margin round the drawing, px (`.row` in the CSS), so no globe touches the frame. */
const PAD_X = 12
const PAD_TOP = 10
const GAP = 16

/**
 * Saturn's main rings, radii in km (Cassini's data): the faint C ring, the
 * bright B ring, the Cassini Division, the A ring. The other planets' rings
 * are dark and thin, drawn as a faint band.
 */
const SATURN_RINGS: readonly [number, string][] = [
	[74_500, "rgba(190, 172, 140, 0)"],
	[74_600, "rgba(190, 172, 140, 0.28)"],
	[92_000, "rgba(190, 172, 140, 0.35)"],
	[92_100, "rgba(226, 208, 170, 0.92)"],
	[117_500, "rgba(214, 196, 158, 0.85)"],
	[117_600, "rgba(40, 36, 30, 0.12)"],
	[122_100, "rgba(40, 36, 30, 0.12)"],
	[122_200, "rgba(204, 186, 150, 0.72)"],
	[136_700, "rgba(196, 178, 142, 0.6)"],
	[136_800, "rgba(196, 178, 142, 0)"],
]

/**
 * The rings as gradient stops: [fraction of the outer radius, colour]
 * (shared with the comparison's picture, ./picture.ts).
 */
export function ringStops(body: Body): [number, string][] {
	const rings = body.rings
	if (rings === null) return []
	if (body.id === "saturn") {
		return SATURN_RINGS.map(([km, color]) => [km / rings.outerRadiusKm, color])
	}
	const inner = rings.innerRadiusKm / rings.outerRadiusKm
	return [
		[inner, "rgba(200, 190, 170, 0)"],
		[inner, "rgba(200, 190, 170, 0.08)"],
		[0.995, "rgba(200, 190, 170, 0.08)"],
		[1, "rgba(200, 190, 170, 0)"],
	]
}

const ringGradient = (body: Body): string => {
	if (body.rings === null) return "none"
	const stops = ringStops(body).map(
		([at, color]) => `${color} ${(at * 100).toFixed(2)}%`,
	)
	return `radial-gradient(circle closest-side, ${stops.join(", ")})`
}

interface BodyDrawingProps {
	body: Body
	/** Globe radius and centre inside the slot, px. */
	r: number
	x: number
	y: number
	pxPerKm: number
}

/** One body: an anchor at its centre, turned by the axial tilt, holding the rings' far half, the globe and the near half. */
const BodyDrawing = ({ body, r, x, y, pxPerKm }: BodyDrawingProps) => {
	const drawn = Math.max(r, MIN_DRAWN_PX / 2)
	const globe: CSSProperties = {
		width: 2 * drawn,
		height: 2 * drawn,
		margin: -drawn,
		backgroundImage: `url("${assetUrl(body.textures.base)}")`,
	}
	if (body.kind === "star") {
		globe.boxShadow = `0 0 ${0.12 * drawn}px ${0.02 * drawn}px rgba(255, 150, 40, 0.55)`
	}
	const ring =
		body.rings === null
			? null
			: ({
					width: 2 * body.rings.outerRadiusKm * pxPerKm,
					height: 2 * body.rings.outerRadiusKm * pxPerKm,
					margin: -body.rings.outerRadiusKm * pxPerKm,
					backgroundImage: ringGradient(body),
					transform: `scaleY(${RING_OPENING})`,
				} satisfies CSSProperties)
	return (
		<span
			className={classes.anchor}
			style={{
				left: x,
				top: y,
				transform: `rotate(${body.rotation.axialTiltDeg}deg)`,
			}}
		>
			{ring && (
				<span className={`${classes.ring} ${classes.ringBack}`} style={ring} />
			)}
			<span
				className={classes.globe}
				data-kind={body.kind}
				style={globe}
				aria-hidden="true"
			/>
			{ring && (
				<span className={`${classes.ring} ${classes.ringFront}`} style={ring} />
			)}
		</span>
	)
}

export interface StageProps {
	/** The comparison's ids; [0] and [1] are the pair. */
	ids: readonly string[]
	/** A click on a body outside the pair. */
	onPick: (id: string) => void
}

const Stage = ({ ids, onPick }: StageProps) => {
	const i18n = useI18n()
	const { t } = i18n
	const name = useBodyName()
	const { ref, width, height } = useElementSize()
	const phone = width > 0 && width < 600
	const layout = useMemo(
		() =>
			layoutStage(
				drawOrder(ids).map((id) => stageBody(getBody(id))),
				{
					width: Math.max(0, width - 2 * PAD_X),
					height: Math.max(0, height - LABEL_SPACE - PAD_TOP),
					gap: phone ? 8 : GAP,
					minSlot: phone ? 64 : 88,
				},
			),
		[ids, width, height, phone],
	)
	const tiny = layout.items.filter((item) => item.tiny)
	const list = new Intl.ListFormat(i18n.formatLocale, { type: "conjunction" })
	const kmPerPixel = layout.pxPerKm > 0 ? 1 / layout.pxPerKm : 0

	return (
		<section
			className={classes.stageSection}
			aria-label={t("compare.stage.label", {
				names: list.format(drawOrder(ids).map(name)),
			})}
		>
			<div className={classes.stage} ref={ref} data-testid="compare-stage">
				{width > 0 && height > 0 && (
					<div
						className={classes.row}
						style={{ width: layout.width }}
						data-px-per-km={layout.pxPerKm}
					>
						{layout.items.map((item) => {
							const body = getBody(item.id)
							const role =
								item.id === ids[0]
									? "first"
									: item.id === ids[1]
										? "second"
										: "extra"
							const diameter = formatSize(
								Number((2 * body.radiusKm).toPrecision(3)),
								i18n,
							)
							const content = (
								<>
									<BodyDrawing
										body={body}
										r={item.r}
										x={item.width / 2}
										y={item.cy}
										pxPerKm={layout.pxPerKm}
									/>
									{item.tiny && (
										<span
											className={classes.tinyMark}
											style={{ left: item.width / 2, top: item.cy }}
											aria-hidden="true"
										/>
									)}
									<span className={classes.label} data-role={role}>
										<span className={classes.labelName}>{name(item.id)}</span>
										<span className={classes.labelSize}>
											{body.radiusEstimated && !isSimple(i18n)
												? t("units.approx", { value: diameter })
												: diameter}
										</span>
									</span>
								</>
							)
							const common = {
								className: classes.slot,
								style: { left: item.left, width: item.width },
								"data-body": item.id,
								"data-role": role,
								"data-radius-px": item.r,
								"data-tiny": item.tiny,
							}
							return role === "extra" ? (
								<button
									key={item.id}
									type="button"
									{...common}
									aria-label={t("compare.stage.pick", {
										nameId: item.id,
										name: name(item.id),
									})}
									onClick={() => onPick(item.id)}
								>
									{content}
								</button>
							) : (
								<div key={item.id} {...common}>
									{content}
								</div>
							)
						})}
					</div>
				)}
			</div>
			<p className={classes.caption}>
				<span data-testid="compare-scale">
					{t("compare.stage.scale", {
						km: i18n.quantity(Number(kmPerPixel.toPrecision(2)), "kilometer"),
					})}
				</span>
				{tiny.length > 0 && (
					<span data-testid="compare-tiny">
						{" "}
						{t("compare.stage.tiny", {
							count: tiny.length,
							names: list.format(tiny.map((item) => name(item.id))),
						})}
					</span>
				)}
			</p>
		</section>
	)
}

export default Stage
