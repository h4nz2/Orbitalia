/**
 * Mirrors the simulation store into the `/solar_system` URL and back.
 *
 * On mount the validated search params (`focus`, `at`, `sel`, `cam`, `t`,
 * `warp`, the layer switches `orbits`, `labels`, `moons`, `markers` and the
 * scale preset `scale`; #29's `paused`, `present` and `contrast`) seed the store: the view (`focus`: a body, with `at`
 * a point in space near it, absent: the overview) and its camera shot are
 * applied as a jump, so a shared link opens exactly on the view it was taken
 * from. From then on view, selection, camera shot, warp, the layer switches
 * and the scale preset are written to the URL
 * as they change (the shot when the camera comes to rest) and the simulation
 * time follows at most once per second, and only while it is slow enough to
 * be worth a link (paused or |warp| <= 1 min/s).
 *
 * A step (#46: choosing a body, the way out, a tour stop, ...; see
 * ./viewHistory.ts) is written once, at its end, as a new history entry;
 * everything else rewrites the entry on screen (`replace: true`), so the
 * history holds the steps and nothing else. The browser's back and forward
 * between two entries of the solar system go to the entry's view (flying),
 * through the view history.
 *
 * The store is watched through `useSimStore.subscribe`, not selectors: the
 * component calling this hook must not re-render at the clock's rate.
 */
import { useEffect, useLayoutEffect, useRef } from "react"
import {
	defaultParseSearch,
	useNavigate,
	useRouter,
	useSearch,
	type HistoryState,
} from "@tanstack/react-router"

import { bodyById } from "@/data"
import { spacecraftById } from "@/data/spacecraft"
import {
	DEFAULT_SCALE_PRESET,
	dateToJD,
	isScalePresetId,
	type ScalePresetId,
} from "@/sim"

import {
	HOME_SHOT,
	OVERVIEW,
	followedCraftId,
	formatOffset,
	formatShot,
	isFrameAnchored,
	OVERVIEW_BODY_ID,
	parseOffset,
	parseShot,
	sameShot,
	viewBodyId,
	type CameraShot,
	type View,
} from "./navigation"
import { hidesTimeInUrl, useBirthdayStore } from "./birthday"
import {
	presentationFromSearch,
	presentationSearch,
	samePresentationSearch,
	usePresentationStore,
} from "./presentation"
import { isListedTour, tourSearch, useTourStore, type TourSearch } from "./tour"
import { useScaleStore } from "./scale"
import { useSimStore, type SimState } from "./sim"
import { simSearchSchema, type SimSearch } from "./simSearch"
import { useSpacecraftStore } from "./spacecraft"
import {
	arrive,
	createRecorder,
	setHistoryBack,
	waypointOf,
	type Waypoint,
} from "./viewHistory"

/** Minimum spacing between two writes of `t` into the URL. */
export const TIME_SYNC_INTERVAL_MS = 1000
/** `t` is mirrored only while paused or at most at this speed (1 min/s, either direction). */
export const TIME_SYNC_MAX_WARP = 60
/** Warp written to the URL at this value is omitted (the default). */
export const DEFAULT_TIME_WARP = 1

/** Julian Date rounded to 4 decimals (about 9 s), the precision the URL carries. */
export const roundJD = (jd: number): number => Math.round(jd * 1e4) / 1e4

export const shouldMirrorTime = (paused: boolean, timeWarp: number): boolean =>
	paused || Math.abs(timeWarp) <= TIME_SYNC_MAX_WARP

/**
 * The layer switches a link carries: search param and store field. Every
 * switch is on by default, so only `false` is ever written.
 */
export const LAYER_PARAMS = [
	["orbits", "showOrbits"],
	["labels", "showLabels"],
	["moons", "showMoons"],
	["markers", "showMarkers"],
] as const

type LayerField =
	| (typeof LAYER_PARAMS)[number][1]
	| "showOrbitLabels"
	| "showSmallBodies"
	| "showAllMoons"
type Layers = Pick<SimState, LayerField>

// the orbit names, the long tail of moons and the small bodies (all off by default) may be left out
type Mirrored = Omit<
	Layers,
	"showOrbitLabels" | "showSmallBodies" | "showAllMoons"
> &
	Partial<
		Pick<Layers, "showOrbitLabels" | "showSmallBodies" | "showAllMoons">
	> &
	Pick<
		SimState,
		"view" | "selectedId" | "shot" | "timeWarp" | "paused" | "simTimeJD"
	> &
	Partial<Pick<SimState, "frameId">> & {
		/** The chosen scale preset (#21, `useScaleStore`'s `targetId`); absent or null writes nothing. */
		scalePreset?: ScalePresetId | null
		/** The guided tour in progress (#28), see `tourSearch` in ./tour.ts. */
		tour?: TourSearch
	}

type MirroredClock = Pick<SimState, "timeWarp" | "simTimeJD">

/**
 * The search params that mirror `state`, starting from `previous` so a `t` that
 * is not being mirrored right now (fast warp) keeps its last written value.
 * Defaults (the overview, the home camera, a selection equal to the focus,
 * 1x, a layer switch that is on) are left out to keep the URL short. A point
 * view (the pivot moved into empty space, #15) is its anchor in `focus` and
 * its offset in `at`, in true radii of the anchor (scale free); following a
 * spacecraft (#57) is `craft=<id>&follow=true`, with the neighbourhood it is
 * in as `focus`. The warp is
 * written as it is (not rounded), so a link runs at exactly the speed it was
 * taken at,
 * backwards included; a zero warp (which the schema rejects) is left out.
 * With `hideTime` (a birth date is entered, #26) no `t` is written at all, so
 * a copied link opens on "now" and never carries someone's birthday.
 */
export function searchFromState(
	state: Mirrored,
	previous: SimSearch,
	hideTime = false,
): SimSearch {
	const { timeWarp, view, shot } = state
	const focus = view.kind === "overview" ? undefined : viewBodyId(view)
	const anchor = view.kind === "point" ? bodyById.get(view.anchorId) : undefined
	const craft = followedCraftId(view) ?? undefined
	const search: SimSearch = {
		focus,
		craft,
		follow: craft === undefined ? undefined : true,
		at:
			view.kind === "point" && anchor !== undefined
				? formatOffset(view.offsetKm, anchor.radiusKm)
				: undefined,
		sel:
			state.selectedId !== null && state.selectedId !== focus
				? state.selectedId
				: undefined,
		cam:
			shot === null || sameShot(shot, HOME_SHOT) ? undefined : formatShot(shot),
		frame:
			state.frameId !== undefined && isFrameAnchored({ frameId: state.frameId })
				? state.frameId
				: undefined,
		t: hideTime
			? undefined
			: shouldMirrorTime(state.paused, timeWarp)
				? roundJD(state.simTimeJD)
				: previous.t,
		warp:
			timeWarp !== 0 && timeWarp !== DEFAULT_TIME_WARP ? timeWarp : undefined,
	}
	for (const [param, field] of LAYER_PARAMS) {
		search[param] = state[field] ? undefined : false
	}
	search.orbitNames = state.showOrbitLabels ? true : undefined
	search.smallBodies = state.showSmallBodies ? true : undefined
	search.allMoons = state.showAllMoons ? true : undefined
	search.scale =
		state.scalePreset != null && state.scalePreset !== DEFAULT_SCALE_PRESET
			? state.scalePreset
			: undefined
	search.tour = state.tour?.tour
	search.stop = state.tour?.stop
	search.autoplay = state.tour?.autoplay
	return search
}

export const sameSearch = (a: SimSearch, b: SimSearch): boolean =>
	a.focus === b.focus &&
	a.craft === b.craft &&
	a.follow === b.follow &&
	a.at === b.at &&
	a.sel === b.sel &&
	a.frame === b.frame &&
	a.cam === b.cam &&
	a.t === b.t &&
	a.warp === b.warp &&
	a.orbitNames === b.orbitNames &&
	a.smallBodies === b.smallBodies &&
	a.allMoons === b.allMoons &&
	a.scale === b.scale &&
	a.tour === b.tour &&
	a.stop === b.stop &&
	a.autoplay === b.autoplay &&
	LAYER_PARAMS.every(([param]) => a[param] === b[param])

/**
 * The view a search describes: a spacecraft followed (`craft` with
 * `follow=true`, #57), `focus` (a known body; with a valid `at`, a point near
 * it) or the overview, its camera and selection.
 */
export function viewFromSearch(search: SimSearch): {
	view: View
	shot: CameraShot | null
	selectedId: string | null
} {
	const focus =
		search.focus !== undefined && bodyById.has(search.focus)
			? search.focus
			: null
	const sel =
		search.sel !== undefined && bodyById.has(search.sel) ? search.sel : null
	if (
		search.follow === true &&
		search.craft !== undefined &&
		spacecraftById.has(search.craft)
	) {
		return {
			view: {
				kind: "craft",
				id: search.craft,
				anchorId: focus ?? OVERVIEW_BODY_ID,
			},
			shot: parseShot(search.cam),
			selectedId: sel,
		}
	}
	const anchor = focus === null ? undefined : bodyById.get(focus)
	const offsetKm =
		anchor === undefined ? null : parseOffset(search.at, anchor.radiusKm)
	const view: View =
		focus === null
			? OVERVIEW
			: offsetKm === null
				? { kind: "body", id: focus }
				: { kind: "point", anchorId: focus, offsetKm }
	return {
		view,
		shot: parseShot(search.cam),
		// a focused body is selected unless the link selects something else;
		// a point in space selects nothing by itself
		selectedId: sel ?? (view.kind === "body" ? focus : null),
	}
}

/**
 * The body a search holds still (#31): with a known `frame` other than the
 * Sun, the focus (an anchored frame follows it), or `frame` itself when the
 * link has no focus; null for the Sun-centred frame.
 */
export function frameFromSearch(search: SimSearch): string | null {
	const { frame } = search
	if (
		frame === undefined ||
		frame === OVERVIEW_BODY_ID ||
		!bodyById.has(frame)
	) {
		return null
	}
	const focus =
		search.focus !== undefined && bodyById.has(search.focus)
			? search.focus
			: null
	return focus ?? frame
}

/**
 * The waypoint of an address (#46): an entry of the history the view history
 * has no record of (one of an earlier visit, before a reload). A menu tour's
 * or a sky event's stop, else the view, its camera, frame and selection.
 */
export function waypointFromSearch(search: SimSearch): Waypoint {
	if (search.tour !== undefined && isListedTour(search.tour)) {
		return {
			kind: "tourStop",
			tour: { id: search.tour, index: Math.max(0, (search.stop ?? 1) - 1) },
		}
	}
	const { view, shot, selectedId } = viewFromSearch(search)
	if (view.kind === "craft") return { kind: "follow", craftId: view.id, shot }
	return {
		kind: "view",
		view,
		shot,
		frameId: frameFromSearch(search) ?? OVERVIEW_BODY_ID,
		selectedId,
		craftId: null,
		tour: null,
	}
}

/** The scene as the view history keeps it (#46). */
const currentWaypoint = (): Waypoint =>
	waypointOf(
		useSimStore.getState(),
		useTourStore.getState(),
		useSpacecraftStore.getState().selectedCraftId,
	)

/**
 * The layer switches a search sets: a switch the link leaves out is on, except
 * the orbit names, all moons (#17) and the small bodies (#23), which are off unless the link turns them on.
 */
export const layersFromSearch = (search: SimSearch): Layers => ({
	...(Object.fromEntries(
		LAYER_PARAMS.map(([param, field]) => [field, search[param] ?? true]),
	) as Omit<Layers, "showOrbitLabels" | "showSmallBodies" | "showAllMoons">),
	showOrbitLabels: search.orbitNames === true,
	showSmallBodies: search.smallBodies === true,
	showAllMoons: search.allMoons === true,
})

/** The scale preset a search opens in: `scale` when it names a preset, else the default. */
export const scaleFromSearch = (search: SimSearch): ScalePresetId =>
	isScalePresetId(search.scale) ? search.scale : DEFAULT_SCALE_PRESET

/** Clock fields a search sets; absent params are skipped. */
export function stateFromSearch(search: SimSearch): Partial<MirroredClock> {
	const next: Partial<MirroredClock> = {}
	if (search.t !== undefined && Number.isFinite(search.t)) {
		next.simTimeJD = search.t
	}
	if (search.warp !== undefined && Number.isFinite(search.warp)) {
		next.timeWarp = search.warp
	}
	return next
}

/**
 * The store fields the page seeds on mount: the search params, and the wall
 * clock when the URL carries no `t`. The store module may have been evaluated
 * long before the page appears (route preloading, an earlier visit) and the
 * clock stands still while the scene is unmounted, so a link without `t`
 * means "now", not "whenever the chunk loaded".
 */
export function mountState(
	search: SimSearch,
	now: Date = new Date(),
): Partial<MirroredClock> {
	const next = stateFromSearch(search)
	if (next.simTimeJD === undefined) next.simTimeJD = dateToJD(now)
	return next
}

/** Two-way sync between `useSimStore` and the `/solar_system` search params. Call it once, in the page. */
export function useSimUrlSync(): void {
	const search = useSearch({ from: "/solar_system" })
	const navigate = useNavigate()
	const router = useRouter()
	// the URL as last seen (rendered or written by us); a ref so the sync effect never re-runs
	const searchRef = useRef<SimSearch>(search)
	useEffect(() => {
		searchRef.current = search
	}, [search])

	useLayoutEffect(() => {
		// URL -> store, once; the view is a jump since the page is just appearing.
		// Time goes through the clock actions (issue #9), never a bare setState.
		const { simTimeJD, timeWarp } = mountState(searchRef.current)
		const store = useSimStore.getState()
		if (timeWarp !== undefined) store.setTimeWarp(timeWarp)
		// #29: a prepared lesson opens paused where it was paused (before the
		// jump, or the clock runs on at the link's speed for an instant)
		if (searchRef.current.paused === true) store.setPaused(true)
		if (simTimeJD !== undefined) store.setSimTime(simTimeJD)
		const { view, shot, selectedId } = viewFromSearch(searchRef.current)
		const frameId = frameFromSearch(searchRef.current)
		store.jumpTo(view, shot)
		if (frameId !== null && view.kind !== "craft") {
			store.anchorFrame(frameId, { shot: shot ?? undefined, durationMs: 0 })
		}
		store.select(selectedId)
		// following a spacecraft (#57): its card is the one shown
		if (view.kind === "craft") {
			useSpacecraftStore.getState().selectCraft(view.id)
		}
		// the layer switches are plain fields
		useSimStore.setState(layersFromSearch(searchRef.current))
		// the scale: a jump as well, the switch animates only when the user makes it
		useScaleStore.getState().setPreset(scaleFromSearch(searchRef.current))
		// #29: the presentation settings, and the link as the start of the lesson
		usePresentationStore.setState(presentationFromSearch(searchRef.current))
		usePresentationStore.getState().setStartSearch(searchRef.current)

		let timer: ReturnType<typeof setTimeout> | undefined
		/** Writes the store into the URL: in place, or as a new history entry for a step (#46). */
		const write = (push = false) => {
			// a step is written once, at its end, so the entry it leaves stays as it was
			if (!push && recorder.holds()) return
			const sim = useSimStore.getState()
			const next = {
				...searchFromState(
					{
						...sim,
						scalePreset: useScaleStore.getState().targetId,
						tour: tourSearch(useTourStore.getState(), isListedTour),
					},
					searchRef.current,
					hidesTimeInUrl(useBirthdayStore.getState()),
				),
				...presentationSearch({
					...usePresentationStore.getState(),
					paused: sim.paused,
				}),
			}
			if (
				!push &&
				sameSearch(next, searchRef.current) &&
				samePresentationSearch(next, searchRef.current)
			) {
				return
			}
			searchRef.current = next
			void navigate({
				to: "/solar_system",
				search: next,
				replace: !push,
				// a step that changes nothing the address shows (a spacecraft chosen)
				// is still an entry of its own: its state tells it apart
				...(push
					? {
							state: (previous: HistoryState) => ({
								...previous,
								orbitaliaStep: sim.step,
							}),
						}
					: {}),
			})
		}

		// the view history (#46): steps become entries, back and forward go to them
		const history = router.history
		const solarSystemPath = history.location.pathname
		const recorder = createRecorder({
			now: currentWaypoint,
			write,
			arrive: (recorded) => {
				const arrived = simSearchSchema.parse(
					defaultParseSearch(history.location.search),
				)
				searchRef.current = arrived
				arrive(recorded ?? waypointFromSearch(arrived))
				write()
			},
		})
		recorder.open(
			history.location.state.__TSR_index,
			history.location.state.key,
		)
		const unsubscribeHistory = history.subscribe(({ location, action }) =>
			recorder.note({
				action: action.type,
				index: location.state.__TSR_index,
				key: location.state.key,
				solarSystem: location.pathname === solarSystemPath,
			}),
		)
		const unsubscribeStep = useSimStore.subscribe((state, previous) => {
			if (state.step !== previous.step) recorder.step()
		})
		setHistoryBack(() => history.back())

		// store -> URL: view, selection, camera, warp, pause and layer changes right
		// away (a pause also pins `t`); the running clock at most once per TIME_SYNC_INTERVAL_MS
		const unsubscribe = useSimStore.subscribe((state, previous) => {
			if (
				state.view !== previous.view ||
				state.frameId !== previous.frameId ||
				state.selectedId !== previous.selectedId ||
				state.shot !== previous.shot ||
				state.timeWarp !== previous.timeWarp ||
				state.paused !== previous.paused ||
				LAYER_PARAMS.some(([, field]) => state[field] !== previous[field]) ||
				state.showOrbitLabels !== previous.showOrbitLabels ||
				state.showSmallBodies !== previous.showSmallBodies ||
				state.showAllMoons !== previous.showAllMoons
			) {
				write()
				return
			}
			if (
				state.simTimeJD !== previous.simTimeJD &&
				timer === undefined &&
				shouldMirrorTime(state.paused, state.timeWarp)
			) {
				timer = setTimeout(() => {
					timer = undefined
					write()
				}, TIME_SYNC_INTERVAL_MS)
			}
		})
		// the chosen preset goes into the URL at the click, not when the animation lands
		const unsubscribeScale = useScaleStore.subscribe((state, previous) => {
			if (state.targetId !== previous.targetId) write()
		})
		// a tour starting, moving to another stop, or ending (#28)
		const unsubscribeTour = useTourStore.subscribe((state, previous) => {
			if (
				state.tour !== previous.tour ||
				state.index !== previous.index ||
				state.auto !== previous.auto
			) {
				write()
			}
		})
		// entering or forgetting a birth date takes `t` out of the URL or puts it back
		const unsubscribeBirthday = useBirthdayStore.subscribe(
			(state, previous) => {
				if (hidesTimeInUrl(state) !== hidesTimeInUrl(previous)) write()
			},
		)
		// the presentation settings (#29)
		const unsubscribePresentation = usePresentationStore.subscribe(
			(state, previous) => {
				if (
					state.presenting !== previous.presenting ||
					state.highContrast !== previous.highContrast
				) {
					write()
				}
			},
		)
		write()

		return () => {
			unsubscribe()
			unsubscribeHistory()
			unsubscribeStep()
			recorder.dispose()
			setHistoryBack(null)
			unsubscribeScale()
			unsubscribeTour()
			unsubscribeBirthday()
			unsubscribePresentation()
			if (timer !== undefined) clearTimeout(timer)
		}
	}, [navigate, router])
}

export default useSimUrlSync
