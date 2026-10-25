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
 *
 * Density (#74): a small screen (`layout.density`) names the selected, hovered
 * or followed craft and at most `SMALL_SCREEN_CRAFT_NAMES` others, the
 * nearest to the focus first; a laptop names every craft on screen.
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
import type { LabelExtension, LabelFrameState } from "../labels/project"
import type { SimFrame } from "../scene/simFrame"
import type { CraftFrame } from "./craftFrame"
import { CRAFT_MARKER_SIZE_PX, craftOnScreen, type ScreenPoint } from "./screen"

const point: ScreenPoint = { x: 0, y: 0, depth: 0 }
const reference = new Float64Array(3)

/**
 * A craft named last frame keeps its name on a small screen unless another is
 * nearer the focus by more than this fraction, so two craft at about the same
 * distance do not swap names while the camera or the clock moves.
 */
export const CRAFT_PICK_HYSTERESIS = 0.1

const pickKey = (k: number, distance: Float64Array, named: Uint8Array) =>
	named[k] === 1 ? distance[k] * (1 - CRAFT_PICK_HYSTERESIS) : distance[k]

/**
 * Picks the craft named on a small screen besides the selected, hovered or
 * followed one: sorts `waiting` (craft indices, `count` of them) nearest
 * first by `distance` (per craft index; insertion: a handful of craft, no
 * allocation), a craft `named` last frame counting
 * `CRAFT_PICK_HYSTERESIS` nearer, and returns how many of them are named, at
 * most `limit`. Writes this frame's picks into `named`.
 */
export function nearestFirst(
	waiting: Int32Array,
	count: number,
	distance: Float64Array,
	limit: number,
	named: Uint8Array,
): number {
	for (let a = 1; a < count; a++) {
		const k = waiting[a]
		const d = pickKey(k, distance, named)
		let b = a - 1
		while (b >= 0 && pickKey(waiting[b], distance, named) > d) {
			waiting[b + 1] = waiting[b]
			b--
		}
		waiting[b + 1] = k
	}
	const picked = Math.min(count, limit)
	named.fill(0)
	for (let w = 0; w < picked; w++) named[waiting[w]] = 1
	return picked
}

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
	// per craft: the distance to the focus, and the others waiting for a small screen's few names
	const distance = new Float64Array(craftFrame.craft.length)
	const waiting = new Int32Array(craftFrame.craft.length)
	// named last frame among the waiting ones (the hysteresis)
	const named = new Uint8Array(craftFrame.craft.length)
	return {
		fill(
			layout: LabelLayout,
			camera: PerspectiveCamera,
			_pxPerUnit: number,
			state: LabelFrameState,
		) {
			const { showSpacecraft, selectedCraftId, hoverCraftId } =
				useSpacecraftStore.getState()
			// the craft the camera follows (#57) is named like the selected one
			const followed = followedCraftId(useSimStore.getState().view)
			const { eligible, visible, opacity } = layout
			const n = frame.bodies.length
			const limit = layout.density.craftNames
			const few = Number.isFinite(limit)
			if (few) focusPoint(frame, craftFrame, state.focusId, followed)
			let waitingCount = 0
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
				// beside the model where one is drawn (#73), else beside the diamond
				layout.radius[slot] = Math.max(
					CRAFT_MARKER_SIZE_PX / 2,
					craftFrame.modelRadiusPx[k],
				)
				layout.centred[slot] = 0
				layout.budgeted[slot] = 0
				if (isKeptOut(layout, point.x, point.y)) {
					visible[slot] = 0
					continue
				}
				layout.rank[slot] = craftLabelRank(k, n, hovered, selected)
				if (few && !hovered && !selected) {
					const at = craftFrame.states[k].displayKm
					distance[k] = Math.hypot(
						at[0] - reference[0],
						at[1] - reference[1],
						at[2] - reference[2],
					)
					waiting[waitingCount++] = k
					continue
				}
				eligible[slot] = 1
				layout.order[layout.orderLength++] = slot
			}
			// a small screen: only the nearest few of the others; the rest fade out beside their markers
			const picked = nearestFirst(waiting, waitingCount, distance, limit, named)
			for (let w = 0; w < waitingCount; w++) {
				const slot = firstSlot + waiting[w]
				if (w < picked) {
					eligible[slot] = 1
					layout.order[layout.orderLength++] = slot
				} else {
					visible[slot] = 0
					if (opacity[slot] > 0 && layout.side[slot] >= 0) {
						putOnSide(layout, slot, layout.side[slot] as Side)
					}
				}
			}
		},
	}
}

/**
 * Where "near the focus" is measured from, in drawn km (`reference`): the
 * followed craft while one is followed, else the focus body.
 */
function focusPoint(
	frame: SimFrame,
	craftFrame: CraftFrame,
	focusId: string,
	followed: string | null,
): void {
	for (let k = 0; followed !== null && k < craftFrame.craft.length; k++) {
		if (craftFrame.craft[k].id !== followed) continue
		reference.set(craftFrame.states[k].displayKm)
		return
	}
	const i = frame.index.get(focusId) ?? 0
	reference[0] = frame.displayKm[i * 3]
	reference[1] = frame.displayKm[i * 3 + 1]
	reference[2] = frame.displayKm[i * 3 + 2]
}
