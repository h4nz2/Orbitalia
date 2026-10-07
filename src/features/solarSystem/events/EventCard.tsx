/**
 * The card of the sky event on screen (#41): what it is, the real date and
 * where it could be seen, what to look for (at the reading level), the switch
 * between the view from space and the view from Earth, the honest notes (true
 * scale; how far the app's instant is from the real one) and the one action
 * that leaves it. A HUD `.panel` in the tour card's place: an event plays
 * through the tour player (#28), and presenter keys step its views.
 */
import { useState } from "react"
import {
	ActionIcon,
	Button,
	CloseButton,
	SegmentedControl,
	Tooltip,
} from "@mantine/core"
import {
	IconChevronDown,
	IconChevronUp,
	IconLink,
	IconSunMoon,
} from "@tabler/icons-react"

import { eventTourId, type SkyEvent } from "@/data/skyEvents"
import { durationInWords, isSimple, useI18n, type I18n } from "@/i18n"
import { Hint } from "@/primitives/hint"
import { useSimStore } from "@/store/sim"
import { useTourStore } from "@/store/tour"

import { resumeTour, tourStatus } from "../tours/player"
import { eventJD, eventRealJD } from "./instant"
import { leaveEvent, showEventView, useActiveEvent } from "./player"
import { EVENT_VIEWS, type EventView } from "./staging"
import { useEventWords } from "./text"

import classes from "./Events.module.css"

/** Below this many minutes apart, the app's instant counts as the real one. */
const SAME_TIME_MIN = 5

/**
 * How far the instant on screen is from the real one, in words: "1.5 hours",
 * "25 minutes", "2 days"; null when they are the same.
 */
export function shownOffset(
	event: SkyEvent,
	i18n: I18n,
): { direction: "early" | "late"; amount: string } | null {
	const minutes = (eventJD(event) - eventRealJD(event)) * 1440
	const size = Math.abs(minutes)
	if (size < SAME_TIME_MIN) return null
	const direction = minutes < 0 ? "early" : "late"
	const amount = isSimple(i18n)
		? durationInWords(size * 60, i18n)
		: size < 90
			? i18n.quantity(Math.round(size / 5) * 5, "minute", "long")
			: size < 36 * 60
				? i18n.quantity(Math.round(size / 30) / 2, "hour", "long")
				: i18n.quantity(Math.round(size / 1440), "day", "long")
	return { direction, amount }
}

/** Copies the link to the event and its view: `?tour=event-<id>&stop=<n>` with the language. */
const ShareButton = ({ event, stop }: { event: SkyEvent; stop: number }) => {
	const { t, locale, readingLevel } = useI18n()
	const [copied, setCopied] = useState(false)
	const copy = () => {
		const url = new URL(
			`${import.meta.env.BASE_URL}solar_system`,
			window.location.origin,
		)
		url.searchParams.set("tour", eventTourId(event.id))
		url.searchParams.set("stop", String(stop + 1))
		url.searchParams.set("lang", locale)
		url.searchParams.set("reading", readingLevel)
		void navigator.clipboard?.writeText(url.toString()).then(
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
				copied ? t("solarSystem.events.copied") : t("solarSystem.events.share")
			}
			opened={copied || undefined}
			withinPortal
		>
			<ActionIcon
				variant="subtle"
				color="gray"
				size="lg"
				onClick={copy}
				aria-label={t("solarSystem.events.share")}
				data-testid="event-share"
			>
				<IconLink size={18} aria-hidden />
			</ActionIcon>
		</Tooltip>
	)
}

const EventCard = ({ className = "" }: { className?: string }) => {
	const i18n = useI18n()
	const { t, dateTimeUTC } = i18n
	const words = useEventWords()
	const event = useActiveEvent()
	const tour = useTourStore((state) => state.tour)
	const index = useTourStore((state) => state.index)
	const steps = useTourStore((state) => state.steps)
	const collapsed = useTourStore((state) => state.collapsed)
	const setCollapsed = useTourStore((state) => state.setCollapsed)
	const sequence = useSimStore((state) => state.sequence)
	if (event === null || tour === null) return null

	const status = tourStatus(sequence, { tour, steps })
	const text = words(event.id)
	const view = (tour.stops[index]?.id ?? "space") as EventView
	const views = EVENT_VIEWS.filter((v) => tour.stops.some((s) => s.id === v))
	const offset = shownOffset(event, i18n)

	return (
		<section
			className={`${className} ${classes.card}`}
			aria-label={t("solarSystem.events.card", { title: text.title })}
			data-tour-card
			data-event-card={event.id}
			data-view={view}
			data-status={status}
			data-collapsed={collapsed}
		>
			<header className={classes.header}>
				<IconSunMoon className={classes.icon} size={20} aria-hidden />
				<div className={classes.heading}>
					<div className={classes.kind}>
						{t(`solarSystem.events.groups.${event.group}`)}
					</div>
					<h2 className={classes.title}>{text.title}</h2>
				</div>
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
					onClick={leaveEvent}
					aria-label={t("solarSystem.events.leaveLabel")}
				/>
			</header>
			{!collapsed && (
				<>
					<p className={classes.facts}>
						<span data-utc={event.utc}>
							{t("solarSystem.events.when", {
								when: dateTimeUTC(new Date(event.utc)),
							})}
						</span>
						<br />
						{t("solarSystem.events.where", { where: text.where })}
					</p>
					<p className={classes.look} aria-live="polite">
						{text.look}
					</p>
				</>
			)}
			{views.length > 1 && (
				<Hint
					options={Object.fromEntries(
						views.map((v) => [
							v,
							t(`solarSystem.events.hint.${v}.${event.group}`),
						]),
					)}
				>
					<SegmentedControl<EventView>
						fullWidth
						size="sm"
						radius="md"
						color="orange"
						aria-label={t("solarSystem.events.views.label")}
						value={view}
						onChange={showEventView}
						data={views.map((v) => ({
							value: v,
							label: t(`solarSystem.events.views.${v}`),
						}))}
					/>
				</Hint>
			)}
			{!collapsed && (
				<>
					<p className={classes.hint} data-testid="event-hint">
						{t(`solarSystem.events.hint.${view}.${event.group}`)}
					</p>
					<div className={classes.notes}>
						<span>{t("solarSystem.events.scaleNote")}</span>
						{offset !== null && (
							<span data-testid="event-offset">
								{t("solarSystem.events.shown", offset)}
							</span>
						)}
					</div>
				</>
			)}
			{status !== "playing" && (
				<div className={classes.away} role="status">
					<span>{t("solarSystem.events.away")}</span>
					<Button
						variant="filled"
						color="orange"
						size="compact-sm"
						onClick={resumeTour}
					>
						{t("solarSystem.events.resume")}
					</Button>
				</div>
			)}
			<div className={classes.controls}>
				<ShareButton event={event} stop={index} />
				<Hint text={t("solarSystem.events.leaveLabel")}>
					<Button
						color="orange"
						size="sm"
						onClick={leaveEvent}
						aria-label={t("solarSystem.events.leaveLabel")}
						data-testid="event-leave"
					>
						{t("solarSystem.events.leave")}
					</Button>
				</Hint>
			</div>
		</section>
	)
}

export default EventCard
