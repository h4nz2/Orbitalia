/**
 * pnpm build:spacecraft: the curated catalogue data/spacecraft.json plus
 * trajectories from NASA/JPL Horizons -> src/data/spacecraft.json (issue #35).
 *
 * Needs the network the first time (Horizons API, public, no key); responses are
 * cached in node_modules/.cache/orbitalia-horizons, so reruns are offline. The
 * app itself never fetches anything: it ships the output as static JSON.
 *
 * For every craft:
 *  1. Daily heliocentric states over [dataFrom, dataTo].
 *  2. Planet neighbourhoods: where the craft comes within 1.5 Hill radii of a
 *     planet (found with the app's own planet model, then trimmed with the
 *     Horizons planet-centric states), the positions are kept relative to that
 *     planet (hourly, refined), so a flyby passes the drawn planet at its true
 *     distance in every scale preset. Inside 1 Hill radius only the planet
 *     segment is used; between 1 and 1.5 the app blends the two.
 *  3. Wherever the sampling is too coarse for the curvature of the path
 *     (a planet or the Sun swept by more than MAX_SWEEP_RAD per step), denser
 *     states are fetched, down to 1 minute.
 *  4. Samples that cubic Hermite interpolation rebuilds within the tolerance
 *     are dropped (scripts/lib/spacecraft/sampling.ts).
 *  5. Flybys of planets get their time and distance of closest approach
 *     from the data.
 * Check points (dropped states with their exact values) go to
 * src/data/spacecraftCheck.json for the unit tests.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import type { Body } from "../src/data/schema"
import {
	SpacecraftFile,
	TrajectoriesFile,
	type Spacecraft,
	type SpacecraftEvent,
	type TrajectorySegment,
} from "../src/data/spacecraftSchema"
import { propagateEcliptic, type Vec3 } from "../src/sim/kepler"
import { J2000_JD } from "../src/sim/time"

import { toJsonFile } from "./lib/json"
import {
	createHorizonsClient,
	type HorizonsClient,
} from "./lib/spacecraft/horizons"
import {
	coarseWindows,
	cutHoles,
	distanceAt,
	mergeSeries,
	pickSamples,
	runs,
	simplify,
	sliceSeries,
	speedAt,
	type StateSeries,
} from "./lib/spacecraft/sampling"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const paths = {
	catalogue: join(root, "data", "spacecraft.json"),
	bodies: join(root, "src", "data", "bodies.json"),
	out: join(root, "src", "data", "spacecraft.json"),
	trajectories: join(root, "src", "data", "spacecraftTrajectories.json"),
	check: join(root, "src", "data", "spacecraftCheck.json"),
	cache: join(root, "node_modules", ".cache", "orbitalia-horizons"),
}

/** Horizons centre codes: the Sun's and the planets' body centres. */
const CENTRES: Record<string, string> = {
	sun: "500@10",
	mercury: "500@199",
	venus: "500@299",
	earth: "500@399",
	mars: "500@499",
	jupiter: "500@599",
	saturn: "500@699",
	uranus: "500@799",
	neptune: "500@899",
}

/** A neighbourhood is 1 Hill radius (the planet alone) to 1.5 (blending into the Sun's frame). */
export const INNER_HILL = 1
export const OUTER_HILL = 1.5
/** Refine where the craft sweeps more than this angle around its centre per step. */
const MAX_SWEEP_RAD = 0.2
const MIN_STEP_MINUTES = 1
/** Interpolation tolerance: 1e-3 of the distance from the centre, at least 1 km. */
const REL_TOLERANCE = 1e-3
const ABS_TOLERANCE_KM = 1
const tolerance = (r: number): number =>
	Math.max(ABS_TOLERANCE_KM, REL_TOLERANCE * r)

const MINUTES_PER_DAY = 24 * 60

const out = (line: string): void => {
	process.stdout.write(`${line}\n`)
}
const err = (line: string): void => {
	process.stderr.write(`${line}\n`)
}

interface CatalogueCraft extends Omit<
	Spacecraft,
	"segments" | "events" | "orbits"
> {
	events: SpacecraftEvent[]
	centres: { center: string; from: string; to: string }[]
	orbits: Spacecraft["orbits"]
}

interface Catalogue {
	asOf: string
	craft: CatalogueCraft[]
}

const isoToJD = (iso: string): number =>
	J2000_JD + (Date.parse(iso) - Date.parse("2000-01-01T12:00:00Z")) / 86_400_000

const jdToIso = (jd: number): string =>
	new Date(
		Math.round((jd - J2000_JD) * 86_400_000) +
			Date.parse("2000-01-01T12:00:00Z"),
	)
		.toISOString()
		.replace(/:\d{2}\.\d{3}Z$/, "Z")

const bodies = JSON.parse(readFileSync(paths.bodies, "utf8")) as Body[]
const sunBody = bodies.find((body) => body.parentId === null)
if (sunBody === undefined || sunBody.massKg === null) throw new Error("no Sun")
const sunMass = sunBody.massKg
const planets = bodies.filter(
	(body) => body.parentId === sunBody.id && body.orbit !== null,
)

/** Hill radius (km) of a planet orbiting the Sun. */
const hillRadiusKm = (planet: Body): number => {
	const orbit = planet.orbit
	if (orbit === null || planet.massKg === null) return 0
	return (
		orbit.semiMajorAxisKm *
		(1 - orbit.eccentricity) *
		Math.cbrt(planet.massKg / (3 * sunMass))
	)
}

const modelPosition: Vec3 = { x: 0, y: 0, z: 0 }

/** The app's model distance (km) from the craft's heliocentric sample `k` to `planet`. */
function modelDistance(helio: StateSeries, k: number, planet: Body): number {
	propagateEcliptic(planet.orbit!, helio.jd[k], modelPosition)
	return Math.hypot(
		helio.p[k * 3] - modelPosition.x,
		helio.p[k * 3 + 1] - modelPosition.y,
		helio.p[k * 3 + 2] - modelPosition.z,
	)
}

/** The smallest step (minutes) between samples of `series` inside [from, to]. */
function stepInside(series: StateSeries, from: number, to: number): number {
	let step = Infinity
	for (let k = 0; k + 1 < series.jd.length; k++) {
		if (series.jd[k + 1] < from || series.jd[k] > to) continue
		step = Math.min(step, (series.jd[k + 1] - series.jd[k]) * MINUTES_PER_DAY)
	}
	return step
}

/** Fetches denser states wherever the sampling is too coarse, until it is not or the step is 1 minute. */
async function refine(
	client: HorizonsClient,
	command: string,
	center: string,
	series: StateSeries,
): Promise<StateSeries> {
	let current = series
	for (let level = 0; level < 6; level++) {
		let refined = false
		for (const [from, to] of coarseWindows(current, MAX_SWEEP_RAD)) {
			const step = stepInside(current, from, to)
			if (!(step > MIN_STEP_MINUTES)) continue
			// the worst sweep in the window decides how much finer to go
			let worst = 0
			for (let k = 0; k + 1 < current.jd.length; k++) {
				if (current.jd[k] < from || current.jd[k + 1] > to) continue
				const seconds = (current.jd[k + 1] - current.jd[k]) * 86400
				const speed = Math.max(speedAt(current, k), speedAt(current, k + 1))
				const r = Math.min(distanceAt(current, k), distanceAt(current, k + 1))
				worst = Math.max(worst, (speed * seconds) / r)
			}
			const factor = Math.min(60, Math.ceil((2 * worst) / MAX_SWEEP_RAD))
			const nextStep = Math.max(MIN_STEP_MINUTES, Math.floor(step / factor))
			const dense = await client.vectors({
				command,
				center,
				startJD: from,
				stopJD: to,
				stepMinutes: nextStep,
			})
			current = mergeSeries(current, dense)
			refined = true
		}
		if (!refined) break
	}
	return current
}

interface PlanetSegment {
	center: string
	blend: [number, number] | null
	series: StateSeries
	/** JD ranges where this segment alone places the craft (the Sun's segment has holes there). */
	holes: [number, number][]
}

function closestDistance(series: StateSeries): number {
	let best = Infinity
	for (let k = 0; k < series.jd.length; k++) {
		best = Math.min(best, distanceAt(series, k))
	}
	return best
}

/** Merges overlapping or touching JD windows. */
function mergeWindows(windows: [number, number][]): [number, number][] {
	const sorted = [...windows].sort((a, b) => a[0] - b[0])
	const merged: [number, number][] = []
	for (const [from, to] of sorted) {
		const last = merged[merged.length - 1]
		if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to)
		else merged.push([from, to])
	}
	return merged
}

async function planetSegments(
	client: HorizonsClient,
	craft: CatalogueCraft,
	helio: StateSeries,
	range: [number, number],
): Promise<PlanetSegment[]> {
	const segments: PlanetSegment[] = []
	const forced = craft.centres.map((c) => ({
		center: c.center,
		window: [
			Math.max(range[0], isoToJD(c.from)),
			Math.min(range[1], isoToJD(c.to)),
		] as [number, number],
	}))
	for (const { center, window } of forced) {
		const hourly = await client.vectors({
			command: craft.horizonsId,
			center: CENTRES[center],
			startJD: window[0],
			stopJD: window[1],
			stepMinutes: 60,
		})
		const series = await refine(
			client,
			craft.horizonsId,
			CENTRES[center],
			hourly,
		)
		segments.push({ center, blend: null, series, holes: [window] })
	}

	for (const planet of planets) {
		const hill = hillRadiusKm(planet)
		const inner = INNER_HILL * hill
		const outer = OUTER_HILL * hill
		// the model may be off by a few 0.1 degrees: search generously
		const search = 1.3 * outer + 5e5
		const near = runs(
			helio.jd.length,
			(k) => modelDistance(helio, k, planet) < search,
		).map(
			([a, b]) =>
				[
					Math.max(range[0], helio.jd[a] - 2),
					Math.min(range[1], helio.jd[b] + 2),
				] as [number, number],
		)
		for (const window of mergeWindows(near)) {
			// forced centres own their time range
			if (
				forced.some((f) => f.window[0] < window[1] && f.window[1] > window[0])
			) {
				continue
			}
			const hourly = await client.vectors({
				command: craft.horizonsId,
				center: CENTRES[planet.id],
				startJD: window[0],
				stopJD: window[1],
				stepMinutes: 60,
			})
			const n = hourly.jd.length
			const within = runs(n, (k) => distanceAt(hourly, k) < outer)
			if (within.length === 0) continue
			const first = Math.max(0, within[0][0] - 1)
			const last = Math.min(n - 1, within[within.length - 1][1] + 1)
			const series = await refine(
				client,
				craft.horizonsId,
				CENTRES[planet.id],
				sliceSeries(hourly, first, last),
			)
			const holes = runs(
				series.jd.length,
				(k) => distanceAt(series, k) < inner,
			).map(([a, b]) => [series.jd[a], series.jd[b]] as [number, number])
			segments.push({ center: planet.id, blend: [inner, outer], series, holes })
			out(
				`  ${planet.id}: ${jdToIso(series.jd[0])} .. ${jdToIso(series.jd[series.jd.length - 1])}, closest ${Math.round(closestDistance(series)).toLocaleString("en")} km`,
			)
		}
	}
	return segments
}

const round = (value: number, digits: number): number =>
	Number(value.toPrecision(digits))

/** Compact output form of a series. */
function toSegment(
	center: string,
	blend: [number, number] | null,
	series: StateSeries,
): TrajectorySegment {
	return {
		center,
		blend: blend === null ? null : [Math.round(blend[0]), Math.round(blend[1])],
		t: series.jd.map((jd) => Math.round((jd - J2000_JD) * 1e6) / 1e6),
		p: series.p.map((x) => round(x, 7)),
		v: series.v.map((x) => round(x, 6)),
	}
}

interface CheckPoint {
	craft: string
	segment: number
	/** days from J2000 */
	t: number
	p: [number, number, number]
	/** tolerance, km */
	tolKm: number
}

/** Closest approach to `center` within `series` near `jd` (±3 days), or null. */
function closestApproach(
	series: StateSeries,
	jd: number,
): { jd: number; distanceKm: number } | null {
	let best: { jd: number; distanceKm: number } | null = null
	for (let k = 0; k < series.jd.length; k++) {
		if (Math.abs(series.jd[k] - jd) > 3) continue
		const d = distanceAt(series, k)
		if (best === null || d < best.distanceKm)
			best = { jd: series.jd[k], distanceKm: d }
	}
	return best
}

async function buildCraft(
	client: HorizonsClient,
	craft: CatalogueCraft,
	checks: CheckPoint[],
): Promise<{ craft: Spacecraft; segments: TrajectorySegment[] }> {
	out(`${craft.name} (${craft.horizonsId})`)
	const range: [number, number] = [
		isoToJD(craft.dataFrom),
		isoToJD(craft.dataTo),
	]
	const daily = await client.vectors({
		command: craft.horizonsId,
		center: CENTRES.sun,
		startJD: range[0],
		stopJD: range[1],
		stepMinutes: MINUTES_PER_DAY,
	})
	const planetary = await planetSegments(client, craft, daily, range)

	// hourly Sun-centred states through every neighbourhood, so the Sun's
	// segment is right where it blends into a planet's
	let helio = daily
	for (const segment of planetary) {
		if (segment.blend === null) continue
		const from = segment.series.jd[0]
		const to = segment.series.jd[segment.series.jd.length - 1]
		helio = mergeSeries(
			helio,
			await client.vectors({
				command: craft.horizonsId,
				center: CENTRES.sun,
				startJD: from,
				stopJD: to,
				stepMinutes: 60,
			}),
		)
	}
	helio = await refine(client, craft.horizonsId, CENTRES.sun, helio)
	const helioPieces = cutHoles(
		helio,
		planetary.flatMap((segment) => segment.holes),
	)

	const all: {
		center: string
		blend: [number, number] | null
		series: StateSeries
	}[] = [
		...helioPieces.map((series) => ({ center: "sun", blend: null, series })),
		...planetary,
	].sort((a, b) => a.series.jd[0] - b.series.jd[0])

	const segments: TrajectorySegment[] = []
	let dense = 0
	let kept = 0
	for (const { center, blend, series } of all) {
		const keep = simplify(series, tolerance)
		dense += series.jd.length
		kept += keep.length
		const segment = toSegment(center, blend, pickSamples(series, keep))
		const index = segments.length
		segments.push(segment)
		// check points: dropped states spread over the segment
		const keptSet = new Set(keep)
		const dropped = [...series.jd.keys()].filter((k) => !keptSet.has(k))
		const count = Math.min(8, dropped.length)
		for (let c = 0; c < count; c++) {
			const k = dropped[Math.floor(((c + 0.5) * dropped.length) / count)]
			checks.push({
				craft: craft.id,
				segment: index,
				t: Math.round((series.jd[k] - J2000_JD) * 1e6) / 1e6,
				p: [series.p[k * 3], series.p[k * 3 + 1], series.p[k * 3 + 2]].map(
					(x) => round(x, 10),
				) as [number, number, number],
				tolKm: tolerance(distanceAt(series, k)),
			})
		}
	}

	// flybys of planets: time and distance of closest approach from the data
	const events = craft.events.map((event): SpacecraftEvent => {
		if (
			event.kind !== "flyby" ||
			event.target === undefined ||
			CENTRES[event.target] === undefined
		) {
			return event
		}
		const segment = planetary.find(
			(s) =>
				s.center === event.target &&
				s.series.jd[0] <= isoToJD(event.date) &&
				s.series.jd[s.series.jd.length - 1] >= isoToJD(event.date),
		)
		const approach =
			segment === undefined
				? null
				: closestApproach(segment.series, isoToJD(event.date))
		if (approach === null) {
			err(
				`  warning: no data for the ${event.kind} of ${event.target} on ${event.date}`,
			)
			return event
		}
		const shiftH = (approach.jd - isoToJD(event.date)) * 24
		if (Math.abs(shiftH) > 2) {
			err(
				`  note: ${event.target} closest approach ${jdToIso(approach.jd)} (catalogue ${event.date}, ${shiftH.toFixed(1)} h)`,
			)
		}
		return {
			...event,
			date: jdToIso(approach.jd),
			distanceKm: round(approach.distanceKm, 4),
		}
	})

	out(
		`  ${segments.length} segments, ${kept.toLocaleString("en")} of ${dense.toLocaleString("en")} states kept`,
	)
	const rest: Omit<CatalogueCraft, "centres"> & { centres?: unknown } = {
		...craft,
	}
	delete rest.centres
	return { craft: { ...rest, events }, segments }
}

async function main(): Promise<void> {
	const catalogue = JSON.parse(
		readFileSync(paths.catalogue, "utf8"),
	) as Catalogue
	const client = createHorizonsClient(paths.cache, err)
	const only = process.argv.slice(2)
	const checks: CheckPoint[] = []
	const craft: Spacecraft[] = []
	const trajectories: Record<string, TrajectorySegment[]> = {}
	for (const entry of catalogue.craft) {
		if (only.length > 0 && !only.includes(entry.id)) continue
		const built = await buildCraft(client, entry, checks)
		craft.push(built.craft)
		trajectories[entry.id] = built.segments
	}
	const file = SpacecraftFile.parse({
		source: {
			name: "NASA/JPL Horizons, spacecraft trajectories (reconstructed from tracking where flown, predicted beyond)",
			url: "https://ssd.jpl.nasa.gov/horizons/",
			frame:
				"geometric states, ecliptic and mean equinox of J2000, km and km/s; the app maps ecliptic (x, y, z) to scene (x, z, -y)",
			timeScale: "UT (UTC), days from J2000 = JD - 2451545",
			fetched: catalogue.asOf,
			tolerance: `cubic Hermite interpolation within max(${ABS_TOLERANCE_KM} km, ${REL_TOLERANCE} x distance from the segment centre) of the Horizons states`,
		},
		asOf: catalogue.asOf,
		craft,
	})
	writeFileSync(paths.out, toJsonFile(file))
	// compact: thousands of numbers would be one per line pretty-printed (listed in .prettierignore)
	const json = `${JSON.stringify(TrajectoriesFile.parse(trajectories))}\n`
	writeFileSync(paths.trajectories, json)
	writeFileSync(paths.check, `${JSON.stringify(checks)}\n`)
	out(
		`spacecraft.json: ${craft.length} craft; spacecraftTrajectories.json: ${(Buffer.byteLength(json) / 1024).toFixed(0)} KiB; ${client.fetched} Horizons requests`,
	)
}

main().catch((error: unknown) => {
	err(error instanceof Error ? (error.stack ?? error.message) : String(error))
	process.exit(1)
})
