/**
 * The quiet interface (#42; docs/ARCHITECTURE.md, "HUD layout"): the state of
 * the solar system's HUD itself, not of the scene.
 *
 * - `panel`: the dock's own panels (Layers, Scale, the spacecraft list). The
 *   tools with a store of their own (light, birthday, sky tonight, hunt) keep
 *   their `open` flag there; `features/solarSystem/dock/exclusive.ts` keeps
 *   every docked panel, of either kind, to one at a time.
 * - `cardExpanded`: the body card shows its full facts. It starts small (name
 *   and one sentence) and keeps the viewer's choice while the page is open.
 * - `cardClosedFor`: the body whose card the viewer closed; the camera stays
 *   put and the card stays away until another body is focused or selected.
 * - `cameraMoving`: the camera is being dragged, zoomed or flown right now;
 *   the secondary controls dim meanwhile (`camera/motion.ts` writes it).
 * - `sceneOn`: the scene has drawn its first frame (the camera rig sets it),
 *   so "at rest" means something (#62's gesture hint waits for it).
 *
 * Nothing here is in the URL: a link names a view, not how the controls sit.
 */
import { create } from "zustand"

/**
 * The dock's own panels; the other tools have their own stores. `tools` is
 * Tools as tiles, on a phone held upright (#62; elsewhere Tools is a menu).
 */
export type HudPanel = "layers" | "scale" | "spacecraft" | "tools"

export interface HudState {
	panel: HudPanel | null
	cardExpanded: boolean
	cardClosedFor: string | null
	cameraMoving: boolean
	sceneOn: boolean
	setPanel: (panel: HudPanel | null) => void
	/** Opens `panel`, or closes it when it is the one open. */
	togglePanel: (panel: HudPanel) => void
	setCardExpanded: (expanded: boolean) => void
	setCardClosedFor: (id: string | null) => void
	setCameraMoving: (moving: boolean) => void
	setSceneOn: (on: boolean) => void
}

export const useHudStore = create<HudState>()((set, get) => ({
	panel: null,
	cardExpanded: false,
	cardClosedFor: null,
	cameraMoving: false,
	sceneOn: false,
	setPanel: (panel) => set({ panel }),
	togglePanel: (panel) => set({ panel: get().panel === panel ? null : panel }),
	setCardExpanded: (cardExpanded) => set({ cardExpanded }),
	setCardClosedFor: (cardClosedFor) => {
		if (get().cardClosedFor !== cardClosedFor) set({ cardClosedFor })
	},
	setCameraMoving: (cameraMoving) => {
		if (get().cameraMoving !== cameraMoving) set({ cameraMoving })
	},
	setSceneOn: (sceneOn) => {
		if (get().sceneOn !== sceneOn) set({ sceneOn })
	},
}))

export default useHudStore
