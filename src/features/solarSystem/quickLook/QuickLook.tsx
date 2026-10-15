/**
 * The quick look's pieces on the page (#44): the controller (the watcher, the
 * glow on `<html>`, `?look=play`), the question after the opening, and the
 * card that narrates each step. The question and the card sit in the HUD's
 * dock (#42), where tours and sky events speak too.
 */
import { Suspense, lazy, useEffect, useId, useLayoutEffect } from "react"
import { Button, CloseButton, Group, Text, UnstyledButton } from "@mantine/core"
import {
	IconBook,
	IconChevronLeft,
	IconChevronRight,
	IconPlayerPause,
	IconPlayerPlay,
	IconSparkles,
} from "@tabler/icons-react"
import { Link, useSearch } from "@tanstack/react-router"

import { useI18n, type MessageKey } from "@/i18n"
import { Hint } from "@/primitives/hint"
import { useTourStore } from "@/store/tour"

import { goToStop, nextStop, previousStop, setTourAuto } from "../tours/player"
import {
	answer,
	isQuickLook,
	leaveQuickLook,
	startQuickLook,
	useQuickLookStore,
	watchQuickLook,
} from "./quickLook"
import { QUICK_LOOK_STEPS } from "./script"

import classes from "./QuickLook.module.css"

// the comparison's drawing loads with the step that shows it
const Stage = lazy(() => import("@/features/compare/Stage"))

const noop = () => undefined

/**
 * Watches the quick look for the whole page: asks after a first visit's
 * opening, adds each step's extras, puts the glowing control on `<html>`
 * (`data-quick-look-spot`, styled in QuickLook.module.css) and plays the quick
 * look on `?look=play` (the help page's link).
 */
export function QuickLookController() {
	const look = useSearch({
		from: "/solar_system",
		select: (search) => search.look,
	})
	useLayoutEffect(() => watchQuickLook(), [])
	useLayoutEffect(() => {
		if (look === "play") startQuickLook()
		// only the link the page opened with: the URL mirror drops it at once
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])
	const spot = useQuickLookStore((state) => state.spot)
	useEffect(() => {
		const root = document.documentElement
		if (spot === null) root.removeAttribute("data-quick-look-spot")
		else root.setAttribute("data-quick-look-spot", spot)
		return () => root.removeAttribute("data-quick-look-spot")
	}, [spot])
	return null
}

/** "Want a quick look at what you can do here?" Yes / No, let me explore. */
export function QuickLookAsk({ className = "" }: { className?: string }) {
	const { t } = useI18n()
	const asking = useQuickLookStore((state) => state.asking)
	const titleId = useId()
	if (!asking) return null
	return (
		<section
			className={`${className} ${classes.ask}`}
			aria-labelledby={titleId}
			data-testid="quick-look-ask"
			data-sheet-kind="quickLook"
		>
			<Group gap="xs" wrap="nowrap" align="flex-start">
				<IconSparkles size={20} aria-hidden className={classes.icon} />
				<div>
					<Text
						id={titleId}
						fw={700}
						className={classes.question}
						aria-live="polite"
					>
						{t("solarSystem.quickLook.ask.title")}
					</Text>
					<Text size="sm" c="gray.4">
						{t("solarSystem.quickLook.ask.text")}
					</Text>
				</div>
			</Group>
			<Group gap="xs" justify="flex-end" mt="sm">
				<Button
					variant="subtle"
					color="gray"
					size="compact-md"
					onClick={() => answer(false)}
				>
					{t("solarSystem.quickLook.ask.no")}
				</Button>
				<Button
					color="orange"
					size="compact-md"
					leftSection={<IconPlayerPlay size={16} aria-hidden />}
					onClick={() => answer(true)}
				>
					{t("solarSystem.quickLook.ask.yes")}
				</Button>
			</Group>
		</section>
	)
}

/** The quick look's card: the step's words, its extras, and the way through and out. */
export function QuickLookCard({ className = "" }: { className?: string }) {
	const { t } = useI18n()
	const tour = useTourStore((state) => state.tour)
	const index = useTourStore((state) => state.index)
	const auto = useTourStore((state) => state.auto)
	const titleId = useId()
	if (tour === null || !isQuickLook(tour.id)) return null
	const step = QUICK_LOOK_STEPS[index]
	if (step === undefined) return null
	const total = QUICK_LOOK_STEPS.length
	const last = index === total - 1
	const key = (part: "title" | "text") =>
		`solarSystem.quickLook.steps.${step.id}.${part}` as MessageKey

	return (
		<section
			className={`${className} ${classes.card}`}
			aria-labelledby={titleId}
			data-testid="quick-look"
			data-step={step.id}
			data-sheet-kind="quickLook"
		>
			<header className={classes.header}>
				<IconSparkles size={18} aria-hidden className={classes.icon} />
				<span className={classes.kicker}>
					{t("solarSystem.quickLook.title")}
				</span>
				<span className={classes.count} data-testid="quick-look-count">
					{t("solarSystem.quickLook.count", { n: index + 1, total })}
				</span>
				<CloseButton
					size="sm"
					aria-label={t("solarSystem.quickLook.skip")}
					onClick={leaveQuickLook}
				/>
			</header>
			<h2 id={titleId} className={classes.heading}>
				{t(key("title"))}
			</h2>
			<p className={classes.text} aria-live="polite">
				{t(key("text"))}
			</p>
			{step.compare !== undefined && (
				<div className={classes.stage} data-testid="quick-look-compare">
					<Suspense fallback={null}>
						<Stage ids={step.compare} onPick={noop} />
					</Suspense>
				</div>
			)}
			{last && (
				<Button
					component={Link}
					to="/help"
					variant="light"
					color="orange"
					leftSection={<IconBook size={16} aria-hidden />}
					onClick={leaveQuickLook}
					data-testid="quick-look-help"
				>
					{t("solarSystem.quickLook.help")}
				</Button>
			)}
			<div
				className={classes.dots}
				role="group"
				aria-label={t("solarSystem.quickLook.steps.label")}
			>
				{QUICK_LOOK_STEPS.map((dot, at) => (
					<UnstyledButton
						key={dot.id}
						className={classes.dot}
						data-current={at === index || undefined}
						data-done={at < index || undefined}
						aria-label={t("solarSystem.quickLook.goTo", {
							n: at + 1,
							title: t(
								`solarSystem.quickLook.steps.${dot.id}.title` as MessageKey,
							),
						})}
						aria-current={at === index ? "step" : undefined}
						onClick={() => goToStop(at)}
					/>
				))}
			</div>
			<div className={classes.controls} data-sheet-footer>
				<Button
					variant="default"
					size="compact-md"
					leftSection={<IconChevronLeft size={16} aria-hidden />}
					disabled={index === 0}
					onClick={previousStop}
				>
					{t("solarSystem.quickLook.back")}
				</Button>
				<Hint
					text={t(
						auto
							? "solarSystem.quickLook.pauseHint"
							: "solarSystem.quickLook.playHint",
					)}
				>
					<Button
						variant="subtle"
						color="gray"
						size="compact-md"
						aria-pressed={auto}
						aria-label={t("solarSystem.quickLook.autoplay")}
						onClick={() => setTourAuto(!auto)}
						data-testid="quick-look-auto"
					>
						{auto ? (
							<IconPlayerPause size={18} aria-hidden />
						) : (
							<IconPlayerPlay size={18} aria-hidden />
						)}
					</Button>
				</Hint>
				<Button
					color="orange"
					size="compact-md"
					rightSection={
						last ? null : <IconChevronRight size={16} aria-hidden />
					}
					onClick={last ? leaveQuickLook : nextStop}
				>
					{t(
						last
							? "solarSystem.quickLook.finish"
							: "solarSystem.quickLook.next",
					)}
				</Button>
			</div>
			{!last && (
				<UnstyledButton
					className={classes.skip}
					onClick={leaveQuickLook}
					data-testid="quick-look-skip"
				>
					{t("solarSystem.quickLook.skipAll")}
				</UnstyledButton>
			)}
		</section>
	)
}
