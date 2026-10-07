/**
 * Search params of `/solar_system?focus=io&at=<x_y_z>&sel=europa&frame=io&cam=<az_el_dist>&t=<jd>&warp=<n>&moons=false&scale=trueScale`
 * (`craft=voyager1&follow=true` while following a spacecraft, #57)
 * (the layer switches `orbits`, `labels`, `moons`, `markers` alike; `paused`,
 * `present`, `contrast` for #29).
 *
 * Kept free of app imports (only zod) because the route module that validates
 * the URL is loaded eagerly with the route tree; the store and the data stay in
 * the page's code-split chunk. Invalid values fall back to "absent" instead of
 * breaking the page, like the dictionary route does.
 */
import { z } from "zod"

/**
 * What may become a URL number: numbers (the router already JSON-parses
 * numeric params) and non-blank strings. Everything else (`?t=`, `?t=null`,
 * `?t=true`) is absent; `z.coerce` alone would turn those into 0 or 1.
 */
const urlNumber = (value: unknown): unknown =>
	typeof value === "number" ||
	(typeof value === "string" && value.trim() !== "")
		? value
		: undefined

const layerSwitch = z.boolean().optional().catch(undefined)

export const simSearchSchema = z.object({
	// focused body id (absent: the overview); unknown ids are ignored when applied (see urlSync.ts)
	focus: z.string().optional().catch(undefined),
	// a free centre (#15): the offset from `focus` in its true radii, `x_y_z` (see formatOffset in navigation.ts)
	at: z.string().optional().catch(undefined),
	// selected body id when it is not the focused body
	sel: z.string().optional().catch(undefined),
	// the body held still (#31): the frame is anchored to the focus (absent: Sun-centred)
	frame: z.string().optional().catch(undefined),
	// camera around the view, `azimuth_elevation_distance` (see formatShot in navigation.ts)
	cam: z.string().optional().catch(undefined),
	// simulation time as a Julian Date (zod 4 already rejects NaN and +-Infinity)
	t: z.preprocess(urlNumber, z.coerce.number().optional()).catch(undefined),
	// simulated seconds per real second; negative runs the clock backwards,
	// 0 is dropped (pausing is its own state and never reaches the URL)
	warp: z
		.preprocess(
			urlNumber,
			z.coerce
				.number()
				.refine((warp) => warp !== 0)
				.optional(),
		)
		.catch(undefined),
	// the layer switches (LAYER_PARAMS in urlSync.ts); only `false` is ever
	// written, on is the default
	orbits: layerSwitch,
	labels: layerSwitch,
	moons: layerSwitch,
	markers: layerSwitch,
	// orbit names (#20) are off by default, so only `true` is ever written
	orbitNames: layerSwitch,
	// the small bodies (#23) are off by default, so only `true` is ever written
	smallBodies: layerSwitch,
	// every moon, not only the featured ones (#17): off by default, so only `true` is ever written
	allMoons: layerSwitch,
	// the scale preset (#21), a preset id of src/sim/scale.ts; absent is the
	// default (Everything visible), unknown ids are ignored when applied
	scale: z.string().optional().catch(undefined),
	// `?birthday=true` opens the birthday panel (#26) on arrival; it is only an
	// instruction and never carries a date (a birth date never enters the URL)
	birthday: z.boolean().optional().catch(undefined),
	// `?sky=true` opens "What is in the sky tonight" (#36) on arrival; only an
	// instruction: the place is never in the URL
	sky: z.boolean().optional().catch(undefined),
	// presentation mode (#29): `present=true` opens in projector mode,
	// `contrast=high` with high contrast, `paused=true` with the clock stopped
	// (see src/store/presentation.ts); only the non-default value is written
	present: layerSwitch,
	contrast: z.enum(["high"]).optional().catch(undefined),
	paused: layerSwitch,
	// `?light=flash` sends a flash of light from the Sun on arrival, `delay` and
	// `beyond` open the light panel on that tab (#27, the help page's links, #43);
	// only an instruction, never written back
	light: z.enum(["flash", "delay", "beyond"]).optional().catch(undefined),
	// `?intro=play` plays the opening (#30) again on arrival (the help page's
	// link, #43); only an instruction, never written back
	intro: z.literal("play").optional().catch(undefined),
	// `?look=play` plays the quick look (#44) on arrival (the help page's link);
	// only an instruction, never written back
	look: z.literal("play").optional().catch(undefined),
	// `?craft=<spacecraft id>` selects that spacecraft (#35) and flies to it on
	// arrival (the help page's link, #43); only an instruction, never written
	// back. With `follow=true` (#57) the camera follows it: that is the view
	// itself, written while following (`focus` then names the neighbourhood it
	// is in, so the scene opens there before the trajectories have loaded)
	craft: z.string().optional().catch(undefined),
	follow: layerSwitch,
	// the scavenger hunt (#34): `true` opens the chooser, a hunt id or question
	// ids joined by "." play that hunt (resolveHunt in features/solarSystem/hunt);
	// kept on every navigation of the page (the route's retainSearchParams)
	hunt: z
		.union([z.literal(true), z.string().trim().min(1)])
		.optional()
		.catch(undefined),
	// a guided tour (#28): the tour's id, the stop counted from 1, and autoplay;
	// unknown tours are ignored when applied (features/solarSystem/tours)
	tour: z.string().optional().catch(undefined),
	stop: z
		.preprocess(urlNumber, z.coerce.number().int().positive().optional())
		.catch(undefined),
	autoplay: z.boolean().optional().catch(undefined),
})

export type SimSearch = z.output<typeof simSearchSchema>
