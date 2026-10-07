/**
 * The walk's ways in from the solar system (#48; docs/ARCHITECTURE.md, "The
 * walk's ways in"): the card in the Scale panel, in every preset, and the
 * one-time tip when the viewer first switches to True scale (walkNudge.ts).
 * Each names the idea ("Shrink the Sun to a basketball…"), not the page.
 */
import { useEffect, useId } from "react"
import { CloseButton } from "@mantine/core"
import { IconChevronRight, IconWalk } from "@tabler/icons-react"
import { Link } from "@tanstack/react-router"

import { useI18n } from "@/i18n"
import { useHudStore } from "@/store/hud"

import {
	dismissWalkNudge,
	useWalkNudgeStore,
	watchWalkNudge,
} from "./walkNudge"

import classes from "./WalkOffer.module.css"

/** The walk as a card: its icon and one line saying what it does. */
export function WalkCard() {
	const { t } = useI18n()
	return (
		<Link to="/solar_walk" className={classes.card} data-testid="walk-card">
			<span className={classes.icon} aria-hidden>
				<IconWalk size={18} />
			</span>
			<span className={classes.line}>{t("solarSystem.scale.walk")}</span>
			<IconChevronRight size={16} aria-hidden className={classes.chevron} />
		</Link>
	)
}

/** The tip's words around the card: where the planets went, and its close button. */
function Nudge({ className = "" }: { className?: string }) {
	const { t } = useI18n()
	const titleId = useId()
	return (
		<section
			className={`${className} ${classes.nudge}`}
			aria-labelledby={titleId}
			data-testid="walk-nudge"
		>
			<div className={classes.lead} aria-live="polite">
				<p id={titleId} className={classes.title}>
					{t("solarSystem.walkNudge.title")}
				</p>
				<CloseButton
					size="sm"
					aria-label={t("solarSystem.walkNudge.dismiss")}
					onClick={dismissWalkNudge}
				/>
			</div>
			<p className={classes.text}>{t("solarSystem.walkNudge.text")}</p>
			<WalkCard />
		</section>
	)
}

/** The Scale panel's way to the walk: the card, in every preset; the tip's words around it while it shows. */
export function ScaleWalkOffer() {
	const showing = useWalkNudgeStore((state) => state.showing)
	return showing ? <Nudge /> : <WalkCard />
}

/**
 * The tip in the dock, for a switch made with the Scale panel closed (the S
 * key); with the panel open it shows inside it instead. Also watches when the
 * tip's moment has passed, for the whole page.
 */
export function WalkNudge({ className = "" }: { className?: string }) {
	const showing = useWalkNudgeStore((state) => state.showing)
	const scaleOpen = useHudStore((state) => state.panel === "scale")
	useEffect(() => watchWalkNudge(), [])
	if (!showing || scaleOpen) return null
	return <Nudge className={`${className} ${classes.docked}`} />
}
