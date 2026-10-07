import { useEffect, useMemo, useRef, useState } from "react"
import {
	ActionIcon,
	Button,
	CloseButton,
	Group,
	SegmentedControl,
	Slider,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core"
import { DatePicker } from "@mantine/dates"
import {
	IconCamera,
	IconHistory,
	IconLock,
	IconPencil,
	IconPlayerTrackNext,
	IconTrash,
} from "@tabler/icons-react"

import { getBody } from "@/data"
import { useI18n } from "@/i18n"
import { useBodyName } from "@/i18n/bodies"
import { useBirthdayStore } from "@/store/birthday"
import type { PostcardExtra } from "@/store/postcard"
import { useSimStore } from "@/store/sim"

import {
	calendarLabels,
	dayStart,
	firstDayOfWeek,
	formatDayUTC,
	travelAndStop,
	type Day,
} from "../ui/timeTravel"
import {
	FIRST_BIRTH_DAY,
	WEIGHT_WORLD_IDS,
	birthdayFacts,
	calendarStart,
	formatBigNumber,
	formatKg,
	hasNoSurface,
	localDay,
	weightOn,
	type BirthdayFacts,
} from "./birthday"
import { takePostcard } from "../postcard/take"
import { cardText, worldColor, type CardText } from "./card"

import "@mantine/dates/styles.css"
import classes from "./BirthdayPanel.module.css"

type Tab = "years" | "days" | "weight"

/** The birthday calendar: opens on the decades, so a child picks year, month, day and never types. */
const BirthCalendar = ({
	now,
	value,
	onPick,
}: {
	now: Date
	value: Day | null
	onPick: (day: Day) => void
}) => {
	const { t, formatLocale } = useI18n()
	const labels = calendarLabels(formatLocale)
	return (
		<Stack gap={4} align="center">
			<DatePicker
				value={value}
				defaultDate={value ?? calendarStart(now)}
				defaultLevel={value === null ? "decade" : "month"}
				minDate={FIRST_BIRTH_DAY}
				maxDate={localDay(now)}
				firstDayOfWeek={firstDayOfWeek(formatLocale)}
				weekendDays={[]}
				{...labels}
				ariaLabels={{
					nextMonth: t("solarSystem.time.travel.calendar.nextMonth"),
					previousMonth: t("solarSystem.time.travel.calendar.previousMonth"),
					nextYear: t("solarSystem.time.travel.calendar.nextYear"),
					previousYear: t("solarSystem.time.travel.calendar.previousYear"),
					nextDecade: t("solarSystem.time.travel.calendar.nextDecade"),
					previousDecade: t("solarSystem.time.travel.calendar.previousDecade"),
					monthLevelControl: t("solarSystem.time.travel.calendar.monthLevel"),
					yearLevelControl: t("solarSystem.time.travel.calendar.yearLevel"),
				}}
				onChange={(day) => {
					if (day !== null) onPick(day)
				}}
			/>
			<Text size="xs" c="dimmed" ta="center">
				{t("solarSystem.birthday.calendarHint")}
			</Text>
		</Stack>
	)
}

const Dot = ({ id }: { id: string }) => (
	<span
		className={classes.dot}
		style={{ background: worldColor(id) }}
		aria-hidden
	/>
)

/** Ages on every planet and the next birthday there, with a button to travel to it. */
const YearsList = ({ facts }: { facts: BirthdayFacts }) => {
	const { t, number, formatLocale, readingLevel } = useI18n()
	const name = useBodyName()
	const earthAge = facts.worlds.find((world) => world.id === "earth")?.age ?? 0
	return (
		<Stack gap="xs">
			<Text size="xs" c="gray.4" lh={1.4}>
				{t("solarSystem.birthday.years.intro")}
			</Text>
			<ul className={classes.list}>
				{facts.worlds.map((world) => {
					const date = formatDayUTC(dayStart(world.nextDay), formatLocale)
					return (
						<li key={world.id} className={classes.row} data-world={world.id}>
							<Dot id={world.id} />
							<div className={classes.main}>
								<Text size="sm" fw={600}>
									{name(world.id)}
								</Text>
								<Text size="xs" c="dimmed">
									{t(
										world.age === 0
											? "solarSystem.birthday.years.first"
											: "solarSystem.birthday.years.next",
										{ date },
									)}
								</Text>
								{world.id !== "earth" && world.earthAgeThen > earthAge + 1 ? (
									<Text size="xs" c="dimmed">
										{t("solarSystem.birthday.years.earthAgeThen", {
											age: world.earthAgeThen,
										})}
									</Text>
								) : null}
								{world.birthdayToday ? (
									<Text size="xs" fw={700} c="yellow.4">
										{t("solarSystem.birthday.years.today", {
											planetId: world.id,
											planet: name(world.id),
										})}
									</Text>
								) : null}
							</div>
							<div className={classes.value}>
								<Text size="md" fw={700} className={classes.age}>
									{t("solarSystem.birthday.years.age", { age: world.age })}
								</Text>
								{readingLevel === "advanced" ? (
									<Text size="xs" c="dimmed">
										{t("solarSystem.birthday.years.exact", {
											orbits: number(world.exactAge),
										})}
									</Text>
								) : null}
							</div>
							<Tooltip
								label={t("solarSystem.birthday.years.go", {
									planetId: world.id,
									planet: name(world.id),
								})}
								openDelay={300}
							>
								<ActionIcon
									variant="subtle"
									color="orange"
									aria-label={t("solarSystem.birthday.years.go", {
										planetId: world.id,
										planet: name(world.id),
									})}
									onClick={() => travelAndStop(world.nextJD)}
								>
									<IconPlayerTrackNext size={18} />
								</ActionIcon>
							</Tooltip>
						</li>
					)
				})}
			</ul>
		</Stack>
	)
}

/** Local days (sunrise to sunrise) lived on every planet. */
const DaysList = ({ facts }: { facts: BirthdayFacts }) => {
	const { t, quantity } = useI18n()
	const name = useBodyName()
	return (
		<Stack gap="xs">
			<Text size="xs" c="gray.4" lh={1.4}>
				{t("solarSystem.birthday.days.intro")}
			</Text>
			<ul className={classes.list}>
				{facts.worlds.map((world) => {
					const day = world.solarDayDays
					const length =
						day === null
							? null
							: day < 2
								? quantity(day * 24, "hour", "long")
								: quantity(day, "day", "long")
					return (
						<li key={world.id} className={classes.row} data-world={world.id}>
							<Dot id={world.id} />
							<div className={classes.main}>
								<Text size="sm" fw={600}>
									{name(world.id)}
								</Text>
								{length !== null ? (
									<Text size="xs" c="dimmed">
										{t("solarSystem.birthday.days.length", { length })}
									</Text>
								) : null}
							</div>
							<div className={classes.value}>
								{world.daysLived !== null ? (
									<Text size="md" fw={700} className={classes.age}>
										{t("solarSystem.birthday.days.lived", {
											count: world.daysLived,
										})}
									</Text>
								) : null}
							</div>
						</li>
					)
				})}
			</ul>
		</Stack>
	)
}

const WEIGHT_MARKS = [20, 40, 60, 80, 100].map((value) => ({ value }))

/** What a scale would show on the Sun, the planets and the large moons. */
const WeightList = () => {
	const { t, formatLocale } = useI18n()
	const name = useBodyName()
	const weightKg = useBirthdayStore((state) => state.weightKg)
	const setWeightKg = useBirthdayStore((state) => state.setWeightKg)
	return (
		<Stack gap="xs">
			<Text size="xs" c="gray.4" lh={1.4}>
				{t("solarSystem.birthday.weight.intro")}
			</Text>
			<Text size="sm" fw={600} ta="center">
				{t("solarSystem.birthday.weight.onEarth", {
					kg: formatKg(weightKg, formatLocale),
				})}
			</Text>
			<Slider
				className={classes.slider}
				color="orange"
				min={5}
				max={120}
				step={1}
				marks={WEIGHT_MARKS}
				value={weightKg}
				onChange={setWeightKg}
				label={null}
				thumbLabel={t("solarSystem.birthday.weight.slider")}
			/>
			<ul className={classes.list}>
				{WEIGHT_WORLD_IDS.map((id) => {
					const body = getBody(id)
					const kg = weightOn(body, weightKg)
					const noSurface = hasNoSurface(body)
					return (
						<li
							key={id}
							className={classes.row}
							data-world={id}
							data-moon={body.kind === "moon" || undefined}
						>
							<Dot id={id} />
							<div className={classes.main}>
								<Text size="sm" fw={body.kind === "moon" ? 400 : 600}>
									{name(id)}
									{noSurface ? (
										<span
											className={classes.star}
											title={t("solarSystem.birthday.weight.noSurface")}
										>
											*
										</span>
									) : null}
								</Text>
							</div>
							<div className={classes.value}>
								<Text size="md" fw={700} className={classes.age}>
									{kg === null
										? "—"
										: t("solarSystem.birthday.weight.kg", {
												kg: formatKg(kg, formatLocale),
											})}
								</Text>
							</div>
						</li>
					)
				})}
			</ul>
			<Text size="xs" c="dimmed" lh={1.4}>
				{t("solarSystem.birthday.weight.noSurfaceNote")}
			</Text>
			<Text size="xs" c="gray.4" lh={1.4}>
				{t("solarSystem.birthday.weight.note")}
			</Text>
		</Stack>
	)
}

/** The clock shows the birth date (the planets as they stood that day). */
const atBirth = (facts: BirthdayFacts): boolean =>
	Math.abs(useSimStore.getState().simTimeJD - facts.birthJD) < 0.5

/** The birthday result on the postcard of the view (#33): the ages under the picture, never the birth date. */
const birthdayPostcard = (
	card: CardText,
	caption: string | undefined,
): PostcardExtra => ({
	title: card.title,
	caption,
	date: card.date,
	rows: card.rows.map((row) => ({
		id: row.id,
		label: row.name,
		value: row.age,
		color: worldColor(row.id),
	})),
	note: card.distance,
	fileName: card.fileName,
})

/** The result for an entered birth date. */
const Results = ({
	facts,
	onChange,
}: {
	facts: BirthdayFacts
	onChange: () => void
}) => {
	const i18n = useI18n()
	const { t, formatLocale } = i18n
	const name = useBodyName()
	const forget = useBirthdayStore((state) => state.forget)
	const [tab, setTab] = useState<Tab>("years")
	const distance = formatBigNumber(facts.distanceKm, formatLocale)
	const formatDay = (day: Day) => formatDayUTC(dayStart(day), formatLocale)

	return (
		<Stack gap="sm">
			<Group justify="space-between" wrap="nowrap" gap="xs">
				<Text size="sm" fw={600} data-testid="birthday-born">
					{t("solarSystem.birthday.born", { date: formatDay(facts.birthDay) })}
				</Text>
				<Button
					variant="subtle"
					color="gray"
					size="compact-xs"
					leftSection={<IconPencil size={14} />}
					onClick={onChange}
				>
					{t("solarSystem.birthday.change")}
				</Button>
			</Group>
			<Button
				variant="light"
				color="orange"
				leftSection={<IconHistory size={18} />}
				onClick={() => travelAndStop(facts.birthJD)}
			>
				{t("solarSystem.birthday.showBirthSky")}
			</Button>
			<Text size="sm" className={classes.distance} lh={1.45}>
				{t("solarSystem.birthday.distance", {
					distance,
					speed: Math.round(facts.orbitSpeedKmS * 10) / 10,
					trips:
						facts.moonTrips < 100
							? Math.floor(facts.moonTrips)
							: Math.round(facts.moonTrips / 100) * 100,
				})}
			</Text>
			<SegmentedControl<Tab>
				fullWidth
				size="xs"
				radius="md"
				aria-label={t("solarSystem.birthday.tabs.label")}
				value={tab}
				onChange={setTab}
				data={[
					{ value: "years", label: t("solarSystem.birthday.tabs.years") },
					{ value: "days", label: t("solarSystem.birthday.tabs.days") },
					{ value: "weight", label: t("solarSystem.birthday.tabs.weight") },
				]}
			/>
			{tab === "years" ? (
				<YearsList facts={facts} />
			) : tab === "days" ? (
				<DaysList facts={facts} />
			) : (
				<WeightList />
			)}
			<Group gap="xs" justify="space-between">
				<Tooltip
					label={t("solarSystem.birthday.shareHint")}
					multiline
					w={240}
					openDelay={300}
				>
					<Button
						variant="default"
						size="xs"
						leftSection={<IconCamera size={16} />}
						onClick={() =>
							takePostcard(
								birthdayPostcard(
									cardText(facts, i18n, name, formatDay, distance),
									atBirth(facts)
										? t("solarSystem.postcard.birthdayCaption")
										: undefined,
								),
							)
						}
					>
						{t("solarSystem.birthday.share")}
					</Button>
				</Tooltip>
				<Button
					variant="subtle"
					color="red"
					size="xs"
					leftSection={<IconTrash size={16} />}
					onClick={forget}
				>
					{t("solarSystem.birthday.forget")}
				</Button>
			</Group>
		</Stack>
	)
}

/**
 * "Your birthday in space" (issue #26): a non-modal panel beside the scene, so
 * the planets can be watched gliding back to the birth date while the ages
 * are read. Loaded lazily with the calendar; opened from Tools or
 * `?birthday=true`.
 */
const BirthdayPanel = () => {
	const { t } = useI18n()
	const birthDay = useBirthdayStore((state) => state.birthDay)
	const setBirthDay = useBirthdayStore((state) => state.setBirthDay)
	const setOpen = useBirthdayStore((state) => state.setOpen)
	const [editing, setEditing] = useState(false)
	// "now" is read once per opening: the ages must not tick while being read
	const [now] = useState(() => new Date())
	const facts = useMemo(
		() => (birthDay === null ? null : birthdayFacts(birthDay, now)),
		[birthDay, now],
	)
	const titleRef = useRef<HTMLHeadingElement>(null)
	useEffect(() => titleRef.current?.focus(), [])

	const pick = (day: Day) => {
		setBirthDay(day)
		setEditing(false)
		// where the planets stood that day: the clock glides there and stops
		travelAndStop(birthdayFacts(day, now).birthJD)
	}

	return (
		<section
			id="birthday-panel"
			className={classes.panel}
			aria-labelledby="birthday-title"
			// the scene's hotkeys (arrows, Space) must not fire while the calendar or the slider has the keys
			onKeyDown={(event) => {
				if (event.key !== "Escape") event.stopPropagation()
			}}
		>
			<Group
				justify="space-between"
				wrap="nowrap"
				gap="xs"
				className={classes.header}
			>
				<Title
					order={2}
					size="h5"
					id="birthday-title"
					ref={titleRef}
					tabIndex={-1}
					className={classes.title}
				>
					{t("solarSystem.birthday.title")}
				</Title>
				<CloseButton
					size="sm"
					aria-label={t("solarSystem.birthday.close")}
					onClick={() => setOpen(false)}
				/>
			</Group>
			<div className={classes.body}>
				<Stack gap="sm">
					{facts === null || editing ? (
						<>
							<Text size="sm" c="gray.3" lh={1.45}>
								{t("solarSystem.birthday.intro")}
							</Text>
							<BirthCalendar now={now} value={birthDay} onPick={pick} />
						</>
					) : (
						<Results facts={facts} onChange={() => setEditing(true)} />
					)}
					<Group gap={6} wrap="nowrap" align="flex-start">
						<IconLock size={16} className={classes.lock} />
						<Stack gap={2}>
							<Text size="xs" c="gray.4" lh={1.4}>
								{t("solarSystem.birthday.privacy")}
							</Text>
							{birthDay !== null ? (
								<Text size="xs" c="dimmed" lh={1.4}>
									{t("solarSystem.birthday.privacyLink")}
								</Text>
							) : null}
						</Stack>
					</Group>
				</Stack>
			</div>
		</section>
	)
}

export default BirthdayPanel
