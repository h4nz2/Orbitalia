/**
 * The belts' names in the label layout (#74 on top of #23): a `LabelExtension`
 * owning one slot per belt after the spacecraft's. A belt's name is written
 * across the belt's middle circle, centred on a point of it like an orbit's
 * name, while that circle is a sensible size on screen; the layout then keeps
 * it off every other name and from under the panels.
 *
 * Priority: after the Sun's and the planets' names, before the dwarf
 * planets', the comets' and the moons'. Where a body's name moves to another
 * side of its dot, a belt's moves along its circle: the viewer's left first
 * (where it always was), then the right, the far side (the circle's top on
 * screen), the near side and the four between them (`BELT_SPOTS`), its spot
 * of last frame first, so it shows wherever it fits and keeps off the dots of
 * the bodies in the belt.
 */
import { Vector3, type PerspectiveCamera } from "three"

import type { Belt } from "@/data"
import { rootIndexOf } from "@/sim"
import { useSimStore } from "@/store/sim"

import {
	MAX_LABEL_SPOTS,
	isKeptOut,
	putOnSide,
	type LabelLayout,
	type Side,
} from "../labels/layout"
import type { LabelExtension } from "../labels/project"
import type { SimFrame } from "../scene/simFrame"
import { beltLabelPosition, beltMidRadiusKm } from "./belts"

/** A belt's name shows while the belt's middle circle is at least this wide on screen (px radius)... */
export const BELT_LABEL_MIN_PX = 70
/** ...and at most this many viewport heights (inside the belt the name says nothing). */
export const BELT_LABEL_MAX_VIEWPORTS = 1.2

/** Whether a belt whose middle circle is `radiusPx` on screen gets its name. */
export const beltNameShown = (
	radiusPx: number,
	viewportHeightPx: number,
): boolean =>
	radiusPx >= BELT_LABEL_MIN_PX &&
	radiusPx <= BELT_LABEL_MAX_VIEWPORTS * viewportHeightPx

/**
 * Rank of belt `k`'s name (lower first) against the bodies' static ranks
 * (`staticLabelRanks`: the Sun and the planets are 0 .. `planetCount` - 1).
 */
export const beltLabelRank = (k: number, planetCount: number): number =>
	planetCount - 1 + (k + 1) / 1000

/**
 * Where a belt's name may sit on its circle, in the order tried: the
 * direction from the Sun on the ecliptic, as `side` parts of the viewer's
 * right (the camera's x axis on the ecliptic) and `far` parts of the way
 * away from the viewer (its y axis minus its z axis there, whether the camera
 * looks down on the ecliptic or along it). The viewer's left, right, the far
 * side, the near side, then the four between them.
 */
export const BELT_SPOTS: readonly { side: number; far: number }[] = [
	{ side: -1, far: 0 },
	{ side: 1, far: 0 },
	{ side: 0, far: 1 },
	{ side: 0, far: -1 },
	{ side: -1, far: 1 },
	{ side: -1, far: -1 },
	{ side: 1, far: 1 },
	{ side: 1, far: -1 },
]

const side = new Vector3()
const far = new Vector3()
const back = new Vector3()
const centre = new Vector3()
const at = new Vector3()
const projected = new Vector3()

export function createBeltLabels(
	frame: SimFrame,
	belts: readonly Belt[],
	firstSlot: number,
): LabelExtension {
	const root = rootIndexOf(frame.bodies)
	const midKm = belts.map(beltMidRadiusKm)
	// the Sun and the planets: the names a belt's name gives way to
	const planetCount = frame.bodies.filter(
		(body) => body.kind === "star" || body.kind === "planet",
	).length
	return {
		fill(layout: LabelLayout, camera: PerspectiveCamera, pxPerUnit: number) {
			const shownLayer = useSimStore.getState().showSmallBodies
			const { eligible, visible, opacity } = layout
			let distance = 0
			if (shownLayer) {
				// both on the ecliptic, of one length
				side.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize()
				far.setFromMatrixColumn(camera.matrixWorld, 1)
				back.setFromMatrixColumn(camera.matrixWorld, 2)
				far.sub(back).setY(0).normalize()
				frame.renderPosition(root, centre)
				distance = camera.position.distanceTo(centre)
			}
			for (let k = 0; k < belts.length; k++) {
				const slot = firstSlot + k
				if (slot >= layout.count) break
				eligible[slot] = 0
				let shown = false
				if (shownLayer) {
					beltLabelPosition(frame, midKm[k], -side.x, -side.z, at)
					const radiusPx =
						distance > 0 ? (at.distanceTo(centre) * pxPerUnit) / distance : 0
					shown =
						beltNameShown(radiusPx, layout.viewportHeight) &&
						placeSpots(layout, slot, frame, midKm[k], camera)
				}
				if (!shown) {
					visible[slot] = 0
					// fading out where it was
					if (opacity[slot] > 0 && layout.side[slot] >= 0) {
						putOnSide(layout, slot, layout.side[slot] as Side)
					} else {
						opacity[slot] = 0
					}
					continue
				}
				layout.radius[slot] = 0
				layout.centred[slot] = BELT_SPOTS.length
				layout.budgeted[slot] = 0
				layout.rank[slot] = beltLabelRank(k, planetCount)
				eligible[slot] = 1
				layout.order[layout.orderLength++] = slot
			}
		},
	}
}

/**
 * Projects belt label `slot`'s spots (`BELT_SPOTS`, its circle `radiusKm`
 * from the Sun) into the layout: the first as (cx, cy), the others as
 * `spotX/Y`, NaN where one is behind the camera or under a panel. Returns
 * whether any spot is there.
 */
function placeSpots(
	layout: LabelLayout,
	slot: number,
	frame: SimFrame,
	radiusKm: number,
	camera: PerspectiveCamera,
): boolean {
	let any = false
	for (let s = 0; s < BELT_SPOTS.length; s++) {
		const spot = BELT_SPOTS[s]
		const dx = spot.side * side.x + spot.far * far.x
		const dz = spot.side * side.z + spot.far * far.z
		let x = NaN
		let y = NaN
		if (Math.hypot(dx, dz) > 1e-9) {
			beltLabelPosition(frame, radiusKm, dx, dz, at)
			projected.copy(at).project(camera)
			if (projected.z > -1 && projected.z < 1) {
				x = ((projected.x + 1) / 2) * layout.viewportWidth
				y = ((1 - projected.y) / 2) * layout.viewportHeight
				if (isKeptOut(layout, x, y)) x = y = NaN
				else any = true
			}
		}
		if (s === 0) {
			layout.cx[slot] = x
			layout.cy[slot] = y
			layout.depth[slot] = at.distanceTo(camera.position)
		} else {
			const k = slot * (MAX_LABEL_SPOTS - 1) + s - 1
			layout.spotX[k] = x
			layout.spotY[k] = y
		}
	}
	return any
}
