/**
 * The info panel for the selected spacecraft (issue #35), shown in place of
 * the body info: what it is, whether it still works, when it launched, where
 * it is now and how long its signal takes to reach us, its milestones (each
 * one a trip in time), and a button that flies the view to it. Every number
 * comes from true positions at the simulation time (10 Hz).
 */
import { useMemo, type ReactNode } from "react"
import {
	Badge,
	Button,
	CloseButton,
	ScrollArea,
	Text,
	UnstyledButton,
} from "@mantine/core"
import { IconFocus2 } from "@tabler/icons-react"

import {
	spacecraftAsOf,
	spacecraftById,
	type Spacecraft,
} from "@/data/spacecraft"
import { Hint } from "@/primitives/hint"
import {
	distanceInWords,
	formatSpeed,
	isSimple,
	useI18n,
	type I18n,
} from "@/i18n"
import { useBodyName } from "@/i18n/bodies"
import { useSpacecraftText } from "@/i18n/spacecraft"
import { kmToAu } from "@/sim"
import { eventsWithJD, isoToJD } from "@/sim/spacecraft"
import { useScaleStore } from "@/store/scale"
import { useSpacecraftStore } from "@/store/spacecraft"

import useThrottledSimTime from "../scene/useThrottledSimTime"
import { formatDayUTC } from "../ui/timeTravel"
import { craftFacts, showCraft, showEvent } from "./facts"
import { formatDuration } from "../light/lightTravel"
import { eventLabel } from "./text"

import classes from "./Spacecraft.module.css"

/**
 * A distance for people: "348,400 km", "25.5 billion km" / "25,5 Milliarden
 * km"; at the simple level in words ("more than 100 times as far as Earth is
 * from the Sun", #51).
 */
export function formatDistance(km: number, i18n: I18n): string {
	if (isSimple(i18n)) return distanceInWords(km, i18n)
	if (km < 1e6) return i18n.quantity(Math.round(km), "kilometer")
	return new Intl.NumberFormat(i18n.formatLocale, {
		style: "unit",
		unit: "kilometer",
		notation: "compact",
		compactDisplay: "long",
		maximumSignificantDigits: 3,
	}).format(km)
}

/** One row of the facts: a label, the value, and an optional line under it. */
const Fact = ({
	label,
	id,
	detail,
	children,
}: {
	label: string
	id: string
	detail?: string
	children: ReactNode
}) => (
	<div className={classes.fact}>
		<dt className={classes.factLabel}>{label}</dt>
		<dd className={classes.factValue} data-fact={id}>
			{children}
			{detail !== undefined && (
				<span className={classes.factDetail}>{detail}</span>
			)}
		</dd>
	</div>
)

const asOfJD = isoToJD(`${spacecraftAsOf}T00:00Z`)

const Milestones = ({ craft }: { craft: Spacecraft }) => {
	const i18n = useI18n()
	const bodyName = useBodyName()
	const scale = useScaleStore((state) => state.scale)
	const { t, formatLocale } = i18n
	const events = useMemo(
		() => [
			{
				date: craft.launch,
				kind: "launch" as const,
				target: "earth",
				jd: isoToJD(craft.launch),
			},
			...eventsWithJD(craft.events),
		],
		[craft],
	)
	return (
		<>
			<Text size="xs" fw={700} c="dimmed" tt="uppercase" mt="xs" mb={2}>
				{t("solarSystem.spacecraft.milestones")}
			</Text>
			<ul className={classes.milestones}>
				{events.map((event) => {
					const date = formatDayUTC(new Date(event.date), formatLocale)
					return (
						<li key={`${event.kind}-${event.date}`}>
							<UnstyledButton
								className={classes.milestone}
								data-event={event.kind}
								aria-label={`${eventLabel(event, i18n, bodyName)}, ${t("solarSystem.spacecraft.goTo", { date })}`}
								onClick={() => showEvent(craft, event, scale)}
							>
								<span className={classes.milestoneDate}>{date}</span>
								<span className={classes.milestoneText}>
									{eventLabel(event, i18n, bodyName)}
									{"distanceKm" in event &&
										event.distanceKm !== undefined &&
										// a flyby's distance from the centre is a detail for the older readers
										!isSimple(i18n) && (
											<span className={classes.milestoneDetail}>
												{t("solarSystem.spacecraft.distanceAt", {
													distance: formatDistance(event.distanceKm, i18n),
												})}
											</span>
										)}
								</span>
								{event.jd > asOfJD && (
									<Badge size="xs" variant="outline" color="gray">
										{t("solarSystem.spacecraft.planned")}
									</Badge>
								)}
							</UnstyledButton>
						</li>
					)
				})}
			</ul>
		</>
	)
}

const CraftPanel = ({ craft }: { craft: Spacecraft }) => {
	const i18n = useI18n()
	const { t, formatLocale } = i18n
	const bodyName = useBodyName()
	const text = useSpacecraftText(craft.id)
	const jd = useThrottledSimTime()
	const ready = useSpacecraftStore((state) => state.trajectoriesReady)
	const scale = useScaleStore((state) => state.scale)
	const facts = useMemo(
		() => (ready ? craftFacts(craft, jd) : null),
		[craft, jd, ready],
	)
	const day = (iso: string) => formatDayUTC(new Date(iso), formatLocale)
	const phase =
		facts?.phase ?? (jd < isoToJD(craft.launch) ? "planned" : "active")
	const inSpace = phase === "active" || phase === "silent"
	const known = facts !== null && facts.available && inSpace

	const status = (() => {
		switch (phase) {
			case "planned":
				return t("solarSystem.spacecraft.phase.planned", {
					date: day(craft.launch),
				})
			case "active":
				return t("solarSystem.spacecraft.phase.active")
			case "silent":
			case "destroyed":
				return t(`solarSystem.spacecraft.phase.${phase}`, {
					date: day(craft.end?.date ?? craft.dataTo),
				})
		}
	})()

	return (
		<section
			className={classes.panel}
			aria-label={t("solarSystem.spacecraft.panel")}
			data-craft={craft.id}
		>
			<header className={classes.header}>
				<div className={classes.title}>
					<h2 className={classes.name}>{text.name}</h2>
					<p className={classes.tagline}>
						<span className={classes.kind}>
							{t("solarSystem.spacecraft.kind")}
						</span>
						{" · "}
						{text.tagline}
					</p>
				</div>
				<CloseButton
					size="sm"
					aria-label={t("solarSystem.spacecraft.close")}
					onClick={() => useSpacecraftStore.getState().selectCraft(null)}
				/>
			</header>
			<p className={classes.status} data-phase={phase}>
				{status}
			</p>
			<dl className={classes.facts}>
				<Fact label={t("solarSystem.spacecraft.launched")} id="launch">
					{day(craft.launch)}
				</Fact>
				{known && (
					<>
						<Fact
							label={t("solarSystem.spacecraft.distanceSun")}
							id="sun"
							detail={
								isSimple(i18n)
									? undefined
									: t("units.au", {
											value: i18n.significant(kmToAu(facts.sunDistanceKm)),
										})
							}
						>
							{formatDistance(facts.sunDistanceKm, i18n)}
						</Fact>
						<Fact label={t("solarSystem.spacecraft.distanceEarth")} id="earth">
							{formatDistance(facts.earthDistanceKm, i18n)}
						</Fact>
						<Fact
							label={t("solarSystem.spacecraft.signal")}
							id="signal"
							detail={t("solarSystem.spacecraft.signalNote")}
						>
							{formatDuration(facts.signalSeconds, i18n)}
						</Fact>
						<Fact
							label={t("solarSystem.spacecraft.speed", {
								centreId: facts.anchorId,
								centre: bodyName(facts.anchorId),
							})}
							id="speed"
						>
							{formatSpeed(facts.speedKmS, i18n)}
						</Fact>
					</>
				)}
			</dl>
			{facts !== null && !facts.available && inSpace && (
				<p className={classes.note}>
					{t("solarSystem.spacecraft.noData", {
						from: day(craft.dataFrom),
						to: day(craft.dataTo),
					})}
				</p>
			)}
			{known && facts.predicted && (
				<p className={classes.note}>{t("solarSystem.spacecraft.predicted")}</p>
			)}
			<Hint text={t("solarSystem.spacecraft.showHint", { name: text.name })}>
				<Button
					size="compact-sm"
					variant="light"
					color="cyan"
					mt={6}
					leftSection={<IconFocus2 size={14} />}
					disabled={!known}
					onClick={() => showCraft(craft.id, scale)}
				>
					{t("solarSystem.spacecraft.show")}
				</Button>
			</Hint>
			<ScrollArea.Autosize
				mah="min(9rem, 20dvh)"
				type="auto"
				offsetScrollbars
				mt={6}
			>
				<p className={classes.description}>{text.description}</p>
				<Milestones craft={craft} />
			</ScrollArea.Autosize>
		</section>
	)
}

export interface SpacecraftInfoProps {
	/** What the panel shows while no craft is selected (the body info). */
	fallback: ReactNode
}

/** The selected craft's panel, else `fallback`. */
const SpacecraftInfo = ({ fallback }: SpacecraftInfoProps) => {
	const id = useSpacecraftStore((state) => state.selectedCraftId)
	const craft = id === null ? undefined : spacecraftById.get(id)
	if (craft === undefined) return fallback
	return <CraftPanel key={craft.id} craft={craft} />
}

export default SpacecraftInfo
