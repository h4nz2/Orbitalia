/**
 * Spacecraft names in the body labels' layout (issue #35 on top of #20): a
 * `LabelExtension` owning one slot per craft after the bodies' and orbits'
 * slots, so the names follow the same placement, collision, fading and HUD
 * keep-out rules and never overlap a body's name.
 *
 * Priority: the hovered craft above everything, the selected craft above
 * every body but the hovered one; otherwise after every body's name (natural
 * bodies are the lesson) and before the orbit names. Craft names do not count
 * against the moon budget.
 */
import type { PerspectiveCamera } from "three"

import { followedCraftId } from "@/store/navigation"
import { useSimStore } from "@/store/sim"
import { useSpacecraftStore } from "@/store/spacecraft"

import {
	isKeptOut,
	putOnSide,
	type LabelLayout,
	type Side,
} from "../labels/layout"
import type { LabelExtension } from "../labels/project"
import type { SimFrame } from "../scene/simFrame"
import type { CraftFrame } from "./craftFrame"
import { CRAFT_MARKER_SIZE_PX, craftOnScreen, type ScreenPoint } from "./screen"

const point: ScreenPoint = { x: 0, y: 0, depth: 0 }

/** Rank of craft `k`'s name (lower first), against bodies ranked 0..n-1 (see labelRank). */
export function craftLabelRank(
	k: number,
	bodyCount: number,
	hovered: boolean,
	selected: boolean,
): number {
	const n = bodyCount
	if (hovered) return -4 * n + k
	if (selected) return -2.5 * n + k
	// after every body's name, before the orbit names (n + staticRank)
	return n - 1 + (k + 1) / 1000
}

export function createCraftLabels(
	frame: SimFrame,
	craftFrame: CraftFrame,
	firstSlot: number,
): LabelExtension {
	return {
		fill(layout: LabelLayout, camera: PerspectiveCamera) {
			const { showSpacecraft, selectedCraftId, hoverCraftId } =
				useSpacecraftStore.getState()
			// the craft the camera follows (#57) is named like the selected one
			const followed = followedCraftId(useSimStore.getState().view)
			const { eligible, visible, opacity } = layout
			const n = frame.bodies.length
			for (let k = 0; k < craftFrame.craft.length; k++) {
				const slot = firstSlot + k
				if (slot >= layout.count) break
				eligible[slot] = 0
				const id = craftFrame.craft[k].id
				const hovered = id === hoverCraftId
				const selected = id === selectedCraftId || id === followed
				const shown =
					showSpacecraft &&
					craftFrame.present[k] === 1 &&
					craftOnScreen(
						frame,
						craftFrame,
						k,
						camera,
						layout.viewportWidth,
						layout.viewportHeight,
						hovered || selected,
						visible[slot] === 1,
						point,
					)
				if (!shown) {
					visible[slot] = 0
					// fading out: stay beside the marker while it is still there
					if (opacity[slot] > 0 && layout.side[slot] >= 0) {
						putOnSide(layout, slot, layout.side[slot] as Side)
					} else {
						opacity[slot] = 0
					}
					continue
				}
				layout.cx[slot] = point.x
				layout.cy[slot] = point.y
				layout.depth[slot] = point.depth
				layout.radius[slot] = CRAFT_MARKER_SIZE_PX / 2
				layout.centred[slot] = 0
				layout.budgeted[slot] = 0
				if (isKeptOut(layout, point.x, point.y)) {
					visible[slot] = 0
					continue
				}
				layout.rank[slot] = craftLabelRank(k, n, hovered, selected)
				eligible[slot] = 1
				layout.order[layout.orderLength++] = slot
			}
		},
	}
}
