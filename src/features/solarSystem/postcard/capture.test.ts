import { afterEach, describe, expect, it, vi } from "vitest"
import { PerspectiveCamera, Scene, type WebGLRenderer } from "three"

import { pivotLiftOf, setPivotLift } from "../camera/lift"
import { CAPTURE_LONG_SIDE, captureRatio, snapshotScene } from "./capture"

describe("the picture's resolution", () => {
	it("raises a small screen's picture to a clean size", () => {
		// a 1280 x 720 projector at 1x: 1920 x 1080
		expect(captureRatio(1280, 720, 1)).toBeCloseTo(1.5)
		expect(1280 * captureRatio(1280, 720, 1)).toBeCloseTo(CAPTURE_LONG_SIDE)
		// a phone in portrait: the long side counts
		expect(844 * captureRatio(390, 844, 2)).toBeGreaterThanOrEqual(
			CAPTURE_LONG_SIDE,
		)
	})

	it("never lowers the screen's own sharpness", () => {
		expect(captureRatio(1920, 1080, 1)).toBe(1)
		expect(captureRatio(1440, 900, 2)).toBe(2)
	})

	it("stays within the size limit", () => {
		expect(2560 * captureRatio(2560, 1440, 2, 4096)).toBeLessThanOrEqual(4096)
		expect(captureRatio(800, 600, 1, 1000)).toBeCloseTo(1.25)
	})
})

describe("a picture of a phone's off-centre view (#61)", () => {
	afterEach(() => vi.unstubAllGlobals())

	it("is rendered with the lens centred, the names moved down with the scene", () => {
		const camera = new PerspectiveCamera(45, 390 / 844, 0.1, 100)
		setPivotLift(camera, 0.1)
		const label = {
			textContent: "Saturn",
			querySelector: () => null,
			getBoundingClientRect: () => ({ left: 200, top: 300, height: 20 }),
		}
		vi.stubGlobal("document", {
			querySelector: () => ({
				hidden: false,
				querySelectorAll: () => [label],
			}),
			createElement: () => ({
				width: 0,
				height: 0,
				getContext: () => ({ drawImage: () => undefined }),
			}),
		})
		vi.stubGlobal("getComputedStyle", () => ({
			opacity: "1",
			visibility: "visible",
			fontStyle: "normal",
			fontWeight: "600",
			fontSize: "14px",
			fontFamily: "sans-serif",
			color: "white",
		}))
		const lifts: number[] = []
		const gl = {
			domElement: {
				width: 780,
				height: 1688,
				getBoundingClientRect: () => ({
					left: 0,
					top: 0,
					width: 390,
					height: 844,
				}),
			},
			getPixelRatio: () => 2,
			setPixelRatio: () => undefined,
			getContext: () => ({
				MAX_RENDERBUFFER_SIZE: 0,
				getParameter: () => 4096,
			}),
			render: (_scene: Scene, rendered: PerspectiveCamera) =>
				lifts.push(pivotLiftOf(rendered)),
		}
		const shot = snapshotScene(
			gl as unknown as WebGLRenderer,
			new Scene(),
			camera,
		)
		// the picture: lens centred; the screen: lifted again afterwards
		expect(lifts).toEqual([0])
		expect(pivotLiftOf(camera)).toBeCloseTo(0.1, 12)
		// the name moved down by the lift, as the scene was
		expect(shot?.labels[0].y).toBeCloseTo(300 + 10 + 0.1 * 844, 9)
	})
})
