/**
 * Condition-based waits for the WebGL scene. Headless chromium draws the scene
 * with software WebGL (swiftshader), and on a loaded machine a single frame can
 * take a second or more, so these wait for rendered frames and for the camera
 * to come to rest instead of for a fixed number of milliseconds.
 */
import type { Page } from "@playwright/test"

/** Resolves once the browser has drawn `count` more animation frames. */
export const nextFrames = (page: Page, count = 3): Promise<void> =>
	page.evaluate(
		(count) =>
			new Promise<void>((resolve) => {
				let left = count
				const step = () => {
					left -= 1
					if (left <= 0) resolve()
					else requestAnimationFrame(step)
				}
				requestAnimationFrame(step)
			}),
		count,
	)

/**
 * Waits until the solar system is on screen and its camera has come to rest:
 * no transition runs, no pan is pending (a released pan glides on and is then
 * committed, often as a short snap flight: #15), and the camera's pose round
 * its pivot (distance, azimuth, elevation, and the controls' target, which a
 * pan moves off the pivot) has stayed the same for `frames` consecutive
 * frames, which also lets the scene draw that many frames at rest before the
 * picture is judged. Frames, not milliseconds: camera-controls' damping
 * advances per drawn frame, however long a loaded machine takes to draw one.
 */
export const cameraAtRest = (page: Page, frames = 3): Promise<unknown> =>
	page.waitForFunction(
		({ frames, key }) => {
			const handle = window.__orbitalia
			if (handle === undefined) return false
			const camera = handle.camera()
			const state = handle.store.getState()
			const probe = window as unknown as {
				restKey?: number
				restPose?: string
				restFor?: number
			}
			// every wait counts its own frames, never a previous wait's
			if (probe.restKey !== key) {
				probe.restKey = key
				probe.restPose = undefined
				probe.restFor = 0
			}
			const drift = Math.hypot(...camera.targetUnits) / camera.distance
			const pose = [camera.distance, camera.azimuthDeg, camera.elevationDeg]
				.map((value) => value.toPrecision(6))
				.concat(drift.toFixed(6))
				.join()
			const moving =
				camera.transitionId !== null ||
				state.transition !== null ||
				state.panning ||
				pose !== probe.restPose
			probe.restPose = pose
			probe.restFor = moving ? 0 : (probe.restFor ?? 0) + 1
			return probe.restFor >= frames
		},
		{ frames, key: Math.random() },
		{ polling: "raf" },
	)

/**
 * Waits until the body and orbit labels (#20) have finished fading and
 * stand still: every label is fully shown or fully hidden, and none has moved
 * or changed for `frames` consecutive frames. Labels fade over 0.2 s of frame
 * time, which a loaded machine may take several seconds to draw.
 */
export const labelsAtRest = (page: Page, frames = 3): Promise<unknown> =>
	page.waitForFunction(
		({ frames, key }) => {
			const probe = window as unknown as {
				labelKey?: number
				labelState?: string
				labelsFor?: number
			}
			if (probe.labelKey !== key) {
				probe.labelKey = key
				probe.labelState = undefined
				probe.labelsFor = 0
			}
			const labels = [
				...document.querySelectorAll<HTMLElement>("[data-body], [data-orbit]"),
			]
			const fading = labels.some((label) => {
				const opacity = label.style.opacity
				return opacity !== "" && opacity !== "0" && opacity !== "1"
			})
			const state = labels
				.map((label) => `${label.style.transform}|${label.style.opacity}`)
				.join()
			const changed = fading || state !== probe.labelState
			probe.labelState = state
			probe.labelsFor = changed ? 0 : (probe.labelsFor ?? 0) + 1
			return probe.labelsFor >= frames
		},
		{ frames, key: Math.random() },
		{ polling: "raf" },
	)

/**
 * Waits until the open menu (Mantine's dropdown) has finished its entrance:
 * fully opaque and in the same place for `frames` consecutive frames. On a
 * scrolling page this matters: Playwright retries a click on an element that
 * is still moving with ever more forceful scrolling (aligning it to the top
 * of the viewport), which scrolls the menu's button out of view, and a menu
 * whose button is out of view hides itself.
 */
export const menuAtRest = (page: Page, frames = 3): Promise<unknown> =>
	page.waitForFunction(
		({ frames, key }) => {
			const probe = window as unknown as {
				menuKey?: number
				menuBox?: string
				menuFor?: number
			}
			if (probe.menuKey !== key) {
				probe.menuKey = key
				probe.menuBox = undefined
				probe.menuFor = 0
			}
			const menu = document.querySelector<HTMLElement>("[role=menu]")
			if (menu === null) return false
			const rect = menu.getBoundingClientRect()
			const box = [rect.x, rect.y, rect.width, rect.height].join()
			const entering =
				getComputedStyle(menu).opacity !== "1" ||
				getComputedStyle(menu).visibility !== "visible"
			const changed = entering || box !== probe.menuBox
			probe.menuBox = box
			probe.menuFor = changed ? 0 : (probe.menuFor ?? 0) + 1
			return probe.menuFor >= frames
		},
		{ frames, key: Math.random() },
		{ polling: "raf" },
	)
