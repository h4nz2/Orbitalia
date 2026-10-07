/**
 * What the opening shows over the scene (#30): the caption of the beat on
 * screen, a row of segments that fill beat by beat, and its controls from the
 * very first frame: pause (Space or a tap on the scene do the same; "Paused"
 * shows while it holds), Next and Skip (#49). Not a modal: nothing but the
 * card itself catches the pointer, the scene and every HUD control stay
 * usable, and another view, or a drag while it is not paused, ends the
 * opening. After the opening, the same slot shows the fading hints.
 */
import { useEffect } from "react"
import { ActionIcon, Button } from "@mantine/core"
import {
	IconChevronRight,
	IconPlayerPause,
	IconPlayerPauseFilled,
	IconPlayerPlay,
	IconPlayerTrackNext,
} from "@tabler/icons-react"

import { useI18n } from "@/i18n"
import { useBodyName } from "@/i18n/bodies"
import { Hint } from "@/primitives/hint"

import { introCaption } from "./captions"
import { nextBeat, skipIntro, toggleIntroPause, useIntroStore } from "./intro"
import IntroHints from "./IntroHints"
import { CAPTION_FADE_MS, INTRO_BEATS } from "./script"

import classes from "./Intro.module.css"

/**
 * Mirrors the opening on `<html data-intro>` ("playing", or "hints" while the
 * hints are up), so the HUD can make room (SolarSystem.module.css).
 */
const useDocumentStatus = (value: "playing" | "hints" | null) => {
	useEffect(() => {
		if (value === null) return
		const root = document.documentElement
		root.dataset.intro = value
		return () => {
			delete root.dataset.intro
		}
	}, [value])
}

const Opening = () => {
	const i18n = useI18n()
	const name = useBodyName()
	const beat = useIntroStore((state) => state.beat)
	const steps = useIntroStore((state) => state.steps)
	const paused = useIntroStore((state) => state.paused)
	const reducedMotion = useIntroStore((state) => state.reducedMotion)
	const id = INTRO_BEATS[beat] ?? INTRO_BEATS[0]
	const caption = introCaption(id, i18n, name)
	const { t } = i18n

	return (
		<section
			className={classes.card}
			aria-label={t("solarSystem.intro.label")}
			data-testid="intro"
			data-beat={id}
			data-paused={paused || undefined}
		>
			<div
				className={classes.caption}
				aria-live="polite"
				key={id}
				style={{ animationDuration: `${CAPTION_FADE_MS}ms` }}
			>
				<p className={classes.title}>{caption.title}</p>
				<p className={classes.detail}>{caption.detail}</p>
			</div>
			<div className={classes.footer}>
				<div className={classes.progress}>
					<div
						className={classes.segments}
						role="progressbar"
						aria-valuemin={1}
						aria-valuemax={INTRO_BEATS.length}
						aria-valuenow={beat + 1}
						aria-valuetext={t("solarSystem.intro.progress", {
							beat: beat + 1,
							count: INTRO_BEATS.length,
						})}
					>
						{INTRO_BEATS.map((segment, index) => {
							const step = steps?.[index]
							const ms = (step?.durationMs ?? 0) + (step?.holdMs ?? 0)
							return (
								<span
									key={segment}
									className={classes.segment}
									data-state={
										index < beat ? "done" : index === beat ? "now" : "next"
									}
									style={
										index === beat && !reducedMotion
											? {
													animationDuration: `${ms}ms`,
													animationPlayState: paused ? "paused" : "running",
												}
											: undefined
									}
								/>
							)
						})}
					</div>
					{paused && (
						<span
							className={classes.paused}
							role="status"
							data-testid="intro-paused"
						>
							<IconPlayerPauseFilled size={12} aria-hidden />
							{t("solarSystem.intro.paused")}
						</span>
					)}
				</div>
				<div className={classes.buttons}>
					<Hint text={t("solarSystem.intro.pauseHint")}>
						<ActionIcon
							variant="subtle"
							color="gray"
							size="lg"
							className={classes.control}
							aria-label={t(
								paused ? "solarSystem.intro.resume" : "solarSystem.intro.pause",
							)}
							aria-keyshortcuts="Space"
							onClick={() => toggleIntroPause()}
							data-testid="intro-pause"
						>
							{paused ? (
								<IconPlayerPlay size={18} aria-hidden />
							) : (
								<IconPlayerPause size={18} aria-hidden />
							)}
						</ActionIcon>
					</Hint>
					<Hint text={t("solarSystem.intro.nextHint")}>
						<Button
							variant="subtle"
							color="gray"
							size="compact-md"
							className={classes.control}
							rightSection={<IconChevronRight size={16} aria-hidden />}
							aria-keyshortcuts="ArrowRight"
							onClick={nextBeat}
							data-testid="intro-next"
						>
							{t("solarSystem.intro.next")}
						</Button>
					</Hint>
					<Button
						className={classes.skip}
						variant="white"
						color="dark"
						size="compact-md"
						rightSection={<IconPlayerTrackNext size={16} aria-hidden />}
						aria-keyshortcuts="Escape"
						onClick={skipIntro}
						data-testid="intro-skip"
					>
						{t("solarSystem.intro.skip")}
					</Button>
				</div>
			</div>
		</section>
	)
}

/** The opening's slot in the HUD: the captions while it plays, the hints after it. */
const IntroOverlay = ({ className }: { className?: string }) => {
	const status = useIntroStore((state) => state.status)
	const hints = useIntroStore((state) => state.hints)
	useDocumentStatus(
		status === "playing"
			? "playing"
			: status === "handover" && hints
				? "hints"
				: null,
	)
	if (status === "off") return null
	return (
		<div className={`${classes.slot} ${className ?? ""}`}>
			{status === "playing" ? <Opening /> : <IntroHints />}
		</div>
	)
}

export default IntroOverlay
