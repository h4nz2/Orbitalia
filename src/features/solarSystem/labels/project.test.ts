import { describe, expect, it } from "vitest"
import { PerspectiveCamera, Vector3 } from "three"

import { bodies, isSmallBody } from "@/data"
import { J2000_JD, SCALE_PRESETS, SCALE_PRESET_IDS, degToRad } from "@/sim"

import { overviewDistance } from "../camera/framing"
import {
	createSimFrame,
	updateSimFrame,
	type SimFrame,
} from "../scene/simFrame"
import {
	LABEL_GAP_PX,
	MOON_DISC_NAMED_PX,
	MOON_LABEL_BUDGET,
	createLabelLayout,
	isOrbitFamily,
	staticLabelRanks,
	type LabelLayout,
} from "./layout"
import {
	createOrbitAnchorCache,
	orbitAnchor,
	type OrbitAnchorCache,
} from "./orbitAnchor"
import {
	fillLabelLayout,
	isBudgeted,
	labelSlotCount,
	orbitSlot,
	type LabelFrameState,
} from "./project"

const WIDTH = 1200
const HEIGHT = 800
const ranks = staticLabelRanks(bodies)
const index = (id: string): number => bodies.findIndex((b) => b.id === id)
const galileans = ["io", "europa", "ganymede", "callisto"]

const baseState: LabelFrameState = {
	focusId: "sun",
	selectedId: null,
	hoverId: null,
	showMoons: true,
	showAllMoons: true,
	showMarkers: true,
	showOrbits: true,
	showOrbitLabels: false,
}

/** A camera `distance` units from the render origin, 45° above the ecliptic. */
const cameraAt = (distance: number): PerspectiveCamera => {
	const camera = new PerspectiveCamera(45, WIDTH / HEIGHT, 1e-5, 1e9)
	const d = distance * Math.SQRT1_2
	camera.position.set(0, d, d)
	camera.lookAt(0, 0, 0)
	camera.updateMatrixWorld()
	return camera
}

const frameOn = (
	focusId: string,
	scale = SCALE_PRESETS.everythingVisible,
): SimFrame => {
	const frame = createSimFrame(bodies, J2000_JD, scale)
	updateSimFrame(frame, J2000_JD, index(focusId))
	return frame
}

const measuredLayout = (): LabelLayout => {
	const layout = createLabelLayout(bodies.length)
	layout.width.fill(70)
	layout.height.fill(18)
	return layout
}

const lay = (
	frame: SimFrame,
	camera: PerspectiveCamera,
	state: Partial<LabelFrameState> = {},
	layout = measuredLayout(),
): LabelLayout => {
	fillLabelLayout(
		layout,
		frame,
		camera,
		WIDTH,
		HEIGHT,
		{ ...baseState, ...state },
		ranks,
	)
	return layout
}

const shown = (layout: LabelLayout): string[] =>
	Array.from(layout.placed.slice(0, layout.placedLength)).map(
		(i) => bodies[i].id,
	)
const eligible = (layout: LabelLayout): string[] =>
	bodies.filter((_, i) => layout.eligible[i]).map((b) => b.id)

describe("fillLabelLayout", () => {
	it("names the Sun and the planets in the overview, and no moon", () => {
		const frame = frameOn("sun")
		const camera = cameraAt(overviewDistance(frame.scale, 45, WIDTH / HEIGHT))
		const layout = lay(frame, camera)
		expect(eligible(layout)).toEqual(
			// the small bodies (#23) are hidden while their layer is off
			bodies
				.filter((b) => b.kind !== "moon" && !isSmallBody(b))
				.map((b) => b.id),
		)
		expect(shown(layout)[0]).toBe("sun")
		expect(shown(layout)).toEqual(
			expect.arrayContaining(["jupiter", "saturn", "uranus", "neptune"]),
		)
	})

	it("fades a planet's moons in as the camera approaches it", () => {
		const frame = frameOn("jupiter")
		const jupiterRadius = frame.renderRadius(index("jupiter"))
		const moonsNamed = (radii: number) =>
			eligible(
				lay(frame, cameraAt(radii * jupiterRadius), { focusId: "jupiter" }),
			).filter((id) => galileans.includes(id)).length
		expect(moonsNamed(3000)).toBe(0)
		expect(moonsNamed(300)).toBeGreaterThan(0)
		expect(moonsNamed(30)).toBe(4)
		const close = lay(frame, cameraAt(30 * jupiterRadius), {
			focusId: "jupiter",
		})
		expect(shown(close)).toEqual(
			expect.arrayContaining(["jupiter", ...galileans]),
		)
	})

	it("keeps every label attached to its drawn body in every scale preset", () => {
		for (const id of SCALE_PRESET_IDS) {
			for (const focusId of ["sun", "earth", "saturn"]) {
				const frame = frameOn(focusId, SCALE_PRESETS[id])
				const i = index(focusId)
				const distance =
					focusId === "sun"
						? overviewDistance(frame.scale, 45, WIDTH / HEIGHT)
						: 40 * frame.renderRadius(i)
				const camera = cameraAt(distance)
				const layout = lay(frame, camera, { focusId })
				expect(layout.placedLength).toBeGreaterThan(0)
				const p = new Vector3()
				for (const b of layout.placed.slice(0, layout.placedLength)) {
					// the anchor is the body's drawn position, projected
					frame.renderPosition(b, p).project(camera)
					expect(layout.cx[b]).toBeCloseTo(((p.x + 1) / 2) * WIDTH, 6)
					expect(layout.cy[b]).toBeCloseTo(((1 - p.y) / 2) * HEIGHT, 6)
					// and the label sits exactly one gap outside its drawn disc
					const dx = Math.max(
						layout.x[b] - layout.cx[b],
						0,
						layout.cx[b] - layout.x[b] - layout.width[b],
					)
					const dy = Math.max(
						layout.y[b] - layout.cy[b],
						0,
						layout.cy[b] - layout.y[b] - layout.height[b],
					)
					expect(Math.hypot(dx, dy)).toBeCloseTo(
						layout.radius[b] + LABEL_GAP_PX,
						6,
					)
				}
			}
		}
	})

	it("sizes the disc from the drawn radius, and at least a marker dot", () => {
		const frame = frameOn("earth")
		const earth = index("earth")
		const r = frame.renderRadius(earth)
		const layout = lay(frame, cameraAt(10 * r), { focusId: "earth" })
		const pxPerUnit = HEIGHT / (2 * Math.tan(degToRad(22.5)))
		expect(layout.radius[earth]).toBeCloseTo(
			(pxPerUnit * r) / Math.sqrt(100 * r * r - r * r),
			6,
		)
		const far = lay(frame, cameraAt(1e7 * r), { focusId: "earth" })
		expect(far.radius[earth]).toBe(2)
		const noDots = lay(frame, cameraAt(1e7 * r), {
			focusId: "earth",
			showMarkers: false,
		})
		expect(noDots.radius[earth]).toBeLessThan(0.01)
	})

	it("drops bodies behind the camera or hidden behind a nearer disc", () => {
		const frame = frameOn("jupiter")
		const r = frame.renderRadius(index("jupiter"))
		const camera = cameraAt(1.5 * r)
		const layout = lay(frame, camera, { focusId: "jupiter" })
		// the Sun is somewhere; whatever is behind the camera is never eligible
		for (let i = 0; i < bodies.length; i++) {
			if (!layout.eligible[i]) continue
			const p = frame.renderPosition(i, new Vector3())
			p.applyMatrix4(camera.matrixWorldInverse)
			expect(p.z).toBeLessThan(0)
		}
		// the far side of Jupiter from 1.5 radii: a moon straight behind it is hidden
		const behind = measuredLayout()
		fillLabelLayout(
			behind,
			frame,
			cameraAt(1.5 * r),
			WIDTH,
			HEIGHT,
			{ ...baseState, focusId: "jupiter" },
			ranks,
		)
		for (const i of behind.order.slice(0, behind.orderLength)) {
			const j = index("jupiter")
			const dx = behind.cx[i] - behind.cx[j]
			const dy = behind.cy[i] - behind.cy[j]
			if (
				i !== j &&
				behind.depth[i] > behind.depth[j] &&
				Math.hypot(dx, dy) < behind.radius[j]
			) {
				expect(behind.eligible[i]).toBe(0)
			}
		}
	})

	it("names no moon while the moons are hidden, except the focus", () => {
		const frame = frameOn("io")
		const r = frame.renderRadius(index("jupiter"))
		const layout = lay(frame, cameraAt(30 * r), {
			focusId: "io",
			showMoons: false,
			showAllMoons: true,
		})
		const moons = eligible(layout).filter(
			(id) => bodies[index(id)].kind === "moon",
		)
		expect(moons.every((id) => id === "io")).toBe(true)
	})

	it("budgets small moons, never the one the user is looking at", () => {
		const io = { id: "io", kind: "moon" as const }
		const s = { focusId: "jupiter", selectedId: null, hoverId: null }
		expect(isBudgeted(io, s, 2)).toBe(true)
		expect(isBudgeted(io, s, 20)).toBe(false)
		expect(isBudgeted(io, { ...s, hoverId: "io" }, 2)).toBe(false)
		expect(isBudgeted(io, { ...s, focusId: "io" }, 2)).toBe(false)
		expect(isBudgeted({ id: "mars", kind: "planet" }, s, 2)).toBe(false)
	})
})

describe("density by screen size (#74)", () => {
	/** A camera for a `width` x `height` screen, `distance` units from the origin, 45° up. */
	const cameraFor = (distance: number, width: number, height: number) => {
		const camera = new PerspectiveCamera(45, width / height, 1e-5, 1e9)
		const d = distance * Math.SQRT1_2
		camera.position.set(0, d, d)
		camera.lookAt(0, 0, 0)
		camera.updateMatrixWorld()
		return camera
	}
	const layAt = (
		frame: SimFrame,
		distance: number,
		width: number,
		height: number,
		state: Partial<LabelFrameState>,
		orbits?: OrbitAnchorCache,
	) => {
		const layout = createLabelLayout(labelSlotCount(bodies.length))
		layout.width.fill(70)
		layout.height.fill(18)
		fillLabelLayout(
			layout,
			frame,
			cameraFor(distance, width, height),
			width,
			height,
			{ ...baseState, ...state },
			ranks,
			orbits,
		)
		return layout
	}
	const moonNames = (layout: LabelLayout) =>
		shown(layout).filter((id) => bodies[index(id)].kind === "moon")

	it("names fewer of Saturn's moons on a phone than on a laptop", () => {
		const frame = frameOn("saturn")
		const distance = 80 * frame.renderRadius(index("saturn"))
		const state = { focusId: "saturn" }
		const laptop = layAt(frame, distance, 1366, 768, state)
		const phone = layAt(frame, distance, 360, 640, state)
		expect(laptop.density.moonBudget).toBe(MOON_LABEL_BUDGET)
		expect(phone.density.moonBudget).toBe(3)
		expect(moonNames(phone).length).toBeLessThan(moonNames(laptop).length)
		// within the phone's budget, except the moons big enough to be worlds on screen
		const small = moonNames(phone).filter(
			(id) => phone.radius[index(id)] < MOON_DISC_NAMED_PX,
		)
		expect(small.length).toBeLessThanOrEqual(3)
		// the selected moon is named on top of them
		const iapetus = layAt(frame, distance, 360, 640, {
			focusId: "saturn",
			selectedId: "iapetus",
		})
		expect(shown(iapetus)).toContain("iapetus")
	})

	it("names only the focus family's orbits on a phone, every orbit on a laptop", () => {
		const frame = frameOn("saturn")
		const distance = 400 * frame.renderRadius(index("saturn"))
		const state = { focusId: "saturn", showOrbitLabels: true }
		const n = bodies.length
		const orbitsEligible = (layout: LabelLayout) =>
			bodies
				.filter((_, i) => layout.eligible[orbitSlot(i, n)] === 1)
				.map((b) => b.id)
		const laptop = orbitsEligible(
			layAt(
				frame,
				distance,
				1366,
				768,
				state,
				createOrbitAnchorCache(bodies.length),
			),
		)
		const phone = orbitsEligible(
			layAt(
				frame,
				distance,
				360,
				640,
				state,
				createOrbitAnchorCache(bodies.length),
			),
		)
		expect(laptop).toContain("jupiter")
		expect(phone).not.toContain("jupiter")
		expect(phone.length).toBeGreaterThan(0)
		const saturn = bodies[index("saturn")]
		expect(phone.every((id) => isOrbitFamily(bodies[index(id)], saturn))).toBe(
			true,
		)
	})
})

describe("orbit names", () => {
	const orbitLayout = () => {
		const layout = createLabelLayout(labelSlotCount(bodies.length))
		layout.width.fill(70)
		layout.height.fill(18)
		return layout
	}

	it("writes each planet's name on its drawn orbit, at the line's leftmost point", () => {
		const frame = frameOn("sun")
		const camera = cameraAt(overviewDistance(frame.scale, 45, WIDTH / HEIGHT))
		const cache = createOrbitAnchorCache(bodies.length)
		const anchor = { x: 0, y: 0, depth: 0 }
		const viewport = { width: WIDTH, height: HEIGHT, margin: 4 }
		const box = { width: 70, height: 18 }
		const neptune = index("neptune")
		expect(
			orbitAnchor(cache, frame, camera, neptune, viewport, box, anchor),
		).toBe(true)
		// left of the Sun, and left of every other sample of the orbit on screen
		const sun = new Vector3()
		frame.renderPosition(index("sun"), sun).project(camera)
		expect(anchor.x).toBeLessThan(((sun.x + 1) / 2) * WIDTH)
		const saturn = { x: 0, y: 0, depth: 0 }
		orbitAnchor(cache, frame, camera, index("saturn"), viewport, box, saturn)
		expect(anchor.x).toBeLessThan(saturn.x)
		// no orbit, no name
		expect(
			orbitAnchor(cache, frame, camera, index("sun"), viewport, box, anchor),
		).toBe(false)
	})

	it("names the orbits only while asked to, and after every body's own name", () => {
		const frame = frameOn("sun")
		const camera = cameraAt(overviewDistance(frame.scale, 45, WIDTH / HEIGHT))
		const cache = createOrbitAnchorCache(bodies.length)
		const n = bodies.length
		const run = (patch: Partial<LabelFrameState>) => {
			const layout = orbitLayout()
			fillLabelLayout(
				layout,
				frame,
				camera,
				WIDTH,
				HEIGHT,
				{ ...baseState, ...patch },
				ranks,
				cache,
			)
			return layout
		}
		const off = run({})
		expect(off.eligible.slice(n).every((e) => e === 0)).toBe(true)
		const on = run({ showOrbitLabels: true })
		const neptune = orbitSlot(index("neptune"), n)
		expect(on.eligible[neptune]).toBe(1)
		expect(on.centred[neptune]).toBe(1)
		expect(on.visible[neptune]).toBe(1)
		const placed = Array.from(on.placed.slice(0, on.placedLength))
		const firstOrbit = placed.findIndex((slot) => slot >= n)
		expect(placed.slice(firstOrbit).every((slot) => slot >= n)).toBe(true)
		// the orbit lines themselves are off: no names for them either
		const noLines = run({ showOrbitLabels: true, showOrbits: false })
		expect(noLines.eligible.slice(n).every((e) => e === 0)).toBe(true)
	})
})
