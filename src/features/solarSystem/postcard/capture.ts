/**
 * Taking the picture (issue #33). The canvas keeps no copy of its last frame
 * (no `preserveDrawingBuffer`, which would cost every frame), so a picture is
 * drawn on demand: at the click the scene is rendered once more, straight
 * away, and copied before the browser gets to clear it. For a clean picture
 * on a small screen that one render is made at a higher pixel ratio (at least
 * CAPTURE_LONG_SIDE px along the long side) and the ratio is put back at
 * once; the next animation frame draws the page as before, so nothing flickers.
 *
 * The names over the scene are DOM (../labels), not WebGL: they are read from
 * the label layer as they are on screen, to be painted onto the picture.
 * Only the canvas and the names are taken, never the HUD.
 */
import type { Camera, Scene, WebGLRenderer } from "three"

import type { SceneShot, ShotLabel } from "@/store/postcard"

/** The picture's long side is at least this many pixels (1920 x 1080 from a 1280 x 720 projector). */
export const CAPTURE_LONG_SIDE = 1920
/** Never larger than this along a side (memory on phones, WebGL limits). */
export const CAPTURE_MAX_SIDE = 4096

/**
 * The pixel ratio to render the picture at: the screen's own, raised until the
 * long side reaches CAPTURE_LONG_SIDE, but never beyond `maxSide`.
 */
export function captureRatio(
	cssWidth: number,
	cssHeight: number,
	current: number,
	maxSide = CAPTURE_MAX_SIDE,
): number {
	const long = Math.max(cssWidth, cssHeight, 1)
	const wanted = Math.max(current, CAPTURE_LONG_SIDE / long)
	return Math.max(Math.min(wanted, maxSide / long), 0.1)
}

/** The label layer's element (labels/LabelLayer.tsx). */
export const LABEL_LAYER_SELECTOR = "[data-label-layer]"

/**
 * The names as they are on screen, relative to `origin` (the canvas's box):
 * every label element with some opacity, in paint order.
 */
export function readLabels(origin: DOMRect): ShotLabel[] {
	const layer = document.querySelector(LABEL_LAYER_SELECTOR)
	if (layer === null || (layer as HTMLElement).hidden) return []
	const labels: ShotLabel[] = []
	for (const element of layer.querySelectorAll<HTMLElement>(
		"[data-body], [data-orbit]",
	)) {
		const style = getComputedStyle(element)
		const opacity = Number(style.opacity)
		if (style.visibility === "hidden" || !(opacity > 0.05)) continue
		const text = element.textContent ?? ""
		if (text === "") continue
		// a name with a picture beside it (#52): the words start after it
		const words = element.querySelector("[data-label-text]") ?? element
		const rect = words.getBoundingClientRect()
		labels.push({
			text,
			x: rect.left - origin.left,
			y: rect.top - origin.top + rect.height / 2,
			fontStyle: style.fontStyle,
			fontWeight: style.fontWeight,
			fontSizePx: Number.parseFloat(style.fontSize) || 14,
			fontFamily: style.fontFamily,
			color: style.color,
			opacity,
		})
	}
	return labels
}

/** Renders the scene once, now, and copies it with the names on screen. */
export function snapshotScene(
	gl: WebGLRenderer,
	scene: Scene,
	camera: Camera,
): SceneShot | null {
	const canvas = gl.domElement
	const box = canvas.getBoundingClientRect()
	if (box.width < 1 || box.height < 1) return null
	const previous = gl.getPixelRatio()
	const context = gl.getContext()
	const limit = Math.min(
		CAPTURE_MAX_SIDE,
		Number(context.getParameter(context.MAX_RENDERBUFFER_SIZE)) ||
			CAPTURE_MAX_SIDE,
	)
	const ratio = captureRatio(box.width, box.height, previous, limit)
	const image = document.createElement("canvas")
	try {
		if (ratio !== previous) gl.setPixelRatio(ratio)
		gl.render(scene, camera)
		image.width = canvas.width
		image.height = canvas.height
		image.getContext("2d")?.drawImage(canvas, 0, 0)
	} finally {
		if (ratio !== previous) gl.setPixelRatio(previous)
	}
	return {
		image,
		ratio: image.width / box.width,
		labels: readLabels(box),
	}
}

let capture: (() => SceneShot | null) | null = null

/** Registers the scene's picture taker (postcard/SceneCapture.tsx, inside the Canvas); returns the unregister. */
export function setSceneCapture(taker: () => SceneShot | null): () => void {
	capture = taker
	return () => {
		if (capture === taker) capture = null
	}
}

/** The scene as it is now, or null while no scene is mounted. */
export const captureScene = (): SceneShot | null => capture?.() ?? null
