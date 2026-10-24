/**
 * How big a spacecraft's model is drawn (issue #73, docs/ARCHITECTURE.md,
 * "Spacecraft", Models in the scene). Pure: numbers in, numbers out, no
 * three.js, so the rule is tested against every flyby and arrival in the
 * data (./modelSize.test.ts).
 *
 * A real craft is 3 to 30 m across. Even where the drawing is stretched most
 * (a planet's neighbourhood in Poster), a craft at its own size would be far
 * below a pixel, so the model is drawn larger on purpose, and the card says
 * by how much (`drawnFactor`).
 *
 * Two lengths of a model matter. Its longest (`sizeM`, boom tip to boom tip)
 * is what it must not exceed beside a planet or on the screen. Its core
 * (`coreShare` of that: the bus, the dish, the panels, where most of its
 * surface is) is what a person sees: Voyager drawn 48 px from boom tip to
 * boom tip is a 10 px dish on two hairlines. The rule, in order:
 *
 * 1. **A drawn length, not a pixel size:** the core is `MODEL_DRAWN_KM` drawn
 *    km, so dollying in makes it bigger, like everything else in the scene.
 * 2. **The chosen craft stays readable:** the core of the selected or
 *    followed craft is at least `MODEL_MIN_PX` on screen from the follow
 *    framing out, until the camera is so far off (more than `FLOOR_REACH`
 *    times the craft's drawn distance from the Sun) that it would rather be
 *    a diamond.
 * 3. **Beside a planet, never hiding one:** near a planet, a dwarf planet or
 *    a big moon (`sizeBodyReach`) the whole model is at most
 *    `MODEL_BODY_SHARE` of that body's drawn diameter, within
 *    `BODY_NEAR_RADII` of its drawn radii (a moon: `MOON_NEAR_RADII`, its own
 *    neighbourhood within its planet's); the limit fades out by twice that
 *    (no jump as a craft comes or goes). And what a flyby or an arrival in
 *    the data passes limits it however far it is drawn, within
 *    `PASSAGE_HOURS` of the event (#56 draws a moon's or Pluto's passage away
 *    from the drawn moon: Voyager 1 is drawn 42 Titan radii from Titan in
 *    Everything visible). This one wins over 2: at a closest approach the
 *    craft is clearly smaller than what it passes.
 * 4. **A cap:** the whole model never more than `MODEL_MAX_SHARE` of the
 *    shorter side of the screen, however close the camera.
 * 5. **Or a diamond:** a model whose core would be smaller than the diamond
 *    is not drawn (the 9 px diamond is), with a pixel of hysteresis; the
 *    chosen craft's model is drawn while the whole of it is at least twice
 *    the diamond (JWST beside Earth at L2, held small by rule 3, is still
 *    JWST).
 *
 * True scale never draws a model (`CraftModels.tsx`): there the craft would
 * be its true size, and true scale stays true.
 */
import { CRAFT_MARKER_SIZE_PX } from "./screen"

/** The core's drawn length when nothing else decides it, drawn km (`MODEL_MIN_PX` from 580,000 km on a laptop). */
export const MODEL_DRAWN_KM = 30_000
/** The selected or followed craft's core is at least this many px (#73: at the follow framing, on a laptop and a phone). */
export const MODEL_MIN_PX = 48
/** ... while the camera is within this many times the craft's drawn distance from the Sun; beyond, the floor fades. */
export const FLOOR_REACH = 2
/** The whole model is at most this share of the shorter side of the screen. */
export const MODEL_MAX_SHARE = 0.4
/** The whole model is at most this share of a nearby body's drawn diameter (seen beside it: under half its disc). */
export const MODEL_BODY_SHARE = 0.4
/**
 * The Sun, a planet or a dwarf planet limits the model within this many of
 * its drawn radii (centre to craft), less and less beyond, not at all from
 * twice as far: its drawn moon system, where Watch frames a passage.
 */
export const BODY_NEAR_RADII = 12
/**
 * A big moon limits it within this many of its radii: a craft passing it,
 * not one crossing its planet's system (the Galilean moons, drawn 20 times
 * their size, would shrink Voyager to a diamond all the way past Jupiter).
 */
export const MOON_NEAR_RADII = 3
/**
 * Moons and dwarf planets this big (true radius, km) limit the model:
 * places a craft visits (the Moon, the Galilean moons, Titan, Triton, Pluto),
 * not the moonlets it passes on the way (Phobos is drawn 250 times its size
 * in Everything visible, and would shrink Europa Clipper to a dot at Mars).
 */
export const SIZE_BODY_MIN_RADIUS_KM = 1000
/** A model whose core is this many px or more replaces the diamond ... */
export const MODEL_SHOW_PX = CRAFT_MARKER_SIZE_PX + 1
/** ... and gives way to it again below this. */
export const MODEL_HIDE_PX = CRAFT_MARKER_SIZE_PX
/** The chosen craft's model is drawn while the whole of it is this many px or more ... */
export const CHOSEN_SHOW_PX = 2 * CRAFT_MARKER_SIZE_PX
/** ... and gives way to the diamond below this. */
export const CHOSEN_HIDE_PX = CHOSEN_SHOW_PX - 1
/** The core's share of the longest length before the model has loaded and been measured (`coreShareOf`). */
export const DEFAULT_CORE_SHARE = 0.5

/**
 * How near (in its drawn radii) a body limits a model's size: the Sun and
 * the planets `BODY_NEAR_RADII`; dwarf planets and moons of
 * `SIZE_BODY_MIN_RADIUS_KM` or more `BODY_NEAR_RADII` and `MOON_NEAR_RADII`;
 * 0 for every other body.
 */
export function sizeBodyReach(body: {
	readonly kind: string
	readonly radiusKm?: number | null
}): number {
	if (body.kind === "star" || body.kind === "planet") return BODY_NEAR_RADII
	if ((body.radiusKm ?? 0) < SIZE_BODY_MIN_RADIUS_KM) return 0
	return body.kind === "moon" ? MOON_NEAR_RADII : BODY_NEAR_RADII
}

/**
 * The longest drawn length (km) a body of drawn radius `radiusKm` allows a
 * model whose craft is drawn `rho` of those radii from the body's centre:
 * `MODEL_BODY_SHARE` of its diameter up to `near` radii, then more and more
 * (continuously), and no limit from twice that on. While the craft passes it
 * in a flyby or arrival of the data (`passage`, `passageStrength`), at most
 * that share wherever it is drawn.
 */
export function bodyAllowsKm(
	radiusKm: number,
	rho: number,
	near = BODY_NEAR_RADII,
	passage = 0,
): number {
	if (!(radiusKm > 0)) return Infinity
	const share = MODEL_BODY_SHARE * 2 * radiusKm
	const passing = passage > 0 ? share / Math.min(1, passage) : Infinity
	if (!(rho < 2 * near)) return passing
	if (rho <= near) return share
	return Math.min(passing, share / (1 - (rho - near) / near))
}

/** A body that limits a model's size near it: its index among the bodies, and how near (`sizeBodyReach`). */
export interface SizeBody {
	readonly index: number
	readonly near: number
}

/** The bodies that limit a model's size near them (`sizeBodyReach` over 0), once per set of bodies. */
export const sizeBodiesOf = (
	bodies: readonly {
		readonly kind: string
		readonly radiusKm?: number | null
	}[],
): SizeBody[] =>
	bodies.flatMap((body, index) => {
		const near = sizeBodyReach(body)
		return near > 0 ? [{ index, near }] : []
	})

/**
 * A flyby or arrival of the data with a body to pass: the body, and the true
 * instant (JD) the craft passes it closest (Watch's `trueJD`: for a moon or
 * Pluto, whose model positions are not the real ones, hours off the
 * milestone's date). Worked out once by the scene and kept.
 */
export interface Passage {
	readonly body: number
	readonly trueJD: number
}

/** The drawn bodies, as the scene's SimFrame has them. */
export interface DrawnBodies {
	/** Each body's drawn centre, display km (x, y, z per body). */
	readonly displayKm: ArrayLike<number>
	/** Each body's drawn radius, km. */
	readonly displayRadiiKm: ArrayLike<number>
}

/** How many of its drawn radii body `i` is from `craftKm` (display km, centre to centre). */
function radiiAway(
	craftKm: ArrayLike<number>,
	drawn: DrawnBodies,
	i: number,
): number {
	const o = i * 3
	return (
		Math.hypot(
			craftKm[0] - drawn.displayKm[o],
			craftKm[1] - drawn.displayKm[o + 1],
			craftKm[2] - drawn.displayKm[o + 2],
		) / drawn.displayRadiiKm[i]
	)
}

/**
 * The smallest length (drawn km) the bodies round a craft drawn at `craftKm`
 * allow its model (`bodyAllowsKm`, rule 3): every body of `sizeBodies` by its
 * drawn distance, and the body of each of its `passages` however far that
 * is drawn, while the drawing shows the craft within `PASSAGE_HOURS` of the
 * closest approach: `phaseJD` is the true instant the drawing shows now
 * (`drawnPhaseAt`; in a passage's slow motion not the clock's; NaN for a
 * craft without passages). A body whose layer is off (`shown[index]` 0,
 * per body) limits nothing: it is not on screen to be hidden. Called every
 * frame for every craft on screen, so it allocates nothing.
 */
export function bodyLimitKm(
	craftKm: ArrayLike<number>,
	drawn: DrawnBodies,
	sizeBodies: readonly SizeBody[],
	shown: ArrayLike<number>,
	passages: readonly Passage[],
	phaseJD: number,
): number {
	let limit = Infinity
	for (let s = 0; s < sizeBodies.length; s++) {
		const { index: i, near } = sizeBodies[s]
		if (shown[i] !== 1) continue
		limit = Math.min(
			limit,
			bodyAllowsKm(drawn.displayRadiiKm[i], radiiAway(craftKm, drawn, i), near),
		)
	}
	for (let p = 0; p < passages.length; p++) {
		const { body, trueJD } = passages[p]
		const passage = passageStrength((phaseJD - trueJD) * 24)
		if (passage === 0 || shown[body] !== 1) continue
		limit = Math.min(
			limit,
			bodyAllowsKm(
				drawn.displayRadiiKm[body],
				radiiAway(craftKm, drawn, body),
				0,
				passage,
			),
		)
	}
	return limit
}

/** A flyby's or arrival's body limits the model within this many hours of the event, wherever it is drawn ... */
export const PASSAGE_HOURS = 2

/**
 * ... at full strength (1), then less and less, not at all from twice as
 * long: Voyager 1 meets Titan 18 hours before Saturn, Voyager 2 Triton 5
 * hours after Neptune. `hours` from the event, as the drawing shows the
 * craft (`drawnPhaseAt`: in a passage's slow motion not the clock's).
 */
export function passageStrength(hours: number): number {
	const away = Math.abs(hours)
	if (!(away < 2 * PASSAGE_HOURS)) return 0
	if (away <= PASSAGE_HOURS) return 1
	const t = (away - PASSAGE_HOURS) / PASSAGE_HOURS
	return 1 - t * t * (3 - 2 * t)
}

/** Where the model is seen from, and what limits it. */
export interface ModelView {
	/** Distance from the camera to the craft, drawn km. */
	depthKm: number
	/** Pixels per radian: the canvas's height over 2 tan(fov / 2), over the zoom (`pixelsPerUnit`). */
	focalPx: number
	/** The canvas's shorter side, px. */
	shortSidePx: number
	/** The model's core over its longest length (0..1]. */
	coreShare: number
	/** The selected or followed craft (rule 2). */
	chosen: boolean
	/** The craft's drawn distance from the Sun, km (rule 2's reach). */
	sunDistanceKm: number
	/** The smallest `bodyAllowsKm` of the bodies near it (Infinity for none). */
	bodyLimitKm: number
	/** Whether it was drawn as a model last frame (rule 5's hysteresis). */
	wasModel: boolean
}

export interface ModelSize {
	/** The model's longest drawn length, km. */
	lengthKm: number
	/** ... and how long that is on screen, px (seen broadside: its longest extent). */
	heightPx: number
	/** The core on screen, px. */
	corePx: number
	/** Drawn as a model (else the diamond). */
	model: boolean
}

/** The size rule (see the module comment), into `out`. */
export function modelSize(
	view: ModelView,
	out: ModelSize = { lengthKm: 0, heightPx: 0, corePx: 0, model: false },
): ModelSize {
	const pxPerKm = view.focalPx / Math.max(view.depthKm, 1e-9)
	const share = Math.min(1, Math.max(view.coreShare, 1e-3))
	let core = MODEL_DRAWN_KM * pxPerKm
	if (view.chosen) {
		const reach = Math.min(
			1,
			(FLOOR_REACH * view.sunDistanceKm) / Math.max(view.depthKm, 1e-9),
		)
		core = Math.max(core, MODEL_MIN_PX * reach * reach)
	}
	const px = Math.min(
		core / share,
		view.bodyLimitKm * pxPerKm,
		MODEL_MAX_SHARE * view.shortSidePx,
	)
	out.heightPx = px
	out.corePx = px * share
	out.lengthKm = px / pxPerKm
	out.model =
		out.corePx >= (view.wasModel ? MODEL_HIDE_PX : MODEL_SHOW_PX) ||
		(view.chosen &&
			out.heightPx >= (view.wasModel ? CHOSEN_HIDE_PX : CHOSEN_SHOW_PX))
	return out
}

/**
 * How many times bigger than it is the craft is drawn (#73, the card's
 * "Drawn about N times bigger"): its drawn length in true kilometres at its
 * place, which is the drawn length over `lengthScale` (drawn km per true km
 * round the craft, `craftLengthScale`), over its real size.
 */
export const drawnFactor = (
	lengthKm: number,
	lengthScale: number,
	sizeM: number,
): number => lengthKm / lengthScale / (sizeM / 1000)

/** A factor as people say a big one: two significant digits ("510,000", "37 billion"). */
export function roundDrawnFactor(factor: number): number {
	if (!Number.isFinite(factor) || factor <= 0) return 1
	const step = 10 ** (Math.floor(Math.log10(factor)) - 1)
	return Math.max(1, Math.round(factor / step) * step)
}

/**
 * A model's core over its longest length, from its triangles (centroid
 * distance from the bus centre, area weights): twice the distance within
 * which `CORE_AREA_SHARE` of its surface lies, over `sizeM`. Booms and
 * antennas are long and thin, panels and dishes are most of the surface.
 */
export const CORE_AREA_SHARE = 0.8

export function coreShareOf(
	distances: Float64Array,
	areas: Float64Array,
	sizeM: number,
): number {
	const order = Array.from(distances.keys()).sort(
		(a, b) => distances[a] - distances[b],
	)
	let total = 0
	for (const area of areas) total += area
	let sum = 0
	for (const i of order) {
		sum += areas[i]
		if (sum >= CORE_AREA_SHARE * total) {
			return Math.min(1, Math.max(0.05, (2 * distances[i]) / sizeM))
		}
	}
	return DEFAULT_CORE_SHARE
}
