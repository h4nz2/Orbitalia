/**
 * How each craft is drawn, readable from the page (issue #73), the way the
 * names' `data-visible` is: a hidden `<span data-craft-model={id}>` per craft
 * in the label layer (./SpacecraftLabelLayer.tsx) carries `data-state`
 * ("model", "loading" while its file is on the way or its shaders compile,
 * else "diamond"), `data-px`, the model's height on screen, and
 * `data-core-px`, its core's. Written by ./CraftModels.tsx when it changes,
 * a few times a second at most, never through React. For tests and tooling,
 * not for app code.
 */
export type CraftModelState = "model" | "loading" | "diamond"

/** The probes are written at most this often, ms: a few times a second, not every frame of a zoom. */
export const PROBE_WRITE_MS = 250

/** What a craft's probe says (or is about to: `dirty`), kept per craft and changed in place. */
interface Report {
	state: CraftModelState
	px: number
	corePx: number
	/** Changed since its probe was last written ... */
	dirty: boolean
	/** ... at this time (`performance.now()`, ms). */
	writtenMs: number
}

const probes = new Map<string, HTMLElement>()
const reported = new Map<string, Report>()

const write = (element: HTMLElement, report: Report) => {
	element.dataset.state = report.state
	element.dataset.px = String(report.px)
	element.dataset.corePx = String(report.corePx)
}

const reportOf = (id: string): Report => {
	let report = reported.get(id)
	if (report === undefined) {
		report = {
			state: "diamond",
			px: 0,
			corePx: 0,
			dirty: false,
			writtenMs: Number.NEGATIVE_INFINITY,
		}
		reported.set(id, report)
	}
	return report
}

/** Registers (or, with null, forgets) the probe of craft `id`. */
export function attachModelProbe(id: string, element: HTMLElement | null) {
	if (element === null) {
		probes.delete(id)
		return
	}
	probes.set(id, element)
	write(element, reportOf(id))
}

/**
 * Records how craft `id` is drawn now: `heightPx` the whole model and
 * `corePx` its core on screen (rounded; 0 as a diamond). Called every frame;
 * touches the DOM only after a change, and at most every `PROBE_WRITE_MS`
 * (the latest values then: `data-state`, `data-px`, `data-core-px`).
 */
export function reportCraftModel(
	id: string,
	state: CraftModelState,
	heightPx: number,
	corePx: number,
	nowMs: number,
): void {
	const report = reportOf(id)
	const px = state === "diamond" ? 0 : Math.round(heightPx)
	const core = state === "diamond" ? 0 : Math.round(corePx)
	if (report.state !== state || report.px !== px || report.corePx !== core) {
		report.state = state
		report.px = px
		report.corePx = core
		report.dirty = true
	}
	if (!report.dirty || nowMs - report.writtenMs < PROBE_WRITE_MS) return
	report.dirty = false
	report.writtenMs = nowMs
	const element = probes.get(id)
	if (element !== undefined) write(element, report)
}
