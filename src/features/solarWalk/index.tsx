import { Fragment, useEffect, useId, useMemo, useRef } from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Button, Group, SegmentedControl, Text, Title } from "@mantine/core"
import { useMediaQuery } from "@mantine/hooks"
import { IconArrowLeft, IconPlanet, IconPrinter } from "@tabler/icons-react"

import { useBackToSolarSystem } from "@/hooks/useBackToSolarSystem"
import { useI18n } from "@/i18n"
import { CornerBar } from "@/features/help/HelpButton"
import { useBodyName } from "@/i18n/bodies"

import { formatLength } from "./lengths"
import {
	DEFAULT_LANDMARK,
	DEFAULT_SUN_OBJECT,
	DEFAULT_WALK_VIEW,
	LANDMARK_OPTIONS,
	SUN_OBJECT_IDS,
	WALK_VIEWS,
	type LandmarkOption,
	type SolarWalkSearch,
	type SunObjectId,
	type WalkView,
} from "./search"
import {
	LANDMARKS,
	SUN_OBJECTS,
	buildWalk,
	landmarkOnWalk,
	stopOf,
} from "./walk"
import {
	landmarkMarkerText,
	leadText,
	legText,
	starText,
	stopText,
	summaryText,
	sunStopText,
	titleText,
} from "./walkText"
import { AnchorLink, ButtonLink } from "./links"
import WalkTable from "./WalkTable"

import classes from "./SolarWalk.module.css"

/**
 * The basketball solar system (#25): choose what the Sun is, and every planet
 * becomes an everyday thing at a distance a class can walk out on a school
 * field. The walk is the experience; the table is for projecting and for the
 * printed hand-out. Built on #21's true scale (see walk.ts). A link from a
 * world's card (`?focus=jupiter`, #48) opens it on that world's line.
 */
const SolarWalk = () => {
	const i18n = useI18n()
	const { t, formatLocale } = i18n
	const name = useBodyName()
	const id = useId()
	const narrow = useMediaQuery("(max-width: 40em)") ?? false
	const search = useSearch({ from: "/solar_walk" })
	const navigate = useNavigate({ from: "/solar_walk" })
	// opened from a link: the 3D model at the same true scale
	const back = useBackToSolarSystem({ scale: "trueScale" })

	const sunObject = search.sun ?? DEFAULT_SUN_OBJECT
	const landmarkOption = search.landmark ?? DEFAULT_LANDMARK
	const landmark = landmarkOption === "none" ? null : landmarkOption
	const view = search.view ?? DEFAULT_WALK_VIEW
	const walk = useMemo(() => buildWalk(sunObject), [sunObject])
	const marker = landmark === null ? null : landmarkOnWalk(walk, landmark)
	// the body a link asked for, and the stop its line is on
	const focus = search.focus ?? null
	const focusStop =
		focus === null || focus === "sun"
			? focus
			: (stopOf(walk, focus)?.id ?? null)
	const focused = (bodyId: string) => (bodyId === focus ? true : undefined)
	const walkRef = useRef<HTMLOListElement>(null)
	const tableRef = useRef<HTMLDivElement>(null)
	// arriving on a body: its line in the middle of the screen, in the view on show
	useEffect(() => {
		if (focus === null) return
		const shown = view === "walk" ? walkRef.current : tableRef.current
		shown?.querySelector("[data-focused]")?.scrollIntoView({ block: "center" })
	}, [focus, view])

	// defaults stay out of the URL, so a plain link means the same for everyone
	const setSearch = (patch: SolarWalkSearch) =>
		void navigate({
			search: (prev) => ({ ...prev, ...patch }),
			replace: true,
		})
	const setSun = (value: SunObjectId) =>
		setSearch({ sun: value === DEFAULT_SUN_OBJECT ? undefined : value })
	const setLandmark = (value: LandmarkOption) =>
		setSearch({ landmark: value === DEFAULT_LANDMARK ? undefined : value })
	const setView = (value: WalkView) =>
		setSearch({ view: value === DEFAULT_WALK_VIEW ? undefined : value })

	const length = (metres: number) => formatLength(metres, formatLocale)
	const orientation = narrow ? "vertical" : "horizontal"

	return (
		<div className={classes.page}>
			<div className={classes.noPrint}>
				<CornerBar />
			</div>
			<div className={classes.inner}>
				<header className={classes.header}>
					{/* the same Back as the help page and the comparison (#45, #46) */}
					<Button
						variant="subtle"
						color="gray"
						leftSection={<IconArrowLeft size={18} aria-hidden />}
						onClick={back}
						className={classes.back}
					>
						{t("solarWalk.back")}
					</Button>
					<Title order={1} className={classes.title}>
						{titleText(walk, i18n)}
					</Title>
					<Text className={classes.lead}>{leadText(walk, i18n)}</Text>
				</header>

				<section className={classes.controls}>
					<div className={classes.control}>
						<span className={classes.controlLabel} id={`${id}-sun`}>
							{t("solarWalk.sunLabel")}
						</span>
						<SegmentedControl
							aria-labelledby={`${id}-sun`}
							orientation={orientation}
							fullWidth
							color="orange"
							value={sunObject}
							onChange={(value) => setSun(value as SunObjectId)}
							data={SUN_OBJECT_IDS.map((objectId) => ({
								value: objectId,
								label: (
									<span className={classes.option}>
										<span>{t(`solarWalk.sunObjectName.${objectId}`)}</span>
										<span className={classes.optionSize}>
											{length(SUN_OBJECTS[objectId].diameterM)}
										</span>
									</span>
								),
							}))}
						/>
					</div>
					<div className={classes.control}>
						<span className={classes.controlLabel} id={`${id}-landmark`}>
							{t("solarWalk.landmarkLabel")}
						</span>
						<SegmentedControl
							aria-labelledby={`${id}-landmark`}
							orientation={orientation}
							fullWidth
							value={landmarkOption}
							onChange={(value) => setLandmark(value as LandmarkOption)}
							data={LANDMARK_OPTIONS.map((option) => ({
								value: option,
								label: t(`solarWalk.landmarkOption.${option}`, {
									length:
										option === "none" ? "" : length(LANDMARKS[option].lengthM),
								}),
							}))}
						/>
					</div>
					<Group className={classes.actions} gap="sm">
						<div className={classes.control}>
							<span className={classes.controlLabel} id={`${id}-view`}>
								{t("solarWalk.viewLabel")}
							</span>
							<SegmentedControl
								aria-labelledby={`${id}-view`}
								value={view}
								onChange={(value) => setView(value as WalkView)}
								data={WALK_VIEWS.map((option) => ({
									value: option,
									label: t(`solarWalk.view.${option}`),
								}))}
							/>
						</div>
						<Group gap="xs" className={classes.buttons}>
							<Button
								variant="light"
								color="orange"
								leftSection={<IconPrinter size={16} aria-hidden />}
								onClick={() => window.print()}
							>
								{t("solarWalk.print")}
							</Button>
							<ButtonLink
								to="/solar_system"
								search={{ scale: "trueScale" }}
								variant="subtle"
								color="gray"
								leftSection={<IconPlanet size={16} aria-hidden />}
							>
								{t("solarWalk.open3d")}
							</ButtonLink>
						</Group>
					</Group>
				</section>

				<Text className={classes.summary}>{summaryText(walk, i18n)}</Text>

				<ol
					ref={walkRef}
					className={`${classes.walk} ${view === "walk" ? "" : classes.screenHidden}`}
					aria-label={titleText(walk, i18n)}
				>
					<li
						className={classes.stop}
						data-stop="sun"
						data-focused={focused("sun")}
						aria-current={focusStop === "sun" ? "location" : undefined}
					>
						<article className={`${classes.card} ${classes.sunCard}`}>
							<header className={classes.cardHeader}>
								<span className={classes.start}>{t("solarWalk.start")}</span>
								<h2 className={classes.cardTitle}>{name("sun")}</h2>
							</header>
							<p className={classes.line}>{sunStopText(walk, i18n)}</p>
						</article>
					</li>
					{walk.stops.map((stop, index) => {
						const atMarker = marker !== null && marker.before === index
						const text = stopText(
							stop,
							landmark,
							i18n,
							name,
							atMarker ? marker.toNextM : stop.legM,
						)
						return (
							<Fragment key={stop.id}>
								{atMarker && landmark !== null && (
									<li className={classes.markerStop} data-landmark={landmark}>
										<p className={classes.leg}>
											{legText(marker.fromPreviousM, i18n)}
										</p>
										<p className={classes.marker}>
											{landmarkMarkerText(landmark, i18n)}
										</p>
									</li>
								)}
								<li
									className={classes.stop}
									data-stop={stop.id}
									data-focused={focused(stop.id)}
									aria-current={focusStop === stop.id ? "location" : undefined}
								>
									<p className={classes.leg}>{text.leg}</p>
									<article className={classes.card}>
										<header className={classes.cardHeader}>
											<span className={classes.number}>{index + 1}</span>
											<h2 className={classes.cardTitle}>{name(stop.id)}</h2>
											<AnchorLink
												to="/solar_system"
												search={{ scale: "trueScale", focus: stop.id }}
												className={classes.open3d}
												aria-label={t("solarWalk.open3dBody", {
													name: name(stop.id),
												})}
												title={t("solarWalk.open3dBody", {
													name: name(stop.id),
												})}
											>
												<IconPlanet size={18} aria-hidden />
											</AnchorLink>
										</header>
										<p className={classes.size}>{text.size}</p>
										<p className={classes.line}>
											{text.distance}
											{text.landmark !== null && (
												<span className={classes.landmark}>
													{" · "}
													{text.landmark}
												</span>
											)}
										</p>
										{text.moons.length > 0 && (
											<ul className={classes.moons}>
												{text.moons.map((line, i) => (
													<li
														key={stop.moons[i].id}
														data-moon={stop.moons[i].id}
														data-focused={focused(stop.moons[i].id)}
													>
														{line}
													</li>
												))}
											</ul>
										)}
									</article>
								</li>
							</Fragment>
						)
					})}
				</ol>

				<div
					ref={tableRef}
					className={`${classes.tableView} ${view === "table" ? "" : classes.screenHidden}`}
				>
					<WalkTable walk={walk} landmark={landmark} focus={focus} />
					<p className={classes.printNote}>{t("solarWalk.printNote")}</p>
				</div>

				<section className={classes.star} aria-labelledby={`${id}-star`}>
					<p className={classes.farLeg} aria-hidden>
						{length(walk.nearestStar.distanceM)}
					</p>
					<h2 id={`${id}-star`} className={classes.starTitle}>
						{t("solarWalk.starTitle")}
					</h2>
					<p className={classes.starText}>{starText(walk, i18n)}</p>
					<p className={classes.starLesson}>{t("solarWalk.starLesson")}</p>
				</section>

				<Text className={classes.note}>{t("solarWalk.lineUp")}</Text>
			</div>
		</div>
	)
}

export default SolarWalk
