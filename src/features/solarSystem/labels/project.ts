/**
 * The per-frame half of the labels that needs three.js: projects the bodies
 * into a `LabelLayout` from the SimFrame's drawn positions and radii (the same
 * values the meshes and markers are drawn from, so a label never detaches from
 * its body in any scale preset) and runs the placement (./layout.ts).
 */
import { PerspectiveCamera, Vector3 } from "three"

import type { Body } from "@/data"
import { degToRad, toUnits } from "@/sim"
import { isBodyShown } from "@/store/sim"

import { moonOrbitFade, orbitScreenRadiusPx } from "../bodies/moonOrbitFade"
import { MARKER_HIDE_DIAMETER_PX, MARKER_SIZE_PX } from "../scene/Markers"
import type { SimFrame } from "../scene/simFrame"
import {
	LABEL_EDGE_MARGIN_PX,
	MOON_DISC_NAMED_PX,
	OBSTACLE_MAX_RADIUS_PX,
	isClearOfParent,
	isKeptOut,
	isLabelCandidate,
	isOccluded,
	isOrbitFamily,
	labelDensity,
	labelRank,
	placeLabels,
	putOnSide,
	sortByRank,
	type LabelLayout,
	type LabelState,
	type Side,
} from "./layout"
import { anchoredWeight } from "../frame/frameBlend"
import {
	orbitAnchor,
	type OrbitAnchor,
	type OrbitAnchorCache,
} from "./orbitAnchor"

export interface LabelFrameState extends LabelState {
	/** Marker dots are drawn, so a speck of a body is at least a dot wide. */
	showMarkers: boolean
	/** Orbit lines are drawn, and their names are asked for. */
	showOrbits: boolean
	showOrbitLabels: boolean
}

/**
 * Names of things that are not bodies (spacecraft, #35; the belts and the
 * light flash, #74), laid out in the same pass as the bodies' so they follow
 * the same rules and never collide. Each extension owns slots after the
 * bodies' and orbits' (from `labelSlotCount(bodies)` on, one range each);
 * every frame, after the bodies are projected, it projects its own, sets
 * their geometry, rank and eligibility and appends the eligible ones to
 * `layout.order`. Occlusion, sorting, placement and fading then treat them
 * like any other label.
 */
export interface LabelExtension {
	fill(
		layout: LabelLayout,
		camera: PerspectiveCamera,
		pxPerUnit: number,
		state: LabelFrameState,
	): void
}

/**
 * The layout's slots: one per body (its name beside it), then one per body
 * for its orbit's name (`orbitSlot`), so a layout has `2 * bodies.length`.
 */
export const labelSlotCount = (bodyCount: number): number => 2 * bodyCount
export const orbitSlot = (bodyIndex: number, bodyCount: number): number =>
	bodyCount + bodyIndex
/** The body a slot names. */
export const slotBody = (slot: number, bodyCount: number): number =>
	slot % bodyCount

/**
 * Whether a body's name counts against the moon budget: any moon or asteroid (#23), except the
 * one the user points at, selected or focused, and one big enough on screen to
 * be a world rather than a dot.
 */
export const isBudgeted = (
	body: Pick<Body, "id" | "kind">,
	state: Pick<LabelState, "focusId" | "selectedId" | "hoverId">,
	radiusPx: number,
): boolean =>
	(body.kind === "moon" || body.kind === "asteroid") &&
	body.id !== state.focusId &&
	body.id !== state.selectedId &&
	body.id !== state.hoverId &&
	radiusPx < MOON_DISC_NAMED_PX

const view = new Vector3()
const parentAt = new Vector3()

/**
 * Whether moon `i`'s orbit line is faded out right now (#17,
 * ../bodies/moonOrbitFade.ts): its name is then not written along it.
 */
function isMoonOrbitFaded(
	frame: SimFrame,
	i: number,
	camera: PerspectiveCamera,
	pxPerUnit: number,
): boolean {
	const body = frame.bodies[i]
	if (body.kind !== "moon" || body.parentId === null) return false
	const p = frame.index.get(body.parentId)
	if (p === undefined) return false
	const { displayKm } = frame
	const radius = Math.hypot(
		displayKm[i * 3] - displayKm[p * 3],
		displayKm[i * 3 + 1] - displayKm[p * 3 + 1],
		displayKm[i * 3 + 2] - displayKm[p * 3 + 2],
	)
	frame.renderPosition(p, parentAt)
	return (
		moonOrbitFade(
			orbitScreenRadiusPx(
				toUnits(radius),
				parentAt.distanceTo(camera.position),
				pxPerUnit,
			),
			body,
		) === 0
	)
}
const anchor: OrbitAnchor = { x: 0, y: 0, depth: 0 }
const NO_EXTENSIONS: readonly LabelExtension[] = []

/**
 * Projects body `i` into the layout: screen centre, disc radius (px) and
 * distance. Returns false when the body is behind the camera.
 */
function project(
	layout: LabelLayout,
	frame: SimFrame,
	camera: PerspectiveCamera,
	i: number,
	pxPerUnit: number,
	showMarkers: boolean,
): boolean {
	frame.renderPosition(i, view).applyMatrix4(camera.matrixWorldInverse)
	const distance = view.length()
	if (-view.z <= camera.near) {
		layout.radius[i] = 0
		return false
	}
	view.applyMatrix4(camera.projectionMatrix)
	layout.cx[i] = ((view.x + 1) / 2) * layout.viewportWidth
	layout.cy[i] = ((1 - view.y) / 2) * layout.viewportHeight
	layout.depth[i] = distance
	const r = frame.renderRadius(i)
	// the disc's angular radius, exact up close: asin(r / distance)
	const discPx =
		distance > r
			? (pxPerUnit * r) / Math.sqrt(distance * distance - r * r)
			: Infinity
	layout.radius[i] =
		showMarkers && 2 * discPx <= MARKER_HIDE_DIAMETER_PX
			? Math.max(discPx, MARKER_SIZE_PX / 2)
			: discPx
	return true
}

/**
 * One frame of label layout: which bodies are candidates, where they are on
 * screen, which are eligible, their priority, and finally `placeLabels`. The
 * camera's matrices must be current (`updateMatrixWorld`). `staticRanks` is
 * `staticLabelRanks(frame.bodies)`. Labels that are no longer candidates but
 * still fading out keep following their bodies. With `orbitCache`, the orbits
 * of labelled bodies get their names too while `showOrbitLabels` is on, after
 * every body name in priority (on a small screen only the focus family's,
 * `labelDensity`). The `extensions` add their own labels (spacecraft, belts,
 * the light flash).
 */
export function fillLabelLayout(
	layout: LabelLayout,
	frame: SimFrame,
	camera: PerspectiveCamera,
	widthPx: number,
	heightPx: number,
	state: LabelFrameState,
	staticRanks: Float64Array,
	orbitCache?: OrbitAnchorCache,
	extensions: readonly LabelExtension[] = NO_EXTENSIONS,
): void {
	layout.viewportWidth = widthPx
	layout.viewportHeight = heightPx
	// fewer names on a smaller screen (#74)
	const density = labelDensity(widthPx, heightPx, layout.density)
	const pxPerUnit =
		heightPx / (2 * Math.tan(degToRad(camera.fov / 2))) / camera.zoom
	const bodies: readonly Body[] = frame.bodies
	const focusIndex = frame.index.get(state.focusId)
	const focus = focusIndex === undefined ? undefined : bodies[focusIndex]
	const focusParentId = focus?.parentId ?? null
	const { order, eligible, visible, opacity, rank } = layout

	layout.orderLength = 0
	for (let i = 0; i < bodies.length; i++) {
		const body = bodies[i]
		eligible[i] = 0
		const candidate =
			isBodyShown(body, state) && isLabelCandidate(body, state, focusParentId)
		if (!candidate) {
			visible[i] = 0
			// still fading out: keep it beside its body
			if (
				opacity[i] > 0 &&
				project(layout, frame, camera, i, pxPerUnit, state.showMarkers) &&
				layout.side[i] >= 0
			) {
				putOnSide(layout, i, layout.side[i] as Side)
			} else {
				opacity[i] = 0
			}
			continue
		}
		if (!project(layout, frame, camera, i, pxPerUnit, state.showMarkers)) {
			visible[i] = 0
			opacity[i] = 0
			continue
		}
		eligible[i] = 1
		rank[i] = labelRank(body.id, staticRanks[i], bodies.length, state)
		layout.budgeted[i] = isBudgeted(body, state, layout.radius[i]) ? 1 : 0
		order[layout.orderLength++] = i
	}

	const n = bodies.length
	const orbitNames =
		orbitCache !== undefined &&
		state.showOrbits &&
		state.showOrbitLabels &&
		layout.count >= labelSlotCount(n)
	const heliocentricFaded =
		anchoredWeight(frame.frameBlend, frame.topIndex[0]) > 0.5
	for (let i = 0; orbitNames && i < n; i++) {
		const slot = orbitSlot(i, n)
		const body = bodies[i]
		eligible[slot] = 0
		visible[slot] = 0
		if (
			body.orbit === null ||
			// orbits around the Sun fade out in an anchored frame (#31)
			(frame.topIndex[i] === i && heliocentricFaded) ||
			!isBodyShown(body, state) ||
			!isLabelCandidate(body, state, focusParentId) ||
			(density.familyOrbitsOnly &&
				focus !== undefined &&
				!isOrbitFamily(body, focus)) ||
			isMoonOrbitFaded(frame, i, camera, pxPerUnit) ||
			!orbitAnchor(
				orbitCache,
				frame,
				camera,
				i,
				{ width: widthPx, height: heightPx, margin: LABEL_EDGE_MARGIN_PX },
				{ width: layout.width[slot], height: layout.height[slot] },
				anchor,
			)
		) {
			continue
		}
		layout.cx[slot] = anchor.x
		layout.cy[slot] = anchor.y
		layout.depth[slot] = anchor.depth
		layout.radius[slot] = 0
		layout.centred[slot] = 1
		layout.budgeted[slot] = body.kind === "moon" ? 1 : 0
		eligible[slot] = 1
		// after every body's own name
		rank[slot] = n + staticRanks[i]
		order[layout.orderLength++] = slot
	}
	if (!orbitNames) {
		const orbitEnd = Math.min(layout.count, labelSlotCount(n))
		for (let slot = n; slot < orbitEnd; slot++) {
			eligible[slot] = 0
			visible[slot] = 0
		}
	}

	for (const extension of extensions) {
		extension.fill(layout, camera, pxPerUnit, state)
	}

	// eligibility needs every candidate projected: occlusion and moon clearance
	for (let k = 0; k < layout.orderLength; k++) {
		const i = order[k]
		// behind a nearer disc, or under a HUD panel: nothing there to name
		if (
			isOccluded(layout, i) ||
			(i < n && isKeptOut(layout, layout.cx[i], layout.cy[i]))
		) {
			eligible[i] = 0
			continue
		}
		if (i >= n) continue
		const body = bodies[i]
		if (body.kind !== "moon" || body.parentId === null) continue
		const p = frame.index.get(body.parentId)
		// a planet whose face is bigger than a dot sets its moons apart by itself
		if (
			p === undefined ||
			layout.radius[p] <= 0 ||
			layout.radius[p] > OBSTACLE_MAX_RADIUS_PX
		) {
			continue
		}
		if (
			!isClearOfParent(
				layout.cx[i] - layout.cx[p],
				layout.cy[i] - layout.cy[p],
				layout.radius[p],
				visible[i] === 1,
			)
		) {
			eligible[i] = 0
		}
	}

	sortByRank(layout)
	placeLabels(layout)
}
