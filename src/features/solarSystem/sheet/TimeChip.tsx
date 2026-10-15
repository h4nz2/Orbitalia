/**
 * Time on a phone held upright (#60): a chip above the sheet, and the whole
 * time controls in the sheet.
 *
 * - **The chip**: play or pause, then the speed with a short date. That second
 *   part opens the time controls in the sheet (and closes them again). It is
 *   always there with the controls, during a tour too; hiding the controls
 *   (#59) hides it with them. At full height it tucks into the sheet's strip,
 *   so it never covers what the sheet shows.
 * - **The time controls** (`TimePanel`): a dock panel like any other, so it
 *   opens at half height, closes a panel that was open (`dock/exclusive.ts`)
 *   and gives the focus back to the chip when it closes.
 */
import { ActionIcon, Button } from "@mantine/core"
import { IconClock, IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react"

import { formatDateTimeUTCParts, isoMinuteUTC, useI18n } from "@/i18n"
import { Hint } from "@/primitives/hint"
import { jdToDate } from "@/sim"
import { useSheetStore } from "@/store/sheet"
import { useSimStore } from "@/store/sim"

import DockPanel from "../dock/DockPanel"
import { useThrottledSimTime } from "../scene/useThrottledSimTime"
import { TimeSheetControls, useTimeKeys } from "../ui/TimeControls"
import { warpLabel } from "../ui/warp"

import classes from "./Sheet.module.css"

/** The simulation's date, short (the locale's own order), in its `<time>`. */
function ShortDate() {
	const jd = useThrottledSimTime()
	const { formatLocale } = useI18n()
	const date = jdToDate(jd)
	return (
		<time className={classes.chipDate} dateTime={isoMinuteUTC(date)}>
			{formatDateTimeUTCParts(date, formatLocale).date}
		</time>
	)
}

/** The time chip, above the phone's sheet. */
export function TimeChip() {
	const i18n = useI18n()
	const { t } = i18n
	const paused = useSimStore((state) => state.paused)
	const speed = useSimStore((state) => Math.abs(state.timeWarp))
	const togglePause = useSimStore((state) => state.togglePause)
	const open = useSheetStore((state) => state.timeOpen)
	const setOpen = useSheetStore((state) => state.setTimeOpen)
	const label = warpLabel(speed, i18n)
	// the keys of the time bar it stands in for: Space, + and -
	useTimeKeys()
	return (
		<div className={classes.chip} data-testid="time-chip">
			<Hint
				text={t(
					paused ? "solarSystem.time.playHint" : "solarSystem.time.pauseHint",
				)}
			>
				<ActionIcon
					variant={paused ? "filled" : "light"}
					color="orange"
					size="lg"
					aria-label={t(
						paused ? "solarSystem.time.play" : "solarSystem.time.pause",
					)}
					data-testid="chip-play"
					onClick={togglePause}
				>
					{paused ? (
						<IconPlayerPlay size={18} aria-hidden />
					) : (
						<IconPlayerPause size={18} aria-hidden />
					)}
				</ActionIcon>
			</Hint>
			<Hint text={open ? undefined : t("solarSystem.sheet.chipHint")}>
				<Button
					variant={open ? "light" : "subtle"}
					color={open ? "orange" : "gray"}
					size="compact-sm"
					className={classes.chipOpen}
					aria-label={t("solarSystem.hud.timeButton", { speed: label })}
					aria-expanded={open}
					data-testid="time-menu"
					onClick={() => setOpen(!open)}
				>
					<span className={classes.chipSpeed}>{label}</span>
					<ShortDate />
				</Button>
			</Hint>
		</div>
	)
}

/** The whole time controls, in the phone's sheet while the chip has them open. */
export function TimePanel() {
	const { t } = useI18n()
	const open = useSheetStore((state) => state.timeOpen)
	const setOpen = useSheetStore((state) => state.setTimeOpen)
	if (!open) return null
	return (
		<DockPanel
			id="time"
			kind="time"
			title={t("solarSystem.hud.time")}
			icon={<IconClock size={16} aria-hidden />}
			onClose={() => setOpen(false)}
		>
			<div className={classes.time}>
				<TimeSheetControls />
			</div>
		</DockPanel>
	)
}
