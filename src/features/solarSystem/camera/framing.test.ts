import { describe, expect, it } from "vitest"

import { bodies, getBody, sun } from "@/data"
import {
	AU_KM,
	SCALE_PRESETS,
	SCALE_PRESET_IDS,
	TRUE_SCALE,
	degToRad,
	displayDistanceKm,
	toUnits,
} from "@/sim"
import { insetShares, type Insets } from "@/store/freeArea"
import { UPRIGHT_HOME_SHOT } from "@/store/navigation"

import { createSimFrame } from "../scene/simFrame"
import {
	CAMERA_FAR,
	CAMERA_MAX_DISTANCE,
	CAMERA_NEAR,
	FRAMING_RADII,
	MIN_DISTANCE_RADII,
	OVERVIEW_MARGIN,
	defaultDistance,
	fitDistance,
	minDollyDistance,
	minViewDistance,
	overviewDistance,
	overviewRadius,
	BODY_FIT_SHARE,
	bodyFramingRadii,
	framedRingRatio,
	lensOf,
	pivotLift,
	ringRatioOf,
	tightFitDistance,
} from "./framing"

describe("minDollyDistance", () => {
	it("is 1.2 radii for every body big enough to keep the surface past the near plane", () => {
		const earth = toUnits(getBody("earth").radiusKm)
		expect(minDollyDistance(earth)).toBe(MIN_DISTANCE_RADII * earth)
	})

	it("keeps the eye more than a near plane away from the surface of the smallest moon", () => {
		// Bennu (#23) has the smallest radius in the data (0.24 km)
		const smallest = bodies.reduce((a, b) => (b.radiusKm < a.radiusKm ? b : a))
		expect(smallest.radiusKm).toBeCloseTo(0.242, 3)
		const radius = toUnits(smallest.radiusKm)
		expect(minDollyDistance(radius) - radius).toBeGreaterThan(CAMERA_NEAR)
	})

	it("never lets any body's surface reach the near plane at the closest dolly", () => {
		for (const body of bodies) {
			const radius = toUnits(body.radiusKm)
			expect(minDollyDistance(radius) - radius).toBeGreaterThanOrEqual(
				2 * CAMERA_NEAR,
			)
		}
	})

	it("kicks in only for radii below 10 near planes", () => {
		// below 5 * 2 * CAMERA_NEAR / (MIN_DISTANCE_RADII - 1) the near-plane rule wins
		const boundary = (2 * CAMERA_NEAR) / (MIN_DISTANCE_RADII - 1)
		expect(minDollyDistance(boundary * 2)).toBeCloseTo(
			MIN_DISTANCE_RADII * boundary * 2,
			12,
		)
		expect(minDollyDistance(boundary / 2)).toBeCloseTo(
			boundary / 2 + 2 * CAMERA_NEAR,
			12,
		)
	})
})

const trueFrame = createSimFrame(bodies, undefined, TRUE_SCALE)
const visibleFrame = createSimFrame(
	bodies,
	undefined,
	SCALE_PRESETS.everythingVisible,
)
const drawn = (frame: typeof trueFrame, id: string) =>
	frame.renderRadius(frame.index.get(id)!)

describe("defaultDistance", () => {
	it("frames every body from 6 of its drawn radii, so all fill the same share of the screen", () => {
		for (const frame of [trueFrame, visibleFrame]) {
			for (const id of ["sun", "jupiter", "mercury", "io"]) {
				expect(defaultDistance({ kind: "body", id }, frame, 45, 1.5)).toBe(
					FRAMING_RADII * drawn(frame, id),
				)
			}
			// a point in space uses its anchor's framing
			expect(
				defaultDistance(
					{ kind: "point", anchorId: "mars", offsetKm: [1e6, 0, 0] },
					frame,
					45,
					1.5,
				),
			).toBe(FRAMING_RADII * drawn(frame, "mars"))
			// a point in interplanetary space (anchored to the Sun) is framed like the overview
			expect(
				defaultDistance(
					{ kind: "point", anchorId: "sun", offsetKm: [2e8, 0, 0] },
					frame,
					45,
					1.5,
				),
			).toBe(defaultDistance({ kind: "overview" }, frame, 45, 1.5))
		}
		// drawn, not true: Earth is enlarged in the default preset
		expect(drawn(visibleFrame, "earth")).toBeGreaterThan(
			toUnits(getBody("earth").radiusKm) * 5,
		)
	})

	it("fits the whole planetary system, as drawn, into the overview", () => {
		// Neptune's aphelion, a little over 30 AU at true scale
		const radius = overviewRadius(TRUE_SCALE)
		expect(radius * 1000).toBeGreaterThan(30 * AU_KM)
		expect(radius * 1000).toBeLessThan(31 * AU_KM)
		// the default preset pulls the far orbits in
		expect(overviewRadius(SCALE_PRESETS.everythingVisible)).toBeLessThan(
			radius / 10,
		)
		const landscape = defaultDistance(
			{ kind: "overview" },
			trueFrame,
			45,
			16 / 9,
		)
		expect(landscape).toBe(overviewDistance(TRUE_SCALE, 45, 16 / 9))
		// the vertical field of view is the narrower one: the system (and a margin) fills it
		expect(landscape * Math.sin(degToRad(22.5))).toBeCloseTo(
			OVERVIEW_MARGIN * radius,
			6,
		)
		// a portrait screen backs further out to fit the width, and (#61) frames
		// the drawn orbits tightly from the steeper upright home elevation
		const portrait = overviewDistance(TRUE_SCALE, 45, 0.5)
		expect(portrait).toBeGreaterThan(landscape)
		expect(portrait).toBe(
			tightFitDistance(radius, 45, 0.5, UPRIGHT_HOME_SHOT.elevationDeg),
		)
	})

	it("keeps the widest true-scale overview inside the dolly limit and the far plane", () => {
		const narrowest = overviewDistance(TRUE_SCALE, 45, 0.4)
		expect(narrowest).toBeLessThan(CAMERA_MAX_DISTANCE / 2)
		expect(CAMERA_MAX_DISTANCE + overviewRadius(TRUE_SCALE)).toBeLessThan(
			CAMERA_FAR,
		)
	})

	it("fits a sphere exactly", () => {
		expect(fitDistance(1, 90, 1)).toBeCloseTo(Math.SQRT2, 12)
	})
})

describe("minViewDistance", () => {
	it("keeps the camera outside the drawn body a view is centred on", () => {
		expect(minViewDistance({ kind: "body", id: "earth" }, visibleFrame)).toBe(
			minDollyDistance(drawn(visibleFrame, "earth")),
		)
		expect(minViewDistance({ kind: "overview" }, trueFrame)).toBe(
			minDollyDistance(drawn(trueFrame, "sun")),
		)
		// a point in space takes the limits of the body whose neighbourhood it is in
		expect(
			minViewDistance(
				{ kind: "point", anchorId: "earth", offsetKm: [0, 1e5, 0] },
				trueFrame,
			),
		).toBe(minDollyDistance(drawn(trueFrame, "earth")))
		expect(
			minViewDistance(
				{ kind: "point", anchorId: "mercury", offsetKm: [0, 1e4, 0] },
				trueFrame,
			),
		).toBeLessThan(
			minViewDistance(
				{ kind: "point", anchorId: "sun", offsetKm: [1e8, 0, 0] },
				trueFrame,
			) / 100,
		)
	})
})

/** A 390 x 844 phone as today's HUD covers it: the card folded, then unfolded. */
const PHONE = { width: 390, height: 844 }
const folded = insetShares({ ...PHONE, top: 122, bottom: 206 })
const unfolded = insetShares({ ...PHONE, top: 122, bottom: 522 })
const TAN_HALF = Math.tan(degToRad(22.5))

/**
 * The box (px on a `width` x `height` canvas) a circle of `radius` round the
 * pivot in the plane of the orbits takes, seen from `elevationDeg` (azimuth
 * 0) at `distance`, the pivot drawn `lift` of the height above the centre.
 */
function circleBox(
	radius: number,
	distance: number,
	elevationDeg: number,
	width: number,
	height: number,
	lift = 0,
) {
	const e = degToRad(elevationDeg)
	const pxPerTan = height / 2 / TAN_HALF
	const box = {
		top: Infinity,
		bottom: -Infinity,
		left: Infinity,
		right: -Infinity,
	}
	for (let k = 0; k < 720; k++) {
		const t = (k / 720) * 2 * Math.PI
		const x = radius * Math.cos(t)
		const z = radius * Math.sin(t)
		// camera at distance (0, sin e, cos e); forward -that, up (0, cos e, -sin e), right +x
		const depth = distance - z * Math.cos(e)
		const up = -z * Math.sin(e)
		const px = width / 2 + (x / depth) * pxPerTan
		const py = height / 2 - lift * height - (up / depth) * pxPerTan
		box.top = Math.min(box.top, py)
		box.bottom = Math.max(box.bottom, py)
		box.left = Math.min(box.left, px)
		box.right = Math.max(box.right, px)
	}
	return box
}

/** The tangent of the angular radius of a sphere `radii` big seen from `distance` (in its radii). */
const outline = (radii: number, distance: number) =>
	Math.tan(Math.asin(radii / distance))

describe("framing what is free (#61)", () => {
	it("frames the band the HUD leaves free as a lens of its own", () => {
		const insets: Insets = { top: 0.1, bottom: 0.3 }
		const lens = lensOf(45, 0.5, insets)
		expect(Math.tan(degToRad(lens.fovDeg / 2))).toBeCloseTo(TAN_HALF * 0.6, 12)
		expect(lens.aspect).toBeCloseTo(0.5 / 0.6, 12)
		expect(lens).toMatchObject({ upright: true, banded: true })
		// the pivot in the middle of the band: 0.1 of the height above the centre
		expect(pivotLift(insets)).toBeCloseTo(0.1, 12)
		// nothing covered: the canvas itself
		expect(lensOf(45, 16 / 9)).toEqual({
			fovDeg: 45,
			aspect: 16 / 9,
			upright: false,
			banded: false,
		})
		expect(pivotLift({ top: 0, bottom: 0 })).toBe(0)
	})

	it("keeps every laptop's and landscape screen's framing: 6 drawn radii for every body", () => {
		for (const aspect of [16 / 9, 1366 / 768, 16 / 10, 4 / 3, 844 / 390]) {
			for (const body of bodies) {
				expect(
					defaultDistance(
						{ kind: "body", id: body.id },
						visibleFrame,
						45,
						aspect,
					),
				).toBe(FRAMING_RADII * drawn(visibleFrame, body.id))
			}
		}
	})

	it("fits rings that read clearly across an upright phone, and backs off no further", () => {
		const halfWidth = TAN_HALF * (PHONE.width / PHONE.height)
		for (const id of ["saturn", "uranus"]) {
			const ratio = ringRatioOf(id)
			expect(ratio).toBeGreaterThan(2)
			const radii =
				defaultDistance(
					{ kind: "body", id },
					visibleFrame,
					45,
					PHONE.width / PHONE.height,
					folded,
				) / drawn(visibleFrame, id)
			expect(radii).toBe(
				bodyFramingRadii(ratio, lensOf(45, PHONE.width / PHONE.height, folded)),
			)
			// the rings' outer edge at the framing's share of the half-width
			expect(outline(ratio, radii)).toBeCloseTo(BODY_FIT_SHARE * halfWidth, 9)
		}
		// the planets without rings, and those whose rings are faint (#62: Jupiter's
		// and Neptune's run off the sides), are framed as on a laptop
		for (const id of [
			"mercury",
			"venus",
			"earth",
			"mars",
			"jupiter",
			"neptune",
		]) {
			expect(
				defaultDistance(
					{ kind: "body", id },
					visibleFrame,
					45,
					PHONE.width / PHONE.height,
					folded,
				),
			).toBe(FRAMING_RADII * drawn(visibleFrame, id))
		}
	})

	it("counts only the rings that read clearly (#62): Jupiter's and Neptune's are faint", () => {
		for (const id of ["jupiter", "neptune"]) {
			const body = getBody(id)
			expect(body.rings?.faint).toBe(true)
			// their data rings reach far out, yet the framing does not count them
			expect(body.rings!.outerRadiusKm / body.radiusKm).toBeGreaterThan(2.5)
			expect(ringRatioOf(id)).toBe(0)
			expect(framedRingRatio(body)).toBe(0)
		}
		for (const id of ["saturn", "uranus"]) {
			const body = getBody(id)
			expect(body.rings?.faint).toBeUndefined()
			expect(ringRatioOf(id)).toBe(body.rings!.outerRadiusKm / body.radiusKm)
		}
		expect(ringRatioOf("earth")).toBe(0)
	})

	it("fits a body, and its rings, whole into the short band above an unfolded card", () => {
		const halfBand = TAN_HALF * (1 - unfolded.top - unfolded.bottom)
		for (const id of ["earth", "moon", "mars", "jupiter", "saturn", "uranus"]) {
			const radii =
				defaultDistance(
					{ kind: "body", id },
					visibleFrame,
					45,
					PHONE.width / PHONE.height,
					unfolded,
				) / drawn(visibleFrame, id)
			const extent = Math.max(1, ringRatioOf(id))
			expect(outline(extent, radii)).toBeLessThanOrEqual(
				BODY_FIT_SHARE * halfBand * (1 + 1e-12),
			)
		}
	})

	it("shows the whole system over a third of an upright phone, inside the free band, in every preset", () => {
		const aspect = PHONE.width / PHONE.height
		const lift = pivotLift(folded)
		const neptune = getBody("neptune").orbit!
		for (const id of SCALE_PRESET_IDS) {
			const scale = SCALE_PRESETS[id]
			const distance = overviewDistance(scale, 45, aspect, folded)
			const orbit = toUnits(
				displayDistanceKm(
					neptune.semiMajorAxisKm,
					sun.radiusKm,
					sun.radiusKm,
					scale.orbitDistance,
				),
			)
			const elevation = UPRIGHT_HOME_SHOT.elevationDeg
			const orbits = circleBox(
				orbit,
				distance,
				elevation,
				PHONE.width,
				PHONE.height,
				lift,
			)
			expect(orbits.bottom - orbits.top, id).toBeGreaterThanOrEqual(
				PHONE.height / 3,
			)
			// the drawn system, the farthest disc included, in the band and across the width
			const system = circleBox(
				overviewRadius(scale),
				distance,
				elevation,
				PHONE.width,
				PHONE.height,
				lift,
			)
			expect(system.top, id).toBeGreaterThanOrEqual(folded.top * PHONE.height)
			expect(system.bottom, id).toBeLessThanOrEqual(
				(1 - folded.bottom) * PHONE.height,
			)
			expect(system.left, id).toBeGreaterThanOrEqual(0)
			expect(system.right, id).toBeLessThanOrEqual(PHONE.width)
		}
	})

	it("uses the height of an upright tablet too, with nothing covered", () => {
		const tablet = { width: 768, height: 1024 }
		for (const id of SCALE_PRESET_IDS) {
			const scale = SCALE_PRESETS[id]
			const distance = overviewDistance(scale, 45, tablet.width / tablet.height)
			const system = circleBox(
				overviewRadius(scale),
				distance,
				UPRIGHT_HOME_SHOT.elevationDeg,
				tablet.width,
				tablet.height,
			)
			expect(system.bottom - system.top, id).toBeGreaterThan(tablet.height / 2)
			expect(system.top, id).toBeGreaterThanOrEqual(0)
			expect(system.bottom, id).toBeLessThanOrEqual(tablet.height)
			expect(system.left, id).toBeGreaterThanOrEqual(0)
			expect(system.right, id).toBeLessThanOrEqual(tablet.width)
		}
	})
})
