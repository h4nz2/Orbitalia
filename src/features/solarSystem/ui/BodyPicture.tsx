/**
 * A body's picture: its own surface map on a shaded disc (the comparison's
 * globes, #24, in small), with Saturn's bright rings. What an Easy clue of
 * the scavenger hunt shows a child who cannot read yet, its sticker once
 * found, and the label pictures while an Easy clue is asked (#52). No image
 * files of its own: the textures the scene already loads.
 *
 * The size is the font size: `size="4rem"`, or inherit it (`1em` wide).
 */
import type { CSSProperties } from "react"

import { bodyById } from "@/data"
import { assetUrl } from "@/utils/assetUrl"

import classes from "./BodyPicture.module.css"

/**
 * Rings bright enough to show in a small picture. The others (Jupiter's,
 * Uranus's, Neptune's) are dark and thin: drawn there they would only make
 * "the planet with big rings" ambiguous.
 */
const BRIGHT_RINGS: ReadonlySet<string> = new Set(["saturn"])

export interface BodyPictureProps {
	id: string
	/** The globe's diameter (any CSS length); default: the font size. */
	size?: string
	className?: string
}

export const BodyPicture = ({ id, size, className }: BodyPictureProps) => {
	const body = bodyById.get(id)
	if (body === undefined) return null
	const rings = BRIGHT_RINGS.has(id)
	const style: CSSProperties = {
		fontSize: size,
		transform: rings ? `rotate(${body.rotation.axialTiltDeg}deg)` : undefined,
	}
	return (
		<span
			className={`${classes.picture} ${className ?? ""}`}
			style={style}
			data-picture={id}
			data-rings={rings || undefined}
			aria-hidden="true"
		>
			{rings && <span className={`${classes.ring} ${classes.ringBack}`} />}
			<span
				className={classes.globe}
				data-kind={body.kind}
				style={{ backgroundImage: `url("${assetUrl(body.textures.base)}")` }}
			/>
			{rings && <span className={`${classes.ring} ${classes.ringFront}`} />}
		</span>
	)
}

export default BodyPicture
