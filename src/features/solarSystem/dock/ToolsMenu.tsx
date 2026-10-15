/**
 * Tools (#42): one entry point for everything that opens a panel of its own
 * or leaves the scene for a moment. Each item says in one line what it does;
 * picking one opens it in the dock, closing whatever was open there
 * (`exclusive.ts`). New tools add an item here, not a button of their own
 * (docs/ARCHITECTURE.md, "HUD layout").
 *
 * On a phone held upright (#62) Tools is a panel of large tiles in the sheet
 * instead of a menu: what you do with a phone in your hand first, every tile
 * an icon and the tool's name, all nine in view at once. The tiles keep the
 * menu's `data-tool`, its words and what its items do.
 */
import { useEffect, type ReactNode } from "react"
import { Button, Menu, Text, UnstyledButton } from "@mantine/core"
import {
	IconBolt,
	IconBook,
	IconCake,
	IconCamera,
	IconMapSearch,
	IconMoonStars,
	IconSatellite,
	IconScale,
	IconTools,
	IconWalk,
} from "@tabler/icons-react"
import { useNavigate } from "@tanstack/react-router"

import { compareSearchFor } from "@/features/compare/links"

import { useUprightPhone } from "@/hooks/useSizeClass"
import { useI18n, type MessageKey } from "@/i18n"
import { Hint } from "@/primitives/hint"
import { useBirthdayStore } from "@/store/birthday"
import { useHudStore } from "@/store/hud"
import { useHuntStore } from "@/store/hunt"
import { useLightStore } from "@/store/light"
import { useSimStore } from "@/store/sim"
import { useSkyTonightStore } from "@/store/skyTonight"

import { takePostcard } from "../postcard/take"
import { openSky } from "../skyTonight/SkyTonight"
import { cardBodyId } from "../ui/BodyInfo"
import { nearestDictionaryEntry } from "../ui/dictionaryEntry"

import classes from "./Dock.module.css"

export type ToolId =
	| "light"
	| "sky"
	| "birthday"
	| "hunt"
	| "spacecraft"
	| "compare"
	| "walk"
	| "dictionary"
	| "postcard"

interface Tool {
	readonly id: ToolId
	readonly icon: ReactNode
	readonly label: MessageKey
	readonly description: MessageKey
}

/** The tools, in the order of the menu: the lessons first, then the games, then leaving the scene. */
export const TOOLS: readonly Tool[] = [
	{
		id: "light",
		icon: <IconBolt size={18} aria-hidden color="#ffd66b" />,
		label: "solarSystem.light.open",
		description: "solarSystem.light.openHint",
	},
	{
		id: "sky",
		icon: <IconMoonStars size={18} aria-hidden />,
		label: "solarSystem.sky.open",
		description: "solarSystem.sky.openHint",
	},
	{
		id: "spacecraft",
		icon: <IconSatellite size={18} aria-hidden />,
		label: "solarSystem.spacecraft.menuTitle",
		description: "solarSystem.spacecraft.menuHint",
	},
	{
		id: "birthday",
		icon: <IconCake size={18} aria-hidden />,
		label: "solarSystem.birthday.open",
		description: "solarSystem.birthday.openHint",
	},
	{
		id: "hunt",
		icon: <IconMapSearch size={18} aria-hidden />,
		label: "solarSystem.hunt.open",
		description: "solarSystem.hunt.openHint",
	},
	{
		id: "compare",
		icon: <IconScale size={18} aria-hidden />,
		label: "solarSystem.hud.compare",
		description: "solarSystem.hud.compareHint",
	},
	{
		id: "walk",
		icon: <IconWalk size={18} aria-hidden />,
		label: "solarSystem.hud.walk",
		description: "solarSystem.hud.walkHint",
	},
	{
		id: "dictionary",
		icon: <IconBook size={18} aria-hidden />,
		label: "solarSystem.hud.dictionary",
		description: "solarSystem.hud.dictionaryHint",
	},
	{
		id: "postcard",
		icon: <IconCamera size={18} aria-hidden />,
		label: "solarSystem.postcard.take",
		description: "solarSystem.postcard.takeHint",
	},
]

/**
 * The tiles' order on a phone held upright (#62): what you do with a phone in
 * your hand first (the hunt, your birthday, tonight's sky, a picture, side by
 * side), then the rest.
 */
export const PHONE_ORDER: readonly ToolId[] = [
	"hunt",
	"birthday",
	"sky",
	"postcard",
	"compare",
	"light",
	"spacecraft",
	"walk",
	"dictionary",
]

const toolById = new Map(TOOLS.map((tool) => [tool.id, tool]))

/** The tiles in their order: a tool not placed in `PHONE_ORDER` yet still gets its tile, last. */
const TILES: readonly Tool[] = [
	...PHONE_ORDER,
	...TOOLS.map((tool) => tool.id).filter((id) => !PHONE_ORDER.includes(id)),
].map((id) => toolById.get(id)!)

/** Whether a tool's panel is on screen (the pages and the picture open no panel). */
function useOpenTool(): ToolId | null {
	const light = useLightStore((state) => state.open)
	const sky = useSkyTonightStore((state) => state.open)
	const birthday = useBirthdayStore((state) => state.open)
	const hunt = useHuntStore((state) => state.open)
	const spacecraft = useHudStore((state) => state.panel === "spacecraft")
	if (light) return "light"
	if (sky) return "sky"
	if (birthday) return "birthday"
	if (hunt) return "hunt"
	if (spacecraft) return "spacecraft"
	return null
}

/** What picking a tool does, from the menu or a tile. */
function useRunTool(): (id: ToolId) => void {
	const navigate = useNavigate()
	return (id: ToolId) => {
		// the tiles' panel (#62) makes way; a tool with a panel replaces it anyway (`exclusive.ts`)
		if (useHudStore.getState().panel === "tools")
			useHudStore.getState().setPanel(null)
		switch (id) {
			case "light":
				useLightStore.getState().setOpen(true)
				return
			case "sky":
				openSky()
				return
			case "birthday":
				useBirthdayStore.getState().setOpen(true)
				return
			case "hunt":
				useHuntStore.getState().setOpen(true)
				return
			case "spacecraft":
				useHudStore.getState().setPanel("spacecraft")
				return
			case "compare": {
				const state = useSimStore.getState()
				void navigate({
					to: "/compare",
					search: compareSearchFor(cardBodyId(state) ?? state.focusId, state),
				})
				return
			}
			case "walk":
				void navigate({ to: "/solar_walk" })
				return
			case "dictionary": {
				const state = useSimStore.getState()
				const entry = nearestDictionaryEntry(cardBodyId(state) ?? state.focusId)
				void navigate({
					to: "/solar_dictionary",
					search: { entity: entry === 0 ? undefined : entry },
				})
				return
			}
			case "postcard":
				takePostcard()
				return
		}
	}
}

/**
 * Tools as tiles (#62), the panel Tools opens on a phone held upright: a
 * three by three grid of large tiles, an icon and the tool's name each (the
 * menu's words, so the help's "Tools, then …" fits both), all in view at
 * once. A long press says what the tool does.
 */
export function ToolTiles() {
	const { t } = useI18n()
	const run = useRunTool()
	return (
		<div className={classes.tiles} data-testid="tool-tiles">
			{TILES.map((tool) => (
				<Hint key={tool.id} text={t(tool.description)}>
					<UnstyledButton
						className={classes.tile}
						onClick={() => run(tool.id)}
						data-tool={tool.id}
					>
						<span className={classes.tileIcon} aria-hidden>
							{tool.icon}
						</span>
						{/* the menu's own words, so the help's "Tools, then …" fits both */}
						<span className={classes.tileName}>{t(tool.label)}</span>
					</UnstyledButton>
				</Hint>
			))}
		</div>
	)
}

/** On a phone held upright (#62): Tools opens its tiles in the sheet, like Layers and Scale open theirs. */
function ToolsButton({ active }: { active: boolean }) {
	const { t } = useI18n()
	const open = useHudStore((state) => state.panel === "tools")
	const togglePanel = useHudStore((state) => state.togglePanel)
	return (
		<Hint text={t("solarSystem.hud.toolsHint")}>
			<Button
				variant={open || active ? "light" : "subtle"}
				color={open || active ? "orange" : "gray"}
				size="compact-sm"
				className={classes.entry}
				leftSection={<IconTools size={16} aria-hidden />}
				aria-expanded={open}
				data-entry="tools"
				data-testid="tools-menu"
				onClick={() => togglePanel("tools")}
			>
				{t("solarSystem.hud.tools")}
			</Button>
		</Hint>
	)
}

const ToolsMenu = () => {
	const { t } = useI18n()
	const active = useOpenTool()
	const run = useRunTool()
	const upright = useUprightPhone()
	// turned on its side, a phone has the menu again: the tiles go
	useEffect(() => {
		if (!upright && useHudStore.getState().panel === "tools")
			useHudStore.getState().setPanel(null)
	}, [upright])

	if (upright) return <ToolsButton active={active !== null} />

	return (
		<Hint text={t("solarSystem.hud.toolsHint")}>
			<Menu shadow="md" position="top-end" width={320}>
				<Menu.Target>
					<Button
						variant={active === null ? "subtle" : "light"}
						color={active === null ? "gray" : "orange"}
						size="compact-sm"
						className={classes.entry}
						leftSection={<IconTools size={16} aria-hidden />}
						data-testid="tools-menu"
					>
						{t("solarSystem.hud.tools")}
					</Button>
				</Menu.Target>
				<Menu.Dropdown>
					<Menu.Label>{t("solarSystem.hud.tools")}</Menu.Label>
					{TOOLS.map((tool) => (
						<Menu.Item
							key={tool.id}
							leftSection={tool.icon}
							onClick={() => run(tool.id)}
							aria-current={tool.id === active || undefined}
							data-tool={tool.id}
						>
							<Text size="sm" fw={600}>
								{t(tool.label)}
							</Text>
							<Text size="xs" c="dimmed" lh={1.35}>
								{t(tool.description)}
							</Text>
						</Menu.Item>
					))}
				</Menu.Dropdown>
			</Menu>
		</Hint>
	)
}

export default ToolsMenu
