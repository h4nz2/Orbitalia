/**
 * The quiet interface's entry points and dock (#42; docs/ARCHITECTURE.md,
 * "HUD layout"). While someone looks around, the screen belongs to space: the
 * scene layers, the scale and the tools wait behind four named buttons at the
 * bottom right (Tours, Layers, Scale, Tools), and whatever they open appears
 * in one place, the dock above them (on phones a sheet from the bottom), one
 * panel at a time.
 */
import { useEffect, type ReactNode } from "react"
import { Button } from "@mantine/core"
import {
	IconRuler2,
	IconSatellite,
	IconStack2,
	IconTools,
} from "@tabler/icons-react"

import { useI18n } from "@/i18n"
import { Hint } from "@/primitives/hint"
import { useHudStore, type HudPanel } from "@/store/hud"
import { useScaleStore } from "@/store/scale"

import { BirthdayPanelSlot } from "../birthday/Birthday"
import { HuntPanelSlot } from "../hunt/Hunt"
import { LightSlot } from "../light/LightPanel"
import { SkyTonightSlot } from "../skyTonight/SkyTonight"
import { SpacecraftList } from "../spacecraft/SpacecraftMenu"
import TourMenu from "../tours/TourMenu"
import ScalePanel from "../ui/ScalePanel"
import SceneToggles from "../ui/SceneToggles"
import DockPanel from "./DockPanel"
import { keepDockToOnePanel } from "./exclusive"
import ToolsMenu, { ToolTiles } from "./ToolsMenu"

import hudClasses from "../SolarSystem.module.css"
import classes from "./Dock.module.css"

/** `data-camera="moving"` on <html> while the camera moves: the styles dim the secondary controls. */
function useCameraMotionDocument(): void {
	useEffect(() => {
		const root = document.documentElement
		const apply = (moving: boolean) => {
			if (moving) root.setAttribute("data-camera", "moving")
			else root.removeAttribute("data-camera")
		}
		apply(useHudStore.getState().cameraMoving)
		const stop = useHudStore.subscribe((state, previous) => {
			if (state.cameraMoving !== previous.cameraMoving)
				apply(state.cameraMoving)
		})
		return () => {
			stop()
			root.removeAttribute("data-camera")
		}
	}, [])
}

/** Whatever the dock holds: one of the HUD's panels or one tool (never two, `exclusive.ts`). */
export function DockPanels() {
	const { t } = useI18n()
	const panel = useHudStore((state) => state.panel)
	const setPanel = useHudStore((state) => state.setPanel)
	useEffect(() => keepDockToOnePanel(), [])
	useCameraMotionDocument()
	// leaving the page closes the dock; coming back starts calm
	useEffect(() => () => useHudStore.getState().setPanel(null), [])
	const close = () => setPanel(null)

	return (
		<>
			{panel === "layers" && (
				<DockPanel
					id="layers"
					title={t("solarSystem.present.layers")}
					icon={<IconStack2 size={16} aria-hidden className={classes.icon} />}
					onClose={close}
				>
					<div className={classes.layers}>
						<SceneToggles />
					</div>
				</DockPanel>
			)}
			{panel === "scale" && (
				<DockPanel
					id="scale"
					labelled={false}
					title={t("solarSystem.scale.label")}
					icon={<IconRuler2 size={16} aria-hidden className={classes.icon} />}
					onClose={close}
				>
					<ScalePanel heading={false} />
				</DockPanel>
			)}
			{panel === "spacecraft" && (
				<DockPanel
					id="spacecraft"
					title={t("solarSystem.spacecraft.menuTitle")}
					icon={
						<IconSatellite size={16} aria-hidden className={classes.icon} />
					}
					onClose={close}
				>
					<SpacecraftList onPicked={close} />
				</DockPanel>
			)}
			{/* Tools as tiles, on a phone held upright (#62): all nine in view, so shown whole */}
			{panel === "tools" && (
				<DockPanel
					id="tools"
					title={t("solarSystem.hud.tools")}
					icon={<IconTools size={16} aria-hidden className={classes.icon} />}
					onClose={close}
					whole
				>
					<ToolTiles />
				</DockPanel>
			)}
			<LightSlot
				mode="panel"
				className={`${hudClasses.panel} ${classes.lightPanel}`}
			/>
			<BirthdayPanelSlot />
			<SkyTonightSlot />
			<HuntPanelSlot />
		</>
	)
}

/** An entry point that opens one of the HUD's panels in the dock. */
function EntryButton({
	panel,
	icon,
	label,
	hint,
	children,
}: {
	panel: HudPanel
	icon: ReactNode
	label: string
	hint: string
	children?: ReactNode
}) {
	const open = useHudStore((state) => state.panel === panel)
	const togglePanel = useHudStore((state) => state.togglePanel)
	return (
		<Hint text={hint}>
			<Button
				variant={open ? "light" : "subtle"}
				color={open ? "orange" : "gray"}
				size="compact-sm"
				className={classes.entry}
				leftSection={icon}
				aria-label={label}
				aria-expanded={open}
				data-entry={panel}
				onClick={() => togglePanel(panel)}
			>
				{children ?? label}
			</Button>
		</Hint>
	)
}

/** Scale, naming the preset on screen: the honest word stays in view while the panel is closed. */
function ScaleButton() {
	const { t } = useI18n()
	const targetId = useScaleStore((state) => state.targetId)
	const label = t("solarSystem.scale.label")
	const preset =
		targetId === null
			? t("solarSystem.hud.customScale")
			: t(`solarSystem.scale.preset.${targetId}`)
	return (
		<EntryButton
			panel="scale"
			icon={<IconRuler2 size={16} aria-hidden />}
			label={t("solarSystem.hud.scaleButton", { preset })}
			hint={t("solarSystem.hud.scaleHint")}
		>
			<span>{label}</span>
			<span className={classes.preset} data-scale-preset={targetId ?? "custom"}>
				{preset}
			</span>
		</EntryButton>
	)
}

/** The entry points, bottom right (#42): Tours, Layers, Scale and Tools. */
export function EntryBar() {
	const { t } = useI18n()
	return (
		<nav
			className={`${hudClasses.panel} ${classes.entries}`}
			aria-label={t("solarSystem.hud.entries")}
			data-testid="entry-bar"
		>
			<TourMenu />
			<EntryButton
				panel="layers"
				icon={<IconStack2 size={16} aria-hidden />}
				label={t("solarSystem.present.layers")}
				hint={t("solarSystem.present.layersHint")}
			/>
			<ScaleButton />
			<ToolsMenu />
		</nav>
	)
}
