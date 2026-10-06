/**
 * The comparison as a postcard (#24, #33). The stage on screen is DOM, so the
 * picture is drawn again with the Canvas 2D API from the same pure layout
 * (`layoutStage`) at a clean 1920 x 1080: every globe at one scale with its
 * texture, shade, tilt and rings, tiny bodies circled. The names and sizes
 * become the postcard's labels, so its "names" switch works here too. All
 * on the device; the textures come from the app itself.
 */
import { getBody, type Body } from "@/data"
import type { I18n } from "@/i18n"
import { dateToJD } from "@/sim"
import { hidesTimeInUrl, useBirthdayStore } from "@/store/birthday"
import {
	usePostcardStore,
	type SceneShot,
	type ShotLabel,
} from "@/store/postcard"
import { assetUrl } from "@/utils/assetUrl"

import { POSTCARD_FONT } from "../solarSystem/postcard/draw"
import { postcardLink } from "../solarSystem/postcard/postcard"
import { pairFacts } from "./compareFacts"
import {
	MARK_BELOW_PX,
	MIN_DRAWN_PX,
	RING_OPENING,
	layoutStage,
	stageBody,
} from "./layout"
import { drawOrder, presetFor } from "./selection"
import { ringStops } from "./Stage"

export const PICTURE_WIDTH = 1920
export const PICTURE_HEIGHT = 1080
const PAD = 56
/** Room under the globes for a name and a size. */
const LABEL_SPACE = 120
const NAME_PX = 34
const SIZE_PX = 24

/** A texture, or null when it cannot be read (the disc keeps its plain colour). */
async function loadImage(url: string): Promise<HTMLImageElement | null> {
	const image = new Image()
	image.src = url
	try {
		await image.decode()
		return image
	} catch {
		return null
	}
}

/** Fills the circle of radius r at the origin with the rings' stops, over an angle range (the back or front half). */
function drawRingHalf(
	ctx: CanvasRenderingContext2D,
	body: Body,
	outer: number,
	back: boolean,
): void {
	const stops = ringStops(body)
	if (stops.length === 0 || outer <= 0) return
	ctx.save()
	ctx.beginPath()
	// the back half is above the centre line (as the stage's clip-path)
	ctx.rect(-outer, back ? -outer : 0, 2 * outer, outer)
	ctx.clip()
	ctx.scale(1, RING_OPENING)
	const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, outer)
	for (const [at, color] of stops) {
		gradient.addColorStop(Math.min(1, Math.max(0, at)), color)
	}
	ctx.fillStyle = gradient
	ctx.beginPath()
	ctx.arc(0, 0, outer, 0, Math.PI * 2)
	ctx.fill()
	ctx.restore()
}

/** One globe at the origin: half the map across the disc, lit from the upper left (the Sun glows). */
function drawGlobe(
	ctx: CanvasRenderingContext2D,
	body: Body,
	r: number,
	texture: HTMLImageElement | null,
): void {
	const star = body.kind === "star"
	ctx.save()
	if (star) {
		ctx.shadowColor = "rgba(255, 150, 40, 0.55)"
		ctx.shadowBlur = 0.25 * r
	}
	ctx.beginPath()
	ctx.arc(0, 0, r, 0, Math.PI * 2)
	ctx.fillStyle = star ? "#ffb347" : "#5b6472"
	ctx.fill()
	ctx.shadowBlur = 0
	ctx.clip()
	if (texture !== null && r >= 1) {
		const w = texture.naturalWidth
		ctx.drawImage(
			texture,
			w / 4,
			0,
			w / 2,
			texture.naturalHeight,
			-r,
			-r,
			2 * r,
			2 * r,
		)
	}
	const shade = star
		? ctx.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2 * r)
		: ctx.createRadialGradient(
				-0.32 * r,
				-0.4 * r,
				0,
				-0.32 * r,
				-0.4 * r,
				1.92 * r,
			)
	if (star) {
		shade.addColorStop(0, "rgba(255, 220, 150, 0.12)")
		shade.addColorStop(0.55, "rgba(255, 170, 60, 0)")
		shade.addColorStop(1, "rgba(150, 50, 0, 0.45)")
	} else {
		shade.addColorStop(0, "rgba(255, 255, 255, 0.1)")
		shade.addColorStop(0.38, "rgba(255, 255, 255, 0)")
		shade.addColorStop(0.7, "rgba(0, 0, 0, 0.25)")
		shade.addColorStop(1, "rgba(0, 0, 0, 0.7)")
	}
	ctx.fillStyle = shade
	ctx.fillRect(-r, -r, 2 * r, 2 * r)
	ctx.restore()
}

/** A centred label, as the postcard's labels are placed: by left edge and vertical middle. */
function centredLabel(
	ctx: CanvasRenderingContext2D,
	text: string,
	cx: number,
	y: number,
	weight: string,
	size: number,
	color: string,
): ShotLabel {
	ctx.font = `normal ${weight} ${size}px ${POSTCARD_FONT}`
	return {
		text,
		x: cx - ctx.measureText(text).width / 2,
		y,
		fontStyle: "normal",
		fontWeight: weight,
		fontSizePx: size,
		fontFamily: POSTCARD_FONT,
		color,
		opacity: 1,
	}
}

/** Draws the comparison of `ids` (in the stage's order) with its names and sizes as labels. */
export async function drawComparison(
	ids: readonly string[],
	name: (id: string) => string,
	size: (body: Body) => string,
): Promise<SceneShot> {
	const order = drawOrder(ids)
	const bodies = order.map((id) => getBody(id))
	const textures = await Promise.all(
		bodies.map((body) => loadImage(assetUrl(body.textures.base))),
	)
	const layout = layoutStage(
		bodies.map((body) => stageBody(body)),
		{
			width: PICTURE_WIDTH - 2 * PAD,
			height: PICTURE_HEIGHT - 2 * PAD - LABEL_SPACE,
			gap: 32,
			minSlot: 170,
		},
	)
	const image = document.createElement("canvas")
	image.width = PICTURE_WIDTH
	image.height = PICTURE_HEIGHT
	const ctx = image.getContext("2d")
	const labels: ShotLabel[] = []
	if (ctx === null) return { image, ratio: 1, labels }
	const background = ctx.createRadialGradient(
		PICTURE_WIDTH / 2,
		PICTURE_HEIGHT * 0.45,
		0,
		PICTURE_WIDTH / 2,
		PICTURE_HEIGHT * 0.45,
		PICTURE_WIDTH * 0.6,
	)
	background.addColorStop(0, "#0d1119")
	background.addColorStop(1, "#050609")
	ctx.fillStyle = background
	ctx.fillRect(0, 0, PICTURE_WIDTH, PICTURE_HEIGHT)
	// the row may be wider than the picture only when it would scroll on screen: shrink it to fit
	const fit = Math.min(1, (PICTURE_WIDTH - 2 * PAD) / layout.width)
	const left = (PICTURE_WIDTH - layout.width * fit) / 2
	layout.items.forEach((item, i) => {
		const body = bodies[i]
		const cx = left + item.cx * fit
		const cy = PAD + item.cy
		const r = Math.max(item.r * fit, MIN_DRAWN_PX / 2)
		const outer =
			body.rings === null ? 0 : body.rings.outerRadiusKm * layout.pxPerKm * fit
		ctx.save()
		ctx.translate(cx, cy)
		ctx.rotate((body.rotation.axialTiltDeg * Math.PI) / 180)
		drawRingHalf(ctx, body, outer, true)
		drawGlobe(ctx, body, r, textures[i])
		drawRingHalf(ctx, body, outer, false)
		ctx.restore()
		if (2 * r < MARK_BELOW_PX) {
			ctx.strokeStyle = "#ff922b"
			ctx.lineWidth = 3
			ctx.beginPath()
			ctx.arc(cx, cy, 16, 0, Math.PI * 2)
			ctx.stroke()
		}
		const labelTop = PICTURE_HEIGHT - PAD - LABEL_SPACE + 30
		labels.push(
			centredLabel(
				ctx,
				name(body.id),
				cx,
				labelTop + NAME_PX / 2,
				"700",
				NAME_PX,
				"#f1f3f5",
			),
			centredLabel(
				ctx,
				size(body),
				cx,
				labelTop + NAME_PX + 14 + SIZE_PX / 2,
				"500",
				SIZE_PX,
				"#adb5bd",
			),
		)
	})
	return { image, ratio: 1, labels }
}

/**
 * Makes the comparison's postcard and opens it: the drawing, the pair's
 * headline facts, the moment the distance was measured at and a link back.
 */
export async function takeComparisonPostcard(
	ids: readonly string[],
	jd: number,
	live: boolean,
	i18n: I18n,
	name: (id: string) => string,
): Promise<void> {
	const size = (body: Body) => {
		const diameter = i18n.quantity(
			Number((2 * body.radiusKm).toPrecision(3)),
			"kilometer",
		)
		return body.radiusEstimated
			? i18n.t("units.approx", { value: diameter })
			: diameter
	}
	const shot = await drawComparison(ids, name, size)
	const [a, b] = [getBody(ids[0]), getBody(ids[1])]
	// an idea's postcard leads with the comparison that makes its point (#40)
	const lead = presetFor(ids)?.lead
	const facts = pairFacts(a, b, i18n, { jd, live, lead }).map(
		(fact) => fact.comparison,
	)
	const hideDate = hidesTimeInUrl(useBirthdayStore.getState())
	const moment = live ? dateToJD(new Date()) : jd
	usePostcardStore.getState().show({
		shot,
		jd: moment,
		subjectId: null,
		scalePreset: null,
		hideDate,
		link: postcardLink(window.location.href, moment, hideDate),
		extra: {
			title: i18n.t("solarSystem.postcard.compareTitle", {
				a: name(a.id),
				b: name(b.id),
			}),
			caption: facts[0],
			facts: facts.slice(1, 4),
			scaleNote: i18n.t("solarSystem.postcard.compareScale"),
			fileName: `orbitalia-${drawOrder(ids).join("-")}.png`,
		},
	})
}
