import { useState, type CSSProperties } from "react"
import {
	ActionIcon,
	Button,
	Group,
	Popover,
	SegmentedControl,
	Select,
	Stack,
	Text,
} from "@mantine/core"
import { useMediaQuery } from "@mantine/hooks"
import {
	IconChevronUp,
	IconGauge,
	IconPlayerPause,
	IconPlayerPlay,
	IconPlayerPlayFilled,
} from "@tabler/icons-react"

import { clockWidths, formatClockUTC, isoMinuteUTC, useI18n } from "@/i18n"
import { Hint, hintKey } from "@/primitives/hint"
import { jdToDate } from "@/sim"
import { WARP_PRESETS, useSimStore } from "@/store/sim"

import { useThrottledSimTime } from "../scene/useThrottledSimTime"
import {
	hasModifier,
	isActivatableTarget,
	isEditableTarget,
	useWindowKeydown,
} from "./keyboard"
import SpinControl, { SpinNotice } from "./SpinControl"
import TimeTravel from "./TimeTravel"
import TooFastHint from "./TooFastHint"
import {
	directionOf,
	stepWarp,
	warpLabel,
	withDirection,
	type Direction,
} from "./warp"

import classes from "./TimeControls.module.css"

/** Below this width the speed presets no longer fit in a row and become a Select. */
const COMPACT_QUERY = "(max-width: 719px)"

/**
 * Space toggles pause, "+" / "-" step to the next faster / slower preset in
 * the current direction. Text fields keep every key; buttons keep Space (they
 * toggle themselves when focused).
 */
const handleKeyDown = (event: KeyboardEvent): void => {
	if (hasModifier(event) || isEditableTarget(event.target)) return
	const { timeWarp, togglePause, setTimeWarp } = useSimStore.getState()
	switch (event.key) {
		case " ":
			if (event.repeat || isActivatableTarget(event.target)) return
			event.preventDefault()
			togglePause()
			return
		case "+":
		case "=":
			event.preventDefault()
			setTimeWarp(stepWarp(timeWarp, 1))
			return
		case "-":
		case "_":
			event.preventDefault()
			setTimeWarp(stepWarp(timeWarp, -1))
			return
		default:
			return
	}
}

/** Space, "+" and "-" for the clock: the time bar's, or on a phone held upright the time chip's (#60). */
export const useTimeKeys = (): void => useWindowKeydown(handleKeyDown)

/** Runs the clock in `direction` at the current speed, un-pausing it. */
const play = (direction: Direction): void => {
	const { timeWarp, setTimeWarp, setPaused } = useSimStore.getState()
	setTimeWarp(withDirection(timeWarp, direction))
	setPaused(false)
}

/**
 * The simulation clock in the active locale's date format, with the ISO
 * instant in `dateTime`; its own component so the ~10 Hz updates re-render nothing else.
 * A phone (#58) shows the date over the time, so the bar keeps to one row
 * with finger-sized buttons; the text is the same. It is as wide as the
 * locale's widest date of the year (#71, `clockWidths`), so the buttons
 * beside it stay put while time runs.
 */
export const SimDateTime = () => {
	const jd = useThrottledSimTime()
	const { formatLocale } = useI18n()
	const date = jdToDate(jd)
	const parts = formatClockUTC(date, formatLocale)
	const widths = clockWidths(formatLocale)
	const style = {
		"--clock-width": `${widths.whole}ch`,
		"--clock-date-width": `${widths.date}ch`,
		"--clock-time-width": `${widths.time}ch`,
	} as CSSProperties
	return (
		<time className={classes.date} dateTime={isoMinuteUTC(date)} style={style}>
			<span className={classes.datePart}>{parts.date}</span>
			<span className={classes.dateSeparator}>{parts.separator}</span>
			<span className={classes.timePart}>{parts.time}</span>
		</time>
	)
}

/**
 * Reverse, pause and play as one group with exactly one of them pressed, so
 * the state of the clock reads at a glance.
 */
const Transport = () => {
	const paused = useSimStore((state) => state.paused)
	const direction = useSimStore((state) => directionOf(state.timeWarp))
	const togglePause = useSimStore((state) => state.togglePause)
	const { t } = useI18n()

	const reversing = !paused && direction === -1
	const playing = !paused && direction === 1
	return (
		<Hint
			options={{
				reverse: t("solarSystem.time.reverseHint"),
				pause: t("solarSystem.time.pauseHint"),
				play: t("solarSystem.time.playHint"),
			}}
		>
			<ActionIcon.Group aria-label={t("solarSystem.time.controls")}>
				<ActionIcon
					{...hintKey("reverse")}
					variant={reversing ? "filled" : "default"}
					color="orange"
					size="lg"
					aria-label={t("solarSystem.time.reverse")}
					aria-pressed={reversing}
					onClick={() => play(-1)}
				>
					{reversing ? (
						<IconPlayerPlayFilled size={18} className={classes.flipped} />
					) : (
						<IconPlayerPlay size={18} className={classes.flipped} />
					)}
				</ActionIcon>
				<ActionIcon
					{...hintKey("pause")}
					variant={paused ? "filled" : "default"}
					color="orange"
					size="lg"
					aria-label={t("solarSystem.time.pause")}
					aria-pressed={paused}
					onClick={togglePause}
				>
					<IconPlayerPause size={18} />
				</ActionIcon>
				<ActionIcon
					{...hintKey("play")}
					variant={playing ? "filled" : "default"}
					color="orange"
					size="lg"
					aria-label={t("solarSystem.time.play")}
					aria-pressed={playing}
					onClick={() => play(1)}
				>
					{playing ? (
						<IconPlayerPlayFilled size={18} />
					) : (
						<IconPlayerPlay size={18} />
					)}
				</ActionIcon>
			</ActionIcon.Group>
		</Hint>
	)
}

/**
 * The speed presets, slowest first: each step multiplies the speed, so the
 * row is a logarithmic scale. They set the speed only; the direction stays.
 */
const SpeedPresets = ({ portal = false }: { portal?: boolean }) => {
	const timeWarp = useSimStore((state) => state.timeWarp)
	const setTimeWarp = useSimStore((state) => state.setTimeWarp)
	const compact = useMediaQuery(COMPACT_QUERY, false, {
		getInitialValueInEffect: false,
	})
	const i18n = useI18n()
	const { t } = i18n

	const speed = Math.abs(timeWarp)
	const direction = directionOf(timeWarp)
	// a speed from the URL that is no preset still shows up as the selected item
	const values = [...WARP_PRESETS]
	if (!values.includes(speed)) values.push(speed)
	const items = values.map((value) => ({
		label: warpLabel(value, i18n),
		value,
	}))
	const choose = (value: number) => setTimeWarp(withDirection(value, direction))

	return (
		<Hint text={t("solarSystem.time.warp.hint")}>
			{compact ? (
				<Select
					size="xs"
					radius="md"
					aria-label={t("solarSystem.time.warp.label")}
					value={String(speed)}
					onChange={(value) => {
						if (value !== null) choose(Number(value))
					}}
					data={items.map((item) => ({
						label: item.label,
						value: String(item.value),
					}))}
					allowDeselect={false}
					// inside the time popover (#42): its list must not count as a click
					// outside it; in the phone's sheet (#60) it must not be clipped by it
					comboboxProps={{ shadow: "md", withinPortal: portal }}
					className={classes.speedSelect}
				/>
			) : (
				<SegmentedControl<number>
					size="xs"
					radius="md"
					color="orange"
					aria-label={t("solarSystem.time.warp.label")}
					value={speed}
					onChange={choose}
					data={items}
				/>
			)}
		</Hint>
	)
}

/**
 * The rest of time (#42): Now, the speed presets and the spin. In the time
 * bar's popover, or in the phone's sheet (#60) under the transport and the
 * date. `title`: name it ("Time") beside Now, where nothing else does.
 */
export const TimeSettings = ({
	title = false,
	portal = false,
}: {
	title?: boolean
	portal?: boolean
}) => {
	const { t } = useI18n()
	const setNow = useSimStore((state) => state.setNow)
	return (
		<Stack gap="sm" align="center">
			<Group
				justify={title ? "space-between" : "center"}
				w="100%"
				wrap="nowrap"
			>
				{title && (
					<Text fw={700} size="sm">
						{t("solarSystem.hud.time")}
					</Text>
				)}
				<Hint text={t("solarSystem.time.nowHint")}>
					<Button
						variant="light"
						color="orange"
						size="compact-sm"
						onClick={setNow}
					>
						{t("solarSystem.time.now")}
					</Button>
				</Hint>
			</Group>
			<div className={classes.speedRow}>
				<span className={classes.speedLabel} aria-hidden>
					<IconGauge size={16} />
					{t("solarSystem.time.warp.label")}
				</span>
				<div className={classes.warp}>
					<SpeedPresets portal={portal} />
				</div>
			</div>
			<SpinControl notice={false} />
		</Stack>
	)
}

/**
 * The speed on the time bar (#42): what one real second is worth right now,
 * and the way into the rest of time: Now, the speed presets and the spin.
 * `+` and `-` still step the speed without opening anything.
 */
const TimeMenu = () => {
	const i18n = useI18n()
	const { t } = i18n
	const [opened, setOpened] = useState(false)
	const speed = useSimStore((state) => Math.abs(state.timeWarp))
	const label = warpLabel(speed, i18n)
	return (
		<Popover
			opened={opened}
			onChange={setOpened}
			position="top"
			width="min(36rem, calc(100vw - 1rem))"
			shadow="md"
			radius="md"
			trapFocus
			returnFocus
		>
			<Popover.Target>
				<span className={classes.dim} data-dim>
					<Hint text={opened ? undefined : t("solarSystem.hud.timeHint")}>
						<Button
							variant={opened ? "light" : "subtle"}
							color={opened ? "orange" : "gray"}
							size="compact-sm"
							leftSection={<IconGauge size={16} aria-hidden />}
							rightSection={<IconChevronUp size={14} aria-hidden />}
							aria-label={t("solarSystem.hud.timeButton", { speed: label })}
							aria-haspopup="dialog"
							aria-expanded={opened}
							data-testid="time-menu"
							onClick={() => setOpened((open) => !open)}
						>
							<span className={classes.speed}>{label}</span>
						</Button>
					</Hint>
				</span>
			</Popover.Target>
			<Popover.Dropdown
				aria-label={t("solarSystem.hud.time")}
				data-testid="time-panel"
			>
				<TimeSettings title />
			</Popover.Dropdown>
		</Popover>
	)
}

/**
 * The time bar (issues #14, #42): whether time runs and which way
 * (reverse / pause / play), the date (a button that opens the time travel
 * panel) and the speed (a button that opens the rest of time). The
 * too-fast-to-follow and not-to-the-clock notes appear under it only while
 * they apply.
 */
const TimeControls = () => {
	useTimeKeys()

	return (
		<div className={classes.root}>
			<div className={classes.row}>
				<Transport />
				<TimeTravel>
					<SimDateTime />
				</TimeTravel>
				<TimeMenu />
			</div>
			<TooFastHint />
			<SpinNotice />
		</div>
	)
}

/**
 * The whole time in the phone's sheet (#60), opened from the time chip:
 * reverse, pause and play, the date (time travel), the notes while they
 * apply, then Now, the speeds and the spin. The keys stay with the time chip
 * (always there), so they never act twice.
 */
export const TimeSheetControls = () => (
	<div className={classes.root} data-testid="time-panel">
		<div className={classes.row}>
			<Transport />
			<TimeTravel>
				<SimDateTime />
			</TimeTravel>
		</div>
		<TooFastHint />
		<SpinNotice />
		<TimeSettings portal />
	</div>
)

export default TimeControls
