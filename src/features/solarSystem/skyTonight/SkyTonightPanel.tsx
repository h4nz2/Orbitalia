import { useEffect, useMemo, useRef, useState } from "react"
import {
	Badge,
	Button,
	CloseButton,
	Divider,
	Group,
	Loader,
	Select,
	Stack,
	Text,
	Title,
} from "@mantine/core"
import {
	IconBinoculars,
	IconCurrentLocation,
	IconEye,
	IconLock,
	IconMapPin,
	IconRocket,
	IconTelescope,
} from "@tabler/icons-react"

import { useI18n } from "@/i18n"
import { useBodyName } from "@/i18n/bodies"
import { Hint } from "@/primitives/hint"
import { useSkyTonightStore, type SkyPlaceChoice } from "@/store/skyTonight"

import { worldColor } from "../birthday/card"
import { litPath } from "../frame/sky"
import { showWhy } from "./explain"
import {
	cityNear,
	deviceTimeZone,
	locateDevice,
	placeOf,
	suggestion,
} from "./location"
import { citiesOf, cityName, countries, countryName } from "./places"
import {
	skyTonight,
	type Aid,
	type Sighting,
	type SkyPlace,
	type SkyTonight,
} from "./sky"
import {
	formatNightDate,
	formatShortDate,
	hiddenText,
	lookText,
	sunText,
	whenText,
	whereLines,
	whyText,
} from "./text"

import classes from "./SkyTonight.module.css"

const DISC_RADIUS = 24

const AID_ICON: Record<Aid, typeof IconEye> = {
	eyes: IconEye,
	binoculars: IconBinoculars,
	telescope: IconTelescope,
}
const AID_COLOR: Record<Aid, string> = {
	eyes: "teal",
	binoculars: "yellow",
	telescope: "gray",
}

const Dot = ({ id }: { id: string }) => (
	<span
		className={classes.dot}
		style={{ background: worldColor(id) }}
		aria-hidden
	/>
)

/** "Eyes only" / "Binoculars" / "Telescope". */
const AidBadge = ({ aid }: { aid: Aid }) => {
	const { t } = useI18n()
	const Icon = AID_ICON[aid]
	return (
		<Badge
			size="sm"
			variant="light"
			color={AID_COLOR[aid]}
			leftSection={<Icon size={12} />}
			data-aid={aid}
		>
			{t(`solarSystem.sky.aid.${aid}`)}
		</Badge>
	)
}

/** Explains the geometry behind a sighting and offers to show it in 3D. */
const Why = ({ sighting, sky }: { sighting: Sighting; sky: SkyTonight }) => {
	const i18n = useI18n()
	const name = useBodyName()
	const [open, setOpen] = useState(false)
	return (
		<>
			<Button
				variant="subtle"
				color="orange"
				size="compact-xs"
				px={4}
				aria-expanded={open}
				onClick={() => setOpen(!open)}
			>
				{open
					? i18n.t("solarSystem.sky.why.hide")
					: i18n.t("solarSystem.sky.why.button")}
			</Button>
			{open ? (
				<div className={classes.why}>
					<Stack gap={6}>
						<Text size="xs" c="gray.3" lh={1.45}>
							{whyText(sighting, sky.moon.phase.fraction, name, i18n)}
						</Text>
						<Hint
							text={i18n.t("solarSystem.sky.why.showHint", {
								body: name(sighting.id),
							})}
						>
							<Button
								variant="light"
								color="orange"
								size="compact-sm"
								leftSection={<IconRocket size={14} />}
								onClick={() => {
									showWhy(sighting.id, sighting.first.ms)
									// the panel covers the side of the sky the planet is on: step aside
									// (the place is kept, the button in the time controls brings it back)
									useSkyTonightStore.getState().setOpen(false)
								}}
								style={{ alignSelf: "flex-start" }}
							>
								{i18n.t("solarSystem.sky.why.show")}
							</Button>
						</Hint>
					</Stack>
				</div>
			) : null}
		</>
	)
}

/** When and where to look for one body, and what it looks like. */
const SightingDetails = ({
	sighting,
	sky,
	timeZone,
}: {
	sighting: Sighting
	sky: SkyTonight
	timeZone: string
}) => {
	const i18n = useI18n()
	return (
		<Stack gap={2}>
			<Text size="sm" c="gray.1" data-part="when">
				{whenText(sighting, timeZone, i18n)}
			</Text>
			{whereLines(sighting, timeZone, i18n).map((line, k) => (
				<Text key={k} size="xs" c="gray.4" lh={1.45} data-part="where">
					{line}
				</Text>
			))}
			{sighting.id === "moon" ? null : (
				<Text size="xs" c="gray.3" lh={1.45}>
					{lookText(sighting, i18n)}
				</Text>
			)}
			{i18n.readingLevel === "advanced" ? (
				<Text size="xs" c="dimmed">
					{i18n.t("solarSystem.sky.magnitude", {
						magnitude: i18n.significant(sighting.magnitude, 2),
					})}
				</Text>
			) : null}
			<div>
				<Why sighting={sighting} sky={sky} />
			</div>
		</Stack>
	)
}

/** The Moon: its phase as a disc (turned round south of the equator), and when and where. */
const MoonCard = ({ sky, place }: { sky: SkyTonight; place: SkyPlace }) => {
	const i18n = useI18n()
	const { t } = i18n
	const name = useBodyName()
	const moon = sky.sightings.find((s) => s.id === "moon")
	const { phase } = sky.moon
	const phaseName = t(`solarSystem.frame.phase.name.${phase.id}`, {
		bodyId: "moon",
	})
	const r = DISC_RADIUS
	return (
		<div className={classes.moon} data-sky-body="moon" data-phase={phase.id}>
			<svg
				className={classes.disc}
				viewBox={`${-r - 2} ${-r - 2} ${2 * r + 4} ${2 * r + 4}`}
				data-south={place.latitude < 0 ? true : undefined}
				aria-hidden
			>
				<circle r={r} className={classes.discDark} />
				<path d={litPath(phase, r)} className={classes.discLit} />
			</svg>
			<Stack gap={2} className={classes.main}>
				<Text size="sm" fw={600}>
					{name("moon")}
					<Text span size="sm" fw={400} c="gray.3">
						{" · "}
						{t("solarSystem.sky.moon.phase", {
							phase: phaseName,
							fraction: phase.fraction,
						})}
					</Text>
				</Text>
				{moon === undefined ? null : moon.visible ? (
					<SightingDetails
						sighting={moon}
						sky={sky}
						timeZone={place.timeZone}
					/>
				) : (
					<Text size="xs" c="gray.4">
						{hiddenText(moon, name, i18n)}
					</Text>
				)}
				<Text size="xs" c="dimmed">
					{t("solarSystem.sky.moon.next", {
						full: formatShortDate(
							sky.moon.nextFull,
							place.timeZone,
							i18n.formatLocale,
						),
						new: formatShortDate(
							sky.moon.nextNew,
							place.timeZone,
							i18n.formatLocale,
						),
					})}
				</Text>
			</Stack>
		</div>
	)
}

/** The night at a place: sunset and darkness, the Moon, the planets to look for, and those that hide. */
const Tonight = ({
	choice,
	place,
}: {
	choice: SkyPlaceChoice
	place: SkyPlace
}) => {
	const i18n = useI18n()
	const { t, formatLocale } = i18n
	const name = useBodyName()
	const forgetPlace = useSkyTonightStore((state) => state.forgetPlace)
	// "now" is read once per opening: tonight does not change while being read
	const [now] = useState(() => Date.now())
	const sky = useMemo(() => skyTonight(place, now), [place, now])
	const near = cityNear(choice)
	const nearName = near === null ? null : cityName(near, formatLocale)
	const placeLine =
		choice.kind === "city" && near !== null
			? t("solarSystem.sky.place.city", {
					city: nearName,
					country: countryName(near.country, formatLocale),
				})
			: nearName !== null
				? t("solarSystem.sky.place.deviceNear", { city: nearName })
				: t("solarSystem.sky.place.device")
	const title =
		choice.kind === "city" && nearName !== null
			? t("solarSystem.sky.night.tonight", { place: nearName })
			: nearName !== null
				? t("solarSystem.sky.night.tonightNear", { city: nearName })
				: t("solarSystem.sky.night.tonightHere")
	const planets = sky.sightings.filter((s) => s.id !== "moon")
	// in the order they can be seen: the evening's first
	const visible = planets
		.filter((s) => s.visible)
		.sort((a, b) => a.from - b.from)
	const hidden = planets.filter((s) => !s.visible)
	const otherZone = place.timeZone !== deviceTimeZone()

	return (
		<Stack gap="sm" data-sky-kind={sky.kind}>
			<Group justify="space-between" wrap="nowrap" gap="xs">
				<Group gap={6} wrap="nowrap" miw={0}>
					<IconMapPin size={16} style={{ flex: "none" }} />
					<Text size="sm" truncate data-testid="sky-place">
						{placeLine}
					</Text>
				</Group>
				<Button
					variant="subtle"
					color="orange"
					size="compact-xs"
					onClick={forgetPlace}
				>
					{t("solarSystem.sky.place.change")}
				</Button>
			</Group>
			<Stack gap={2}>
				<Title order={3} size="h4">
					{title}
				</Title>
				<Text size="xs" c="gray.4">
					{t("solarSystem.sky.night.date", {
						date: formatNightDate(sky.start, place.timeZone, formatLocale),
					})}
				</Text>
				<Text size="xs" c="gray.3" data-testid="sky-sun">
					{sunText(sky, place.timeZone, i18n)}
				</Text>
				{otherZone ? (
					<Text size="xs" c="dimmed">
						{t("solarSystem.sky.place.zone")}
					</Text>
				) : null}
			</Stack>
			<MoonCard sky={sky} place={place} />
			<Title order={4} size="h6" c="orange.4">
				{t("solarSystem.sky.visible")}
			</Title>
			{visible.length === 0 ? (
				<Text size="sm" c="gray.3">
					{t("solarSystem.sky.none")}
				</Text>
			) : (
				<ul className={classes.list} data-testid="sky-visible">
					{visible.map((sighting) => (
						<li
							key={sighting.id}
							className={classes.row}
							data-sky-body={sighting.id}
							data-visible
						>
							<Dot id={sighting.id} />
							<Stack gap={4} className={classes.main}>
								<Group gap="xs" wrap="wrap">
									<Text size="sm" fw={600}>
										{name(sighting.id)}
									</Text>
									<AidBadge aid={sighting.aid} />
								</Group>
								<SightingDetails
									sighting={sighting}
									sky={sky}
									timeZone={place.timeZone}
								/>
							</Stack>
						</li>
					))}
				</ul>
			)}
			<Text size="xs" c="gray.4" lh={1.45}>
				{t("solarSystem.sky.tip")}
			</Text>
			{hidden.length > 0 ? (
				<>
					<Title order={4} size="h6" c="gray.5">
						{t("solarSystem.sky.hidden")}
					</Title>
					<ul className={classes.list} data-testid="sky-hidden">
						{hidden.map((sighting) => (
							<li
								key={sighting.id}
								className={`${classes.row} ${classes.hiddenRow}`}
								data-sky-body={sighting.id}
							>
								<Dot id={sighting.id} />
								<Text size="xs" c="gray.4" lh={1.45} className={classes.main}>
									{hiddenText(sighting, name, i18n)}
								</Text>
							</li>
						))}
					</ul>
				</>
			) : null}
		</Stack>
	)
}

type DeviceStep = "idle" | "explain" | "locating" | "denied" | "failed"

/**
 * Asks where the visitor is, and never assumes: a suggestion from the time
 * zone to confirm with one tap, a country and city list, and the device's
 * location only after an explanation and an explicit second tap.
 */
const AskPlace = () => {
	const { t, formatLocale } = useI18n()
	const choosePlace = useSkyTonightStore((state) => state.choosePlace)
	const [suggested] = useState(suggestion)
	const [country, setCountry] = useState<string | null>(suggested.country)
	const [cityId, setCityId] = useState<string | null>(suggested.id)
	const [device, setDevice] = useState<DeviceStep>("idle")
	const countryItems = useMemo(
		() =>
			countries(formatLocale).map((c) => ({ value: c.code, label: c.name })),
		[formatLocale],
	)
	const cityItems = useMemo(
		() =>
			country === null
				? []
				: citiesOf(country, formatLocale).map((city) => ({
						value: city.id,
						label: cityName(city, formatLocale),
					})),
		[country, formatLocale],
	)

	const locate = async () => {
		setDevice("locating")
		const result = await locateDevice()
		if (result.ok) choosePlace(result.choice)
		else setDevice(result.reason)
	}

	return (
		<Stack gap="sm">
			<Title order={3} size="h5">
				{t("solarSystem.sky.ask.title")}
			</Title>
			<Text size="sm" c="gray.3" lh={1.45}>
				{t("solarSystem.sky.ask.why")}
			</Text>
			{/* the phone's sheet brings the question into view as the panel opens (#62) */}
			<div className={classes.suggestion} data-sheet-main>
				<Stack gap={6}>
					<Text size="sm" fw={600}>
						{t("solarSystem.sky.ask.suggestion", {
							city: t("solarSystem.sky.place.city", {
								city: cityName(suggested, formatLocale),
								country: countryName(suggested.country, formatLocale),
							}),
						})}
					</Text>
					<Button
						color="orange"
						size="compact-md"
						onClick={() => choosePlace({ kind: "city", cityId: suggested.id })}
						style={{ alignSelf: "flex-start" }}
					>
						{t("solarSystem.sky.ask.confirm")}
					</Button>
					<Text size="xs" c="dimmed">
						{t("solarSystem.sky.ask.suggestionHint")}
					</Text>
				</Stack>
			</div>
			<Divider
				label={t("solarSystem.sky.ask.other")}
				labelPosition="left"
				color="dark.4"
			/>
			<Group gap="xs" grow align="flex-end">
				<Select
					size="sm"
					label={t("solarSystem.sky.ask.country")}
					data={countryItems}
					value={country}
					onChange={(value) => {
						setCountry(value)
						const first = value === null ? [] : citiesOf(value, formatLocale)
						setCityId(first.length === 1 ? first[0].id : null)
					}}
					searchable
					allowDeselect={false}
					nothingFoundMessage="—"
					comboboxProps={{ withinPortal: false }}
					data-testid="sky-country"
				/>
				<Select
					size="sm"
					label={t("solarSystem.sky.ask.city")}
					data={cityItems}
					value={cityId}
					onChange={setCityId}
					searchable
					allowDeselect={false}
					nothingFoundMessage="—"
					disabled={country === null}
					comboboxProps={{ withinPortal: false }}
					data-testid="sky-city"
				/>
			</Group>
			<Button
				variant="light"
				color="orange"
				size="compact-md"
				disabled={cityId === null}
				onClick={() => {
					if (cityId !== null) choosePlace({ kind: "city", cityId })
				}}
				style={{ alignSelf: "flex-start" }}
			>
				{t("solarSystem.sky.ask.show")}
			</Button>
			<Divider color="dark.4" />
			{device === "idle" ? (
				<Button
					variant="subtle"
					color="gray"
					size="compact-sm"
					leftSection={<IconCurrentLocation size={16} />}
					onClick={() => setDevice("explain")}
					style={{ alignSelf: "flex-start" }}
				>
					{t("solarSystem.sky.ask.device")}
				</Button>
			) : (
				<div className={classes.explain}>
					<Stack gap={6}>
						<Text size="xs" c="gray.3" lh={1.45}>
							{t("solarSystem.sky.ask.deviceExplain")}
						</Text>
						{device === "locating" ? (
							<Group gap="xs">
								<Loader size="xs" color="orange" />
								<Text size="xs">{t("solarSystem.sky.ask.locating")}</Text>
							</Group>
						) : device === "explain" ? (
							<Group gap="xs">
								<Button
									color="orange"
									size="compact-sm"
									leftSection={<IconCurrentLocation size={14} />}
									onClick={() => void locate()}
								>
									{t("solarSystem.sky.ask.deviceConfirm")}
								</Button>
								<Button
									variant="subtle"
									color="gray"
									size="compact-sm"
									onClick={() => setDevice("idle")}
								>
									{t("solarSystem.sky.ask.deviceCancel")}
								</Button>
							</Group>
						) : (
							<Text size="xs" c="yellow.4" role="status">
								{t(`solarSystem.sky.ask.${device}`)}
							</Text>
						)}
					</Stack>
				</div>
			)}
		</Stack>
	)
}

/** "What is in the sky tonight" (issue #36): the docked panel. */
const SkyTonightPanel = () => {
	const { t } = useI18n()
	const choice = useSkyTonightStore((state) => state.place)
	const setOpen = useSkyTonightStore((state) => state.setOpen)
	const place = choice === null ? null : placeOf(choice)
	const titleRef = useRef<HTMLHeadingElement>(null)
	useEffect(() => titleRef.current?.focus(), [])

	return (
		<section
			id="sky-tonight-panel"
			className={classes.panel}
			aria-labelledby="sky-tonight-title"
			// the scene's hotkeys (arrows, Space) must not fire while a list has the keys
			onKeyDown={(event) => {
				if (event.key !== "Escape") event.stopPropagation()
			}}
		>
			<Group
				justify="space-between"
				wrap="nowrap"
				gap="xs"
				className={classes.header}
				data-sheet-summary
			>
				<Title
					order={2}
					size="h5"
					id="sky-tonight-title"
					ref={titleRef}
					tabIndex={-1}
					className={classes.title}
				>
					{t("solarSystem.sky.title")}
				</Title>
				<CloseButton
					size="sm"
					aria-label={t("solarSystem.sky.close")}
					onClick={() => setOpen(false)}
				/>
			</Group>
			<div className={classes.body}>
				<Stack gap="sm">
					{choice === null || place === null ? (
						<AskPlace />
					) : (
						<Tonight choice={choice} place={place} />
					)}
					<Group gap={6} wrap="nowrap" align="flex-start">
						<IconLock size={16} className={classes.privacy} />
						<Text size="xs" c="gray.4" lh={1.4}>
							{t("solarSystem.sky.ask.privacy")}
						</Text>
					</Group>
				</Stack>
			</div>
		</section>
	)
}

export default SkyTonightPanel
