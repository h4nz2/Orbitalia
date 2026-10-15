/**
 * The pivot drawn off the canvas's centre (#61; docs/ARCHITECTURE.md,
 * "Framing what is free"): on a phone the camera draws what it looks at in
 * the middle of the band the HUD leaves free, not behind the panels. It is
 * the camera's own view offset (an off-centre lens): the picture is shifted
 * up or down, never zoomed or distorted, so everything that projects through
 * the camera (labels, picking, rings round bodies, markers) follows by itself.
 */
import { PerspectiveCamera, type Camera } from "three"

/**
 * Draws `camera`'s pivot (the point it looks at) `share` of the canvas
 * height above the canvas's centre (negative: below); 0 centres it again.
 * The offset is kept in shares of the canvas (a view of 1 x 1), so a resize
 * never leaves it stale.
 */
export function setPivotLift(camera: PerspectiveCamera, share: number): void {
	const lift = Number.isFinite(share) ? share : 0
	if (lift === 0) {
		if (camera.view?.enabled !== true) return
		camera.view.enabled = false
		camera.updateProjectionMatrix()
		return
	}
	if (camera.view === null) {
		camera.view = {
			enabled: true,
			fullWidth: 1,
			fullHeight: 1,
			offsetX: 0,
			offsetY: lift,
			width: 1,
			height: 1,
		}
	} else {
		camera.view.enabled = true
		camera.view.fullWidth = 1
		camera.view.fullHeight = 1
		camera.view.offsetX = 0
		camera.view.offsetY = lift
		camera.view.width = 1
		camera.view.height = 1
	}
	camera.updateProjectionMatrix()
}

/** The share of the canvas height `camera` draws its pivot above the centre (0: centred). */
export function pivotLiftOf(camera: Camera): number {
	if (!(camera instanceof PerspectiveCamera)) return 0
	const view = camera.view
	if (view === null || !view.enabled || !(view.fullHeight > 0)) return 0
	return view.offsetY / view.fullHeight
}

/**
 * The CSS custom property on `<html>` holding where the pivot is drawn
 * (#61): the share of the canvas height above its centre, for the HUD's
 * centre marker (`ui/CentreMarker.module.css`).
 */
export const PIVOT_LIFT_PROPERTY = "--pivot-lift"

/**
 * Writes where `camera` draws its pivot to `PIVOT_LIFT_PROPERTY` on `root`,
 * only when it moved since `memo.written` (every frame, no React state).
 */
export function writePivotLift(
	camera: Camera,
	memo: { written: number },
	root: HTMLElement,
): void {
	const share = Math.round(pivotLiftOf(camera) * 1e4) / 1e4
	if (share === memo.written) return
	memo.written = share
	root.style.setProperty(PIVOT_LIFT_PROPERTY, String(share))
}
