/**
 * The hand-over hints (#30): how to move around, in three short items, after
 * the opening (or from the Help menu). No arrows, no overlay: one line above
 * the bottom of the HUD that fades by itself a few seconds after the viewer
 * starts moving, or after `HINTS_MS` at the latest. A finger gets the touch
 * words ("Pinch to zoom", "Tap a planet").
 */
import { useEffect, useState } from "react"
import {
	IconHandClick,
	IconHandFinger,
	IconHandTwoFingers,
	IconRotate360,
	IconZoomIn,
} from "@tabler/icons-react"

import { useTouch } from "@/hooks/useSizeClass"
import { useI18n } from "@/i18n"

import { hideHints, useIntroStore } from "./intro"

import classes from "./Intro.module.css"

/** How long the hints stay up when nobody touches anything, ms. */
export const HINTS_MS = 10_000
/** How long they stay after the viewer starts moving the camera, ms. */
export const HINTS_AFTER_INPUT_MS = 3_000
/** Length of the fade, ms (matches Intro.module.css). */
const FADE_MS = 700

const Hints = () => {
	const { t } = useI18n()
	const touch = useTouch()
	const [leaving, setLeaving] = useState(false)

	useEffect(() => {
		let fade = setTimeout(() => setLeaving(true), HINTS_MS)
		// the first drag, wheel or pinch on the scene: they have found it; let the words go soon after
		const onInput = (event: Event) => {
			if (!(event.target instanceof HTMLCanvasElement)) return
			window.removeEventListener("pointerdown", onInput, true)
			window.removeEventListener("wheel", onInput, true)
			clearTimeout(fade)
			fade = setTimeout(() => setLeaving(true), HINTS_AFTER_INPUT_MS)
		}
		window.addEventListener("pointerdown", onInput, true)
		window.addEventListener("wheel", onInput, true)
		return () => {
			clearTimeout(fade)
			window.removeEventListener("pointerdown", onInput, true)
			window.removeEventListener("wheel", onInput, true)
		}
	}, [])

	useEffect(() => {
		if (!leaving) return
		const done = setTimeout(hideHints, FADE_MS)
		return () => clearTimeout(done)
	}, [leaving])

	const items = [
		{
			key: "drag",
			icon: <IconRotate360 size={18} aria-hidden />,
			text: t("solarSystem.intro.hint.drag"),
		},
		{
			key: "zoom",
			icon: touch ? (
				<IconHandTwoFingers size={18} aria-hidden />
			) : (
				<IconZoomIn size={18} aria-hidden />
			),
			text: t(
				touch ? "solarSystem.intro.hint.pinch" : "solarSystem.intro.hint.zoom",
			),
		},
		{
			key: "click",
			icon: touch ? (
				<IconHandFinger size={18} aria-hidden />
			) : (
				<IconHandClick size={18} aria-hidden />
			),
			text: t(
				touch ? "solarSystem.intro.hint.tap" : "solarSystem.intro.hint.click",
			),
		},
	]

	return (
		<section
			className={classes.hints}
			aria-label={t("solarSystem.intro.hint.label")}
			data-testid="intro-hints"
			data-leaving={leaving || undefined}
		>
			<ul className={classes.hintList}>
				{items.map((item) => (
					<li key={item.key} className={classes.hint} data-hint={item.key}>
						{item.icon}
						<span>{item.text}</span>
					</li>
				))}
			</ul>
		</section>
	)
}

/** The hints while they are up; a new request (the Help menu) starts them afresh. */
const IntroHints = () => {
	const hints = useIntroStore((state) => state.hints)
	return hints ? <Hints /> : null
}

export default IntroHints
