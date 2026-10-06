/**
 * JPL Horizons API client for `pnpm build:spacecraft` (issue #35).
 *
 * Source: NASA/JPL Solar System Dynamics, Horizons system,
 * https://ssd.jpl.nasa.gov/horizons/ (API: https://ssd-api.jpl.nasa.gov/doc/horizons.html).
 * Public, no key. Only the build script talks to it; the app ships the result
 * as static JSON and never goes online.
 *
 * Every request asks for geometric state vectors (position and velocity, no
 * light-time correction) in the ecliptic and mean equinox of J2000, in km and
 * km/s, with UT time tags (the app's Julian Dates are UTC). Responses are cached
 * on disk (node_modules/.cache/orbitalia-horizons), so a rebuild is offline and
 * reproducible once fetched.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { emptySeries, mergeSeries, type StateSeries } from "./sampling"

export const HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api"

/** Horizons returns at most about 90,000 lines; requests are split well below that. */
export const MAX_STEPS_PER_REQUEST = 40_000

export interface VectorRequest {
	/** Target: a Horizons id such as "-31" (Voyager 1). */
	command: string
	/** Coordinate centre: "500@10" (the Sun's centre), "500@599" (Jupiter's centre), ... */
	center: string
	/** Julian Dates (UT). */
	startJD: number
	stopJD: number
	/** Step in minutes. */
	stepMinutes: number
}

/** JD (UT) as Horizons' "JD2451545.5" time syntax. */
const jdTime = (jd: number): string => `JD${jd.toFixed(8)}`

export function vectorUrl(request: VectorRequest): string {
	const params: Record<string, string> = {
		format: "text",
		COMMAND: `'${request.command}'`,
		OBJ_DATA: "'NO'",
		MAKE_EPHEM: "'YES'",
		EPHEM_TYPE: "'VECTORS'",
		CENTER: `'${request.center}'`,
		START_TIME: `'${jdTime(request.startJD)}'`,
		STOP_TIME: `'${jdTime(request.stopJD)}'`,
		STEP_SIZE: `'${Math.max(1, Math.round(request.stepMinutes))}m'`,
		TIME_TYPE: "'UT'",
		REF_PLANE: "'ECLIPTIC'",
		REF_SYSTEM: "'ICRF'",
		OUT_UNITS: "'KM-S'",
		VEC_TABLE: "'2'",
		VEC_CORR: "'NONE'",
		VEC_LABELS: "'NO'",
		CSV_FORMAT: "'YES'",
	}
	return `${HORIZONS_API}?${new URLSearchParams(params).toString()}`
}

/**
 * Parses the `$$SOE ... $$EOE` block of a CSV vector table
 * (`JDUT, calendar, X, Y, Z, VX, VY, VZ,`). Throws with Horizons' own message
 * when the response holds no ephemeris.
 */
export function parseVectors(text: string): StateSeries {
	const start = text.indexOf("$$SOE")
	const end = text.indexOf("$$EOE")
	if (start < 0 || end < 0) {
		const reason = text
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "" && !line.startsWith("API"))
			.slice(0, 3)
			.join(" / ")
		throw new Error(`Horizons returned no vectors: ${reason}`)
	}
	const series = emptySeries()
	for (const line of text.slice(start + 5, end).split("\n")) {
		const cells = line.split(",").map((cell) => cell.trim())
		if (cells.length < 8 || cells[0] === "") continue
		const values = [cells[0], ...cells.slice(2, 8)].map(Number)
		if (!values.every(Number.isFinite)) {
			throw new Error(`Horizons: unreadable line "${line}"`)
		}
		const [jd, x, y, z, vx, vy, vz] = values
		series.jd.push(jd)
		series.p.push(x, y, z)
		series.v.push(vx, vy, vz)
	}
	return series
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface HorizonsClient {
	/** State vectors over the request's range, fetched in as many pieces as needed. */
	vectors(request: VectorRequest): Promise<StateSeries>
	/** Requests that went to the network (not the cache). */
	readonly fetched: number
}

/** A caching client; `cacheDir` holds one file per request URL. */
export function createHorizonsClient(
	cacheDir: string,
	log: (line: string) => void = () => {},
): HorizonsClient {
	mkdirSync(cacheDir, { recursive: true })
	let fetched = 0

	const text = async (url: string): Promise<string> => {
		const file = join(
			cacheDir,
			`${createHash("sha256").update(url).digest("hex").slice(0, 32)}.txt`,
		)
		if (existsSync(file)) return readFileSync(file, "utf8")
		for (let attempt = 1; ; attempt++) {
			try {
				const response = await fetch(url)
				if (!response.ok) throw new Error(`HTTP ${response.status}`)
				const body = await response.text()
				// only complete answers are cached
				parseVectors(body)
				writeFileSync(file, body)
				fetched++
				// be gentle with a public service
				await sleep(300)
				return body
			} catch (error) {
				if (attempt >= 4) throw error
				log(`  retry ${attempt} after: ${(error as Error).message}`)
				await sleep(2000 * attempt)
			}
		}
	}

	return {
		async vectors(request) {
			const stepDays = request.stepMinutes / (24 * 60)
			const perRequest = MAX_STEPS_PER_REQUEST * stepDays
			let series = emptySeries()
			for (let from = request.startJD; from < request.stopJD;) {
				const to = Math.min(request.stopJD, from + perRequest)
				const piece = parseVectors(
					await text(vectorUrl({ ...request, startJD: from, stopJD: to })),
				)
				series = mergeSeries(series, piece)
				from = to
			}
			return series
		},
		get fetched() {
			return fetched
		},
	}
}
