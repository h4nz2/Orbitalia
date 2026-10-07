import {
	ActionIcon,
	Group,
	Stack,
	Switch,
	Text,
	UnstyledButton,
} from "@mantine/core"
import { IconCurrentLocation } from "@tabler/icons-react"

import { spacecraft } from "@/data/spacecraft"
import { useI18n } from "@/i18n"
import { Hint } from "@/primitives/hint"
import { getSpacecraftText } from "@/i18n/spacecraft"
import { craftPhase, isInSpace } from "@/sim/spacecraft"
import { useScaleStore } from "@/store/scale"
import type { Spacecraft } from "@/data/spacecraft"
import { useSimStore } from "@/store/sim"
import { useSpacecraftStore } from "@/store/spacecraft"

import useThrottledSimTime from "../scene/useThrottledSimTime"
import { formatDayUTC } from "../ui/timeTravel"
import { followCraft, showCraft } from "./facts"

import classes from "./Spacecraft.module.css"

/**
 * The spacecraft list (#35), a panel of the dock since #42 (Tools → Real
 * spacecraft): the layer switch, "show every path", and every craft with
 * what it is and whether it is working at the simulation date. Picking one
 * selects it and flies the view there, its follow button rides along with it
 * (#57); either way `onPicked` then closes the panel.
 */
export const SpacecraftList = ({ onPicked }: { onPicked: () => void }) => {
	const i18n = useI18n()
	const { t } = i18n
	const jd = useThrottledSimTime()
	const scale = useScaleStore((state) => state.scale)
	const show = useSpacecraftStore((state) => state.showSpacecraft)
	const allPaths = useSpacecraftStore((state) => state.showAllPaths)
	const selected = useSpacecraftStore((state) => state.selectedCraftId)
	const followed = useSimStore((state) =>
		state.view.kind === "craft" ? state.view.id : null,
	)
	const { setShowSpacecraft, setShowAllPaths } = useSpacecraftStore.getState()
	const day = (iso: string) => formatDayUTC(new Date(iso), i18n.formatLocale)
	const phaseText = (
		craft: Spacecraft,
		phase: ReturnType<typeof craftPhase>,
	) =>
		phase === "planned"
			? t("solarSystem.spacecraft.phase.planned", { date: day(craft.launch) })
			: phase === "active"
				? t("solarSystem.spacecraft.phase.active")
				: t(`solarSystem.spacecraft.phase.${phase}`, {
						date: day(craft.end?.date ?? craft.dataTo),
					})

	return (
		<Stack gap="xs" className={classes.dropdown}>
			<Text size="xs" c="dimmed" lh={1.35}>
				{t("solarSystem.spacecraft.menuIntro")}
			</Text>
			<Group gap="md">
				<Hint text={t("solarSystem.spacecraft.hint.layer")}>
					<Switch
						size="xs"
						color="cyan"
						label={t("solarSystem.spacecraft.layer")}
						checked={show}
						onChange={(event) => setShowSpacecraft(event.currentTarget.checked)}
					/>
				</Hint>
				<Hint
					text={t("solarSystem.spacecraft.hint.allPaths")}
					reason={
						show ? undefined : t("solarSystem.spacecraft.reason.allPaths")
					}
				>
					<Switch
						size="xs"
						color="cyan"
						label={t("solarSystem.spacecraft.allPaths")}
						checked={allPaths}
						disabled={!show}
						onChange={(event) => setShowAllPaths(event.currentTarget.checked)}
					/>
				</Hint>
			</Group>
			<Stack gap={2}>
				{spacecraft.map((craft) => {
					const text = getSpacecraftText(craft.id, i18n)
					const phase = craftPhase(craft, jd)
					const status = phaseText(craft, phase)
					return (
						<div key={craft.id} className={classes.craftRow}>
							<UnstyledButton
								className={classes.craft}
								data-craft={craft.id}
								data-phase={phase}
								data-selected={craft.id === selected || undefined}
								onClick={() => {
									setShowSpacecraft(true)
									showCraft(craft.id, scale)
									onPicked()
								}}
							>
								<span className={classes.craftName}>{text.name}</span>
								<span className={classes.craftTagline}>{text.tagline}</span>
								<span className={classes.craftStatus}>{status}</span>
							</UnstyledButton>
							<Hint
								text={t("solarSystem.spacecraft.hint.follow", {
									name: text.name,
								})}
								reason={
									isInSpace(phase)
										? undefined
										: t("solarSystem.spacecraft.reason.follow")
								}
							>
								<ActionIcon
									variant={craft.id === followed ? "filled" : "subtle"}
									color="cyan"
									size="lg"
									data-follow={craft.id}
									aria-label={t("solarSystem.spacecraft.followCraft", {
										name: text.name,
									})}
									aria-pressed={craft.id === followed}
									disabled={!isInSpace(phase)}
									onClick={() => {
										setShowSpacecraft(true)
										followCraft(craft.id, scale)
										onPicked()
									}}
								>
									<IconCurrentLocation size={18} />
								</ActionIcon>
							</Hint>
						</div>
					)
				})}
			</Stack>
		</Stack>
	)
}

export default SpacecraftList
