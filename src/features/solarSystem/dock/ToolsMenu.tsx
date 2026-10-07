/**
 * Tools (#42): one entry point for everything that opens a panel of its own
 * or leaves the scene for a moment. Each item says in one line what it does;
 * picking one opens it in the dock, closing whatever was open there
 * (`exclusive.ts`). New tools add an item here, not a button of their own
 * (docs/ARCHITECTURE.md, "HUD layout").
 */
import type { ReactNode } from "react"
import { Button, Menu, Text } from "@mantine/core"
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

const ToolsMenu = () => {
	const { t } = useI18n()
	const navigate = useNavigate()
	const active = useOpenTool()

	const run = (id: ToolId) => {
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
				<Menu.Dropdown className={classes.toolsMenu}>
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
