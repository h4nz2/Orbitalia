/**
 * The narration card of a running tour (#28): the stop's heading and text,
 * Back / Next (Finish on the last stop), a dot per stop to jump to it,
 * autoplay, a link to the stop, fold and close. While the visitor looks
 * around on their own it says so and offers the way back to the stop.
 *
 * Large type for a projector; a HUD `.panel`, so labels keep clear of it.
 */
import { useState } from "react"
import { ActionIcon, Button, CloseButton, Tooltip } from "@mantine/core"
import {
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconChevronUp,
	IconExternalLink,
	IconLink,
	IconPlayerPause,
	IconPlayerPlay,
	IconRoute,
} from "@tabler/icons-react"

import { eventOfTourId } from "@/data/skyEvents"
import type { Tour, TourLink } from "@/data/tours"
import { Hint } from "@/primitives/hint"
import { useI18n } from "@/i18n"
import { useSimStore } from "@/store/sim"
import { useTourStore } from "@/store/tour"

import { tourBack } from "../back/back"
import {
	exitTour,
	goToStop,
	nextStop,
	resumeTour,
	setTourAuto,
	tourStatus,
} from "./player"
import { isQuickLook } from "../quickLook/quickLook"
import { useTourWords } from "./text"

import classes from "./Tours.module.css"

/** The app page a stop's link opens (in a new tab, so the tour stays open). */
const LINK_PATHS: Readonly<Record<TourLink, string>> = {
	solarWalk: "solar_walk",
}

/** An app URL with the language and reading level of this page. */
function appUrl(
	path: string,
	params: Record<string, string>,
	locale: string,
	readingLevel: string,
): string {
	const url = new URL(
		`${import.meta.env.BASE_URL}${path}`,
		window.location.origin,
	)
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value)
	}
	url.searchParams.set("lang", locale)
	url.searchParams.set("reading", readingLevel)
	return url.toString()
}

/** Copies a link to the stop: only the tour, the stop and the language, so it opens clean. */
const ShareButton = ({ tour, index }: { tour: Tour; index: number }) => {
	const { t, locale, readingLevel } = useI18n()
	const [copied, setCopied] = useState(false)
	const copy = () => {
		const url = appUrl(
			"solar_system",
			{ tour: tour.id, stop: String(index + 1) },
			locale,
			readingLevel,
		)
		void navigator.clipboard?.writeText(url).then(
			() => {
				setCopied(true)
				setTimeout(() => setCopied(false), 2000)
			},
			() => undefined,
		)
	}
	return (
		<Tooltip
			label={
				copied ? t("solarSystem.tours.copied") : t("solarSystem.tours.share")
			}
			opened={copied || undefined}
			withinPortal
		>
			<ActionIcon
				variant="subtle"
				color="gray"
				size="lg"
				onClick={copy}
				aria-label={t("solarSystem.tours.share")}
				data-testid="tour-share"
			>
				<IconLink size={18} aria-hidden />
			</ActionIcon>
		</Tooltip>
	)
}

const TourCard = ({ className = "" }: { className?: string }) => {
	const i18n = useI18n()
	const { t } = i18n
	const words = useTourWords()
	const tour = useTourStore((state) => state.tour)
	const index = useTourStore((state) => state.index)
	const auto = useTourStore((state) => state.auto)
	const collapsed = useTourStore((state) => state.collapsed)
	const setCollapsed = useTourStore((state) => state.setCollapsed)
	const steps = useTourStore((state) => state.steps)
	const sequence = useSimStore((state) => state.sequence)
	const status = tourStatus(sequence, { tour, steps })

	// a sky event (#41) and the quick look (#44) play as tours but have their own cards
	if (
		tour === null ||
		status === null ||
		eventOfTourId(tour.id) !== null ||
		isQuickLook(tour.id)
	) {
		return null
	}
	const stop = tour.stops[index]
	const tourText = words.tour(tour)
	const stopText = words.stop(tour, stop)
	const count = tour.stops.length
	const last = index >= count - 1
	const away = status !== "playing"

	const header = (
		<header className={classes.header}>
			<IconRoute className={classes.tourIcon} size={18} aria-hidden />
			<span className={classes.tourTitle}>{tourText.title}</span>
			<span className={classes.count} data-testid="tour-count">
				{t("solarSystem.tours.stopOf", { n: index + 1, count })}
			</span>
			<ActionIcon
				variant="subtle"
				color="gray"
				onClick={() => setCollapsed(!collapsed)}
				aria-label={
					collapsed
						? t("solarSystem.tours.expand")
						: t("solarSystem.tours.collapse")
				}
				aria-expanded={!collapsed}
			>
				{collapsed ? (
					<IconChevronUp size={18} aria-hidden />
				) : (
					<IconChevronDown size={18} aria-hidden />
				)}
			</ActionIcon>
			<CloseButton
				onClick={exitTour}
				aria-label={t("solarSystem.tours.close")}
			/>
		</header>
	)

	const back = (
		<Button
			variant="default"
			size={collapsed ? "compact-sm" : "sm"}
			// the previous stop, through the browser's history where it can (#46)
			onClick={tourBack}
			disabled={index === 0}
			leftSection={<IconChevronLeft size={16} aria-hidden />}
		>
			{t("solarSystem.tours.back")}
		</Button>
	)
	const next = (
		<Button
			color="orange"
			size={collapsed ? "compact-sm" : "sm"}
			onClick={nextStop}
			rightSection={
				last ? undefined : <IconChevronRight size={16} aria-hidden />
			}
			data-testid="tour-next"
		>
			{last ? t("solarSystem.tours.finish") : t("solarSystem.tours.next")}
		</Button>
	)

	return (
		<section
			className={`${className} ${classes.card}`}
			aria-label={t("solarSystem.tours.card", { title: tourText.title })}
			data-tour-card
			data-tour={tour.id}
			data-stop={stop.id}
			data-status={status}
			data-collapsed={collapsed}
		>
			{header}
			{collapsed ? (
				<div className={classes.controls}>
					{back}
					{away && (
						<Button
							variant="light"
							color="orange"
							size="compact-sm"
							onClick={resumeTour}
						>
							{t("solarSystem.tours.resume")}
						</Button>
					)}
					{next}
				</div>
			) : (
				<>
					<div className={classes.body} aria-live="polite">
						<h2 className={classes.title}>{stopText.title}</h2>
						<p className={classes.text}>{stopText.text}</p>
					</div>
					{stop.link !== undefined && stopText.link !== "" && (
						<Button
							component="a"
							href={appUrl(
								LINK_PATHS[stop.link],
								{},
								i18n.locale,
								i18n.readingLevel,
							)}
							target="_blank"
							rel="noopener"
							variant="light"
							color="orange"
							size="sm"
							className={classes.link}
							rightSection={<IconExternalLink size={16} aria-hidden />}
						>
							{stopText.link}
						</Button>
					)}
					{away && (
						<div className={classes.away} role="status">
							<span>{t("solarSystem.tours.away", { n: index + 1 })}</span>
							<Button
								variant="filled"
								color="orange"
								size="compact-sm"
								onClick={resumeTour}
							>
								{t("solarSystem.tours.resume")}
							</Button>
						</div>
					)}
					<ol className={classes.dots}>
						{tour.stops.map((s, i) => (
							<li key={s.id}>
								<button
									type="button"
									className={classes.dot}
									data-current={i === index || undefined}
									data-done={i < index || undefined}
									aria-current={i === index ? "step" : undefined}
									aria-label={t("solarSystem.tours.goTo", {
										n: i + 1,
										title: words.stop(tour, s).title,
									})}
									onClick={() => goToStop(i)}
								/>
							</li>
						))}
					</ol>
					<div className={classes.controls}>
						{back}
						<div className={classes.tools}>
							<Hint text={t("solarSystem.tours.autoplayHint")}>
								<ActionIcon
									variant={auto ? "filled" : "subtle"}
									color={auto ? "orange" : "gray"}
									size="lg"
									onClick={() => setTourAuto(!auto)}
									aria-label={t("solarSystem.tours.autoplay")}
									aria-pressed={auto}
									data-testid="tour-autoplay"
								>
									{auto ? (
										<IconPlayerPause size={18} aria-hidden />
									) : (
										<IconPlayerPlay size={18} aria-hidden />
									)}
								</ActionIcon>
							</Hint>
							<ShareButton tour={tour} index={index} />
						</div>
						{next}
					</div>
				</>
			)}
		</section>
	)
}

export default TourCard
