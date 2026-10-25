/**
 * The light flash's label in the label layout (#74 on top of #27 and #38): a
 * `LabelExtension` owning one slot, after the belts'. LightFront.tsx writes
 * where on the front the label rides (`FrontLabelAnchor`) every frame; this
 * places the label beside that point like any other name, so it never lands
 * on a body's name, keeps out from under the panels and fades in and out.
 *
 * Priority: above every other name while the flash is out. It is what the
 * viewer just asked for, and it carries the flash's stop button.
 */
import { Vector3, type PerspectiveCamera } from "three"

import {
	SIDE,
	isKeptOut,
	putOnSide,
	type LabelLayout,
	type Side,
} from "../labels/layout"
import type { LabelExtension } from "../labels/project"

/** Where the label rides, written by LightFront every frame. */
export interface FrontLabelAnchor {
	/** The front is drawn this frame. */
	shown: boolean
	/** The front's opacity (it fades out once past the planets, #38), 0..1. */
	opacity: number
	/** The point on the front the label sits beside, scene units. */
	readonly position: Vector3
}

export const createFrontLabelAnchor = (): FrontLabelAnchor => ({
	shown: false,
	opacity: 0,
	position: new Vector3(),
})

/** The anchor counts as a dot this big (px radius): about the front's line, which the label sits beside. */
export const FRONT_LABEL_RADIUS_PX = 2

/** Below this opacity of the front (fading out, #38) its label gives its place back to the other names. */
export const FRONT_LABEL_MIN_OPACITY = 0.15

/** Rank of the flash's label (lower first): above the hovered body and craft (see labelRank, craftLabelRank). */
export const frontLabelRank = (bodyCount: number): number => -5 * bodyCount

const view = new Vector3()

export function createFrontLabel(
	anchor: FrontLabelAnchor,
	bodyCount: number,
	slot: number,
): LabelExtension {
	return {
		fill(layout: LabelLayout, camera: PerspectiveCamera) {
			if (slot >= layout.count) return
			const { eligible, visible, opacity } = layout
			eligible[slot] = 0
			let inFront = false
			if (anchor.shown && anchor.opacity >= FRONT_LABEL_MIN_OPACITY) {
				view.copy(anchor.position).applyMatrix4(camera.matrixWorldInverse)
				inFront = -view.z > camera.near
			}
			if (!inFront) {
				visible[slot] = 0
				// fading out where it was
				if (opacity[slot] > 0 && layout.side[slot] >= 0) {
					putOnSide(layout, slot, layout.side[slot] as Side)
				} else {
					opacity[slot] = 0
				}
				return
			}
			const depth = view.length()
			view.applyMatrix4(camera.projectionMatrix)
			layout.cx[slot] = ((view.x + 1) / 2) * layout.viewportWidth
			layout.cy[slot] = ((1 - view.y) / 2) * layout.viewportHeight
			layout.depth[slot] = depth
			layout.radius[slot] = FRONT_LABEL_RADIUS_PX
			layout.centred[slot] = 0
			layout.budgeted[slot] = 0
			// over the front, as it always was, unless that is taken
			if (layout.side[slot] < 0) layout.side[slot] = SIDE.above
			if (isKeptOut(layout, layout.cx[slot], layout.cy[slot])) {
				visible[slot] = 0
				return
			}
			layout.rank[slot] = frontLabelRank(bodyCount)
			eligible[slot] = 1
			layout.order[layout.orderLength++] = slot
		},
	}
}
