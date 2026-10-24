import { Button, Divider, Menu, Stack, Text } from "@mantine/core"
import {
	IconCheck,
	IconMoon,
	IconPinned,
	IconPlanet,
	IconSun,
} from "@tabler/icons-react"
import type { ReactNode } from "react"

import { useI18n } from "@/i18n"
import { useBodyName } from "@/i18n/bodies"
import { Hint } from "@/primitives/hint"
import { OVERVIEW_BODY_ID, isFrameAnchored } from "@/store/navigation"
import { useSimStore } from "@/store/sim"

import {
	FRAME_PRESET_IDS,
	activeFramePreset,
	applyFramePreset,
	type FramePresetId,
} from "./presets"

import classes from "./Frame.module.css"

const PRESET_ICONS: Record<FramePresetId, ReactNode> = {
	sun: <IconSun size={18} aria-hidden />,
	planets: <IconPlanet size={18} aria-hidden />,
	moon: <IconMoon size={18} aria-hidden />,
}

/**
 * The point of view as it stands: whether a body is held still, the active
 * frame's name ("Sun-centred", "Seen from Earth"), the active preset, and
 * whether the world at the centre could be held instead.
 */
export function useFrameChoice() {
	const { t } = useI18n()
	const name = useBodyName()
	const frameId = useSimStore((state) => state.frameId)
	const focusId = useSimStore((state) => state.focusId)
	const active = useSimStore(activeFramePreset)
	const anchored = isFrameAnchored({ frameId })
	const current = anchored
		? t("solarSystem.frame.current.held", {
				bodyId: frameId,
				body: name(frameId),
			})
		: t("solarSystem.frame.current.sun")
	const canHold = focusId !== OVERVIEW_BODY_ID && focusId !== frameId
	return { anchored, current, active, focusId, canHold }
}

/** The point of view's icon: a pin while a body is held still, else the Sun. */
export const FrameIcon = ({
	anchored,
	size = 16,
}: {
	anchored: boolean
	size?: number
}) =>
	anchored ? (
		<IconPinned size={size} aria-hidden />
	) : (
		<IconSun size={size} aria-hidden />
	)

/**
 * The point of view's choices as a page under More (#75: on a phone too
 * narrow for its button in the top row, `placement.ts`): the named presets
 * and "Hold <focus> still", finger-sized, in the menu's own words. A choice
 * closes More (`onChosen`), so the scene shows what it did.
 */
export function FrameChoices({ onChosen }: { onChosen: () => void }) {
	const { t } = useI18n()
	const name = useBodyName()
	const anchorFrame = useSimStore((state) => state.anchorFrame)
	const { active, focusId, canHold } = useFrameChoice()
	const choice = (
		key: string,
		icon: ReactNode,
		title: string,
		hint: string,
		current: boolean,
		choose: () => void,
	) => (
		<Button
			key={key}
			variant={current ? "light" : "subtle"}
			color={current ? "orange" : "gray"}
			justify="space-between"
			fullWidth
			h="auto"
			leftSection={icon}
			rightSection={current ? <IconCheck size={16} aria-hidden /> : undefined}
			aria-current={current || undefined}
			onClick={() => {
				choose()
				onChosen()
			}}
			classNames={{ label: classes.choice, inner: classes.choiceInner }}
			data-preset={key}
		>
			<span className={classes.choiceText}>
				<span>{title}</span>
				<Text span size="xs" c="dimmed">
					{hint}
				</Text>
			</span>
		</Button>
	)
	return (
		<Stack gap={2} data-testid="frame-choices">
			{FRAME_PRESET_IDS.map((id) =>
				choice(
					id,
					PRESET_ICONS[id],
					t(`solarSystem.frame.presets.${id}.title`),
					t(`solarSystem.frame.presets.${id}.hint`),
					active === id,
					() => applyFramePreset(id),
				),
			)}
			<Divider my={4} />
			{canHold ? (
				choice(
					"hold",
					<IconPinned size={18} aria-hidden />,
					t("solarSystem.frame.presets.hold.title", { body: name(focusId) }),
					t("solarSystem.frame.presets.hold.hint", { body: name(focusId) }),
					false,
					() => anchorFrame(focusId),
				)
			) : focusId === OVERVIEW_BODY_ID ? (
				<Text size="xs" c="dimmed" px="sm" py={6}>
					{t("solarSystem.frame.presets.hold.disabled")}
				</Text>
			) : null}
		</Stack>
	)
}

/**
 * The point of view (#31): a button that always names the active reference
 * frame ("Sun-centred", "Seen from Earth"), opening the named presets and
 * "Hold <focus> still" for whatever is at the centre.
 */
const FrameMenu = () => {
	const { t } = useI18n()
	const name = useBodyName()
	const anchorFrame = useSimStore((state) => state.anchorFrame)
	const { anchored, current, active, focusId, canHold } = useFrameChoice()

	return (
		<Hint text={t("solarSystem.frame.hint")}>
			<Menu shadow="md" position="bottom-start" width={300}>
				<Menu.Target>
					<Button
						className={classes.menuButton}
						variant={anchored ? "filled" : "subtle"}
						color={anchored ? "orange" : "gray"}
						size="compact-sm"
						leftSection={<FrameIcon anchored={anchored} />}
						aria-label={t("solarSystem.frame.menu", { current })}
						data-testid="frame-menu"
					>
						<span className={classes.menuText}>{current}</span>
					</Button>
				</Menu.Target>
				<Menu.Dropdown>
					<Menu.Label>{t("solarSystem.frame.label")}</Menu.Label>
					{FRAME_PRESET_IDS.map((id) => (
						<Menu.Item
							key={id}
							leftSection={PRESET_ICONS[id]}
							rightSection={
								active === id ? <IconCheck size={14} aria-hidden /> : null
							}
							aria-current={active === id || undefined}
							onClick={() => applyFramePreset(id)}
							data-preset={id}
						>
							<Text size="sm">
								{t(`solarSystem.frame.presets.${id}.title`)}
							</Text>
							<Text size="xs" c="dimmed">
								{t(`solarSystem.frame.presets.${id}.hint`)}
							</Text>
						</Menu.Item>
					))}
					<Menu.Divider />
					{canHold ? (
						<Menu.Item
							leftSection={<IconPinned size={18} aria-hidden />}
							onClick={() => anchorFrame(focusId)}
							data-preset="hold"
						>
							<Text size="sm">
								{t("solarSystem.frame.presets.hold.title", {
									body: name(focusId),
								})}
							</Text>
							<Text size="xs" c="dimmed">
								{t("solarSystem.frame.presets.hold.hint", {
									body: name(focusId),
								})}
							</Text>
						</Menu.Item>
					) : focusId === OVERVIEW_BODY_ID ? (
						<Text size="xs" c="dimmed" px="sm" py={6}>
							{t("solarSystem.frame.presets.hold.disabled")}
						</Text>
					) : null}
				</Menu.Dropdown>
			</Menu>
		</Hint>
	)
}

export default FrameMenu
