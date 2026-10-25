import { describe, expect, it } from "vitest"
import { PerspectiveCamera, Vector3 } from "three"

import { bodies } from "@/data"
import { J2000_JD, SCALE_PRESETS } from "@/sim"

import { overviewDistance } from "../camera/framing"
import {
	SIDE,
	createLabelLayout,
	fadeLabels,
	labelRank,
	staticLabelRanks,
	type LabelLayout,
} from "../labels/layout"
import {
	fillLabelLayout,
	labelSlotCount,
	type LabelFrameState,
} from "../labels/project"
import { createSimFrame, updateSimFrame } from "../scene/simFrame"
import { craftLabelRank } from "../spacecraft/craftLabels"
import {
	FRONT_LABEL_MIN_OPACITY,
	createFrontLabel,
	createFrontLabelAnchor,
	frontLabelRank,
} from "./frontLabel"

const n = bodies.length
const slot = labelSlotCount(n)
const ranks = staticLabelRanks(bodies)
const state: LabelFrameState = {
	focusId: "sun",
	selectedId: null,
	hoverId: null,
	showMoons: true,
	showAllMoons: false,
	showMarkers: true,
	showOrbits: true,
	showOrbitLabels: false,
}

const frame = createSimFrame(bodies, J2000_JD, SCALE_PRESETS.everythingVisible)
updateSimFrame(frame, J2000_JD, 0)

/** The overview on a `width` x `height` screen, 45° above the planets. */
function overview(width: number, height: number): PerspectiveCamera {
	const camera = new PerspectiveCamera(45, width / height, 1e-5, 1e9)
	const d =
		overviewDistance(frame.scale, 45, width / height) * Math.SQRT1_2 * 1.2
	camera.position.set(0, d, d)
	camera.lookAt(0, 0, 0)
	camera.updateMatrixWorld()
	return camera
}

function lay(
	anchor: ReturnType<typeof createFrontLabelAnchor>,
	width: number,
	height: number,
	layout: LabelLayout = measured(),
): LabelLayout {
	fillLabelLayout(
		layout,
		frame,
		overview(width, height),
		width,
		height,
		state,
		ranks,
		undefined,
		[createFrontLabel(anchor, n, slot)],
	)
	return layout
}

function measured(): LabelLayout {
	const layout = createLabelLayout(slot + 1)
	layout.width.fill(70)
	layout.height.fill(18)
	// the flash's label: its words and its 44 px stop button (#62)
	layout.width[slot] = 120
	layout.height[slot] = 44
	return layout
}

const overlaps = (layout: LabelLayout, a: number, b: number) =>
	layout.x[a] < layout.x[b] + layout.width[b] &&
	layout.x[a] + layout.width[a] > layout.x[b] &&
	layout.y[a] < layout.y[b] + layout.height[b] &&
	layout.y[a] + layout.height[a] > layout.y[b]

const index = (id: string) => bodies.findIndex((body) => body.id === id)

describe("the light flash's label in the layout (#74)", () => {
	it("ranks above every other name, the hovered body's and craft's too", () => {
		const top = frontLabelRank(n)
		expect(top).toBeLessThan(Math.min(...ranks) - 3 * n)
		for (const id of ["sun", "earth", "io"]) {
			const i = index(id)
			expect(top).toBeLessThan(
				labelRank(id, ranks[i], n, {
					focusId: id,
					selectedId: id,
					hoverId: id,
				}),
			)
		}
		expect(top).toBeLessThan(craftLabelRank(0, n, true, false))
	})

	it("is placed first where the names crowd, and no name lies over it", () => {
		for (const [width, height] of [
			[360, 640],
			[390, 844],
			[1366, 768],
		]) {
			// the flash just left the Sun: in the middle of the inner planets' names
			const anchor = createFrontLabelAnchor()
			anchor.shown = true
			anchor.opacity = 1
			frame.renderPosition(index("earth"), anchor.position)
			anchor.position.multiplyScalar(0.5)
			const layout = lay(anchor, width, height)
			expect(layout.eligible[slot]).toBe(1)
			expect(layout.placed[0]).toBe(slot)
			for (let k = 1; k < layout.placedLength; k++) {
				expect(overlaps(layout, slot, layout.placed[k])).toBe(false)
			}
		}
	})

	it("sits over the front where that is free, and moves with it", () => {
		const anchor = createFrontLabelAnchor()
		anchor.shown = true
		anchor.opacity = 1
		// beyond Neptune, where no other name is
		frame.renderPosition(index("neptune"), anchor.position)
		anchor.position.multiplyScalar(1.3)
		const layout = lay(anchor, 1366, 768)
		expect(layout.side[slot]).toBe(SIDE.above)
		const x = layout.x[slot]
		anchor.position.add(new Vector3(anchor.position.length() * 0.05, 0, 0))
		lay(anchor, 1366, 768, layout)
		expect(layout.visible[slot]).toBe(1)
		expect(layout.x[slot]).not.toBe(x)
	})

	it("fades out when the front is gone", () => {
		const anchor = createFrontLabelAnchor()
		anchor.shown = true
		anchor.opacity = 1
		frame.renderPosition(index("mars"), anchor.position)
		const layout = lay(anchor, 1366, 768)
		fadeLabels(layout, 1)
		expect(layout.opacity[slot]).toBe(1)
		anchor.shown = false
		lay(anchor, 1366, 768, layout)
		expect(layout.eligible[slot]).toBe(0)
		expect(layout.visible[slot]).toBe(0)
		fadeLabels(layout, 1)
		expect(layout.opacity[slot]).toBe(0)
		// a front that has all but faded out gives the names their places back
		anchor.shown = true
		anchor.opacity = FRONT_LABEL_MIN_OPACITY / 2
		lay(anchor, 1366, 768, layout)
		expect(layout.eligible[slot]).toBe(0)
	})
})
