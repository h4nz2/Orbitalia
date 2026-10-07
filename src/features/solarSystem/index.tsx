import { Suspense } from "react"

import { HelpButton } from "@/features/help/HelpButton"
import { LanguageMenu } from "@/i18n"
import Loader from "@/primitives/Loader"
import { isFrameAnchored } from "@/store/navigation"
import { useSimStore } from "@/store/sim"
import { useSimUrlSync } from "@/store/urlSync"

import FrameBadge from "./frame/FrameBadge"
import FrameMenu from "./frame/FrameMenu"
import IntroController from "./intro/IntroController"
import IntroMenu from "./intro/IntroMenu"
import IntroOverlay from "./intro/IntroOverlay"
import IntroPulse from "./intro/IntroPulse"
import { PostcardSlot } from "./postcard/Postcard"
import LightLink from "./light/LightLink"
import { LightSlot } from "./light/LightPanel"
import { TeacherBar } from "./present/TeacherBar"
import PresentationLayer from "./present/PresentationLayer"
import Scene from "./scene/Scene"
import { DockPanels, EntryBar } from "./dock/Dock"
import SoundControl from "./sound/SoundControl"
import SoundDirector from "./sound/SoundDirector"
import CraftLink from "./spacecraft/CraftLink"
import SpacecraftInfo from "./spacecraft/SpacecraftInfo"
import EventCard from "./events/EventCard"
import {
	QuickLookAsk,
	QuickLookCard,
	QuickLookController,
} from "./quickLook/QuickLook"
import TourCard from "./tours/TourCard"
import TourSync from "./tours/TourSync"
import BodyHighlight from "./ui/BodyHighlight"
import BodyInfo from "./ui/BodyInfo"
import { WalkNudge } from "./walk/WalkOffer"
import { freeCentreId } from "./ui/centre"
import CentreBadge from "./ui/CentreBadge"
import CentreMarker from "./ui/CentreMarker"
import FlightReadout from "./ui/FlightReadout"
import FocusPicker from "./ui/FocusPicker"
import OverviewButton from "./ui/OverviewButton"
import TimeControls from "./ui/TimeControls"

import classes from "./SolarSystem.module.css"

/**
 * Mirrors the store into the URL and back (src/store/urlSync.ts). An empty
 * component of its own, so the search-param subscription re-renders this node
 * alone and never the page or the Canvas. It must stay rendered BEFORE
 * <Scene />: layout effects run in tree order, so the URL seeds the store
 * before the Canvas mounts and a deep link (?focus=earth) is framed on its
 * body from the first frame instead of dollying there from the Sun.
 */
const UrlSync = () => {
	useSimUrlSync()
	return null
}

/** The centre badge's HUD panel, present only while the view is a free point in space (#15). */
const CentreBadgePanel = () => {
	const free = useSimStore((state) => freeCentreId(state) !== null)
	if (!free) return null
	return (
		<div className={`${classes.panel} ${classes.centre}`}>
			<CentreBadge />
		</div>
	)
}

/** The anchored frame's badge (#31), present only while a body is held still. */
const FrameBadgePanel = () => {
	const anchored = useSimStore((state) => isFrameAnchored(state))
	if (!anchored) return null
	return (
		<div className={classes.panel}>
			<FrameBadge />
		</div>
	)
}

/**
 * The solar system page: the 3D scene filling the viewport with a quiet HUD
 * floating above it (#42; docs/ARCHITECTURE.md, "HUD layout"). On screen all
 * the time: what you look at and the way out (top left), whether time runs
 * (the time bar), the teacher's corner (top right) and the four entry points
 * (bottom right). Everything else waits behind those, one panel at a time in
 * the dock, and the secondary controls dim while the camera moves.
 */
const SolarSystem = () => {
	return (
		<div className={classes.page}>
			<UrlSync />
			<IntroController />
			<SoundDirector />
			<TourSync />
			{/* after TourSync, which ends a tour left over from before on arrival */}
			<QuickLookController />
			<Suspense fallback={<Loader />}>
				<Scene />
			</Suspense>
			<BodyHighlight />
			<IntroPulse />
			<CentreMarker />
			<div className={classes.hud} data-testid="hud">
				<div className={classes.pickerStack}>
					<div
						className={`${classes.panel} ${classes.picker}`}
						data-steady
						data-testid="where"
					>
						<OverviewButton />
						<FocusPicker />
						<div className={classes.frame} data-dim>
							<FrameMenu />
						</div>
					</div>
					<FrameBadgePanel />
					<LightSlot
						mode="chip"
						className={`${classes.panel} ${classes.light}`}
					/>
				</div>
				<CentreBadgePanel />
				<div
					className={`${classes.panel} ${classes.corner}`}
					data-testid="corner"
					data-hud-corner
				>
					<TeacherBar>
						<SoundControl />
						<HelpButton />
						<IntroMenu />
						<LanguageMenu />
					</TeacherBar>
				</div>
				<IntroOverlay className={classes.intro} />
				<div className={`${classes.panel} ${classes.info}`} data-steady>
					<SpacecraftInfo fallback={<BodyInfo />} />
				</div>
				<div className={classes.dock} data-testid="dock">
					<DockPanels />
					<WalkNudge className={classes.panel} />
					<TourCard className={`${classes.panel} ${classes.tour}`} />
					<EventCard className={`${classes.panel} ${classes.tour}`} />
					<QuickLookAsk className={`${classes.panel} ${classes.tour}`} />
					<QuickLookCard className={`${classes.panel} ${classes.tour}`} />
				</div>
				<div className={classes.bottom}>
					<div className={classes.time}>
						<FlightReadout className={classes.panel} />
						<div className={classes.panel} data-steady data-testid="time-bar">
							<TimeControls />
						</div>
					</div>
					<EntryBar />
				</div>
			</div>
			<CraftLink />
			<LightLink />
			<PostcardSlot />
			<PresentationLayer />
		</div>
	)
}

export default SolarSystem
