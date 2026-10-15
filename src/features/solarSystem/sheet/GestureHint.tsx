/**
 * The gesture hint (#62; `gestureHint.ts`): the first time on a phone held
 * upright, a short card shows the three moves that have no button, dragging
 * the sheet's handle, tapping the sky to hide the controls and swiping the
 * card to the next world. It sits in the open row just above the time chip,
 * clear of the sheet, its handle and whatever the sheet holds (a tour's Next,
 * the hunt's clue, the card), and stays until its OK or ×, or until one of
 * the moves is made. While it is up the band the camera frames into ends at
 * its top (`data-sheet-above`, #61), so it covers no world a hunt asks for.
 */
import { useEffect } from "react"
import { Button, CloseButton } from "@mantine/core"
import {
	IconArrowsMoveHorizontal,
	IconArrowsMoveVertical,
	IconHandFinger,
} from "@tabler/icons-react"

import { useTouch, useUprightPhone } from "@/hooks/useSizeClass"
import { useI18n } from "@/i18n"
import { Hint } from "@/primitives/hint"

import {
	dismissGestureHint,
	useGestureHintStore,
	watchGestureHint,
} from "./gestureHint"

import hudClasses from "../SolarSystem.module.css"
import classes from "./GestureHint.module.css"

export function GestureHint({ className = "" }: { className?: string }) {
	const { t } = useI18n()
	const showing = useGestureHintStore((state) => state.showing)
	const upright = useUprightPhone()
	const touch = useTouch()
	useEffect(() => watchGestureHint(), [])
	if (!showing || !upright || !touch) return null
	const okHint = t("solarSystem.gestures.okHint")
	return (
		<section
			className={`${hudClasses.panel} ${className} ${classes.hint}`}
			aria-label={t("solarSystem.gestures.label")}
			data-gesture-hint
			data-sheet-above
			data-testid="gesture-hint"
		>
			<ul className={classes.list} aria-live="polite">
				<li className={classes.item} data-gesture="drag">
					<IconArrowsMoveVertical
						size={20}
						aria-hidden
						className={classes.icon}
					/>
					<span>{t("solarSystem.gestures.drag")}</span>
				</li>
				<li className={classes.item} data-gesture="tap">
					<IconHandFinger size={20} aria-hidden className={classes.icon} />
					<span>{t("solarSystem.gestures.tap")}</span>
				</li>
				<li className={classes.item} data-gesture="swipe">
					<IconArrowsMoveHorizontal
						size={20}
						aria-hidden
						className={classes.icon}
					/>
					<span>{t("solarSystem.gestures.swipe")}</span>
				</li>
			</ul>
			<Hint text={okHint}>
				<CloseButton
					className={classes.close}
					aria-label={t("solarSystem.gestures.close")}
					onClick={dismissGestureHint}
					data-testid="gesture-hint-close"
				/>
			</Hint>
			<Hint text={okHint}>
				<Button
					className={classes.ok}
					color="orange"
					size="compact-sm"
					onClick={dismissGestureHint}
					data-testid="gesture-hint-ok"
				>
					{t("solarSystem.gestures.ok")}
				</Button>
			</Hint>
		</section>
	)
}

export default GestureHint
