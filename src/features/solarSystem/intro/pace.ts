/**
 * The opening at the viewer's own pace (#49): the keys and the tap that pause
 * and step it, installed on the window by IntroController. Both listen in the
 * capture phase, so while the opening plays they come first: Space pauses the
 * opening, not the clock underneath (ui/TimeControls), the arrows step its
 * beats instead of cycling the focus (ui/FocusPicker), and a tap on the scene
 * pauses instead of picking a body or letting go of one (scene/BodyPicking).
 * A drag is never a tap: it still takes the camera.
 */
import { isTapClick } from "../scene/tap"
import {
	hasModifier,
	isActivatableTarget,
	isArrowWidgetTarget,
	isEditableTarget,
} from "../ui/keyboard"
import {
	nextBeat,
	previousBeat,
	toggleIntroPause,
	useIntroStore,
} from "./intro"

const playing = (): boolean => useIntroStore.getState().status === "playing"

const claim = (event: Event): void => {
	event.preventDefault()
	event.stopImmediatePropagation()
}

/** Space: pause or carry on; Right / Left: the next / previous beat. */
export function onIntroKey(event: KeyboardEvent): void {
	if (!playing() || hasModifier(event) || event.shiftKey) return
	if (isEditableTarget(event.target)) return
	switch (event.key) {
		case " ":
			// a focused button keeps Space for itself (the pause button among them)
			if (isActivatableTarget(event.target)) return
			claim(event)
			if (!event.repeat) toggleIntroPause()
			return
		case "ArrowRight":
		case "ArrowLeft":
			if (isArrowWidgetTarget(event.target)) return
			claim(event)
			if (event.key === "ArrowRight") nextBeat()
			else previousBeat()
			return
		default:
			return
	}
}

/** A tap or click on the scene (the canvas) pauses the opening or carries on. */
export function onSceneClick(event: MouseEvent): void {
	if (!playing() || !(event.target instanceof HTMLCanvasElement)) return
	if (!isTapClick(event)) return
	// the scene's own click (fly to a body, let go of one) waits until the opening is over
	event.stopPropagation()
	toggleIntroPause()
}
