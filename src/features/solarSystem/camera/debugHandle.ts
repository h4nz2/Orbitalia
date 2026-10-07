/**
 * `window.__orbitalia` while the solar system is on screen: the store (the
 * navigation API: `select`, `focus`, `overview`, `goTo`, `playSequence`, ...)
 * and read-only camera diagnostics. It lets the navigation model be driven
 * from the browser console and from end-to-end tests without touching the
 * camera. Not an API for app code: import the store instead.
 */
import { useScaleStore } from "@/store/scale"
import { useSimStore } from "@/store/sim"
import { useViewHistoryStore } from "@/store/viewHistory"

import { placeRing, type RingPlacement } from "../scene/highlight"
import type { CameraDirector, CameraSnapshot } from "./director"

export interface OrbitaliaDebugHandle {
	store: typeof useSimStore
	/** The scale store (presets), for the console and e2e tests. */
	scale: typeof useScaleStore
	/** The view history (#46): the entry on screen and what each entry returns to. */
	history: typeof useViewHistoryStore
	camera: () => CameraSnapshot
	/**
	 * Where a body is drawn on the canvas right now (CSS px from the canvas's
	 * top left, and its drawn radius), or null when it is off screen (#16).
	 */
	screenOf: (id: string) => RingPlacement | null
}

declare global {
	interface Window {
		__orbitalia?: OrbitaliaDebugHandle
	}
}

/** Publishes the handle; returns the function that removes it again. */
export function exposeDebugHandle(
	director: CameraDirector,
	canvas?: HTMLElement,
): () => void {
	if (typeof window === "undefined") return () => undefined
	const handle: OrbitaliaDebugHandle = {
		store: useSimStore,
		scale: useScaleStore,
		history: useViewHistoryStore,
		camera: () => director.snapshot(),
		screenOf: (id) => {
			const index = director.frame.index.get(id)
			if (index === undefined || canvas === undefined) return null
			director.camera.updateMatrixWorld()
			return placeRing(
				director.frame,
				index,
				director.camera,
				canvas.clientWidth,
				canvas.clientHeight,
			)
		},
	}
	window.__orbitalia = handle
	return () => {
		if (window.__orbitalia === handle) delete window.__orbitalia
	}
}
