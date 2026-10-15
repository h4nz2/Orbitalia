/**
 * The sound control (#32), next to the language button: a speaker that
 * switches all sound on or off with one click (or M), and a popover with the
 * volume, the two layers and the real recordings. Off by default; the
 * speaker is crossed out and grey while off, orange while on. On a phone
 * (#58) the two are one finger-sized button: the speaker opens the popover,
 * whose first switch turns sound on or off.
 */
import {
	ActionIcon,
	Divider,
	Group,
	Popover,
	Slider,
	Stack,
	Switch,
	Text,
} from "@mantine/core"
import { IconChevronDown, IconVolume, IconVolumeOff } from "@tabler/icons-react"

import { useI18n } from "@/i18n"
import { Hint } from "@/primitives/hint"
import { useSoundStore } from "@/store/sound"

import { canPlaySound, unlockAudio } from "./engine"
import { RECORDINGS } from "./recordings"
import RecordingButton from "./RecordingButton"
import { toggleSound } from "./SoundDirector"

import classes from "./Sound.module.css"

const Settings = () => {
	const { t } = useI18n()
	const enabled = useSoundStore((state) => state.enabled)
	const volume = useSoundStore((state) => state.volume)
	const ambient = useSoundStore((state) => state.ambient)
	const cues = useSoundStore((state) => state.cues)
	const setEnabled = useSoundStore((state) => state.setEnabled)
	const setVolume = useSoundStore((state) => state.setVolume)
	const setAmbient = useSoundStore((state) => state.setAmbient)
	const setCues = useSoundStore((state) => state.setCues)

	return (
		<Stack gap="sm" className={classes.settings} data-testid="sound-settings">
			<Switch
				color="orange"
				label={t("solarSystem.sound.on")}
				description={t("solarSystem.sound.offNote")}
				checked={enabled}
				onChange={(event) => {
					const on = event.currentTarget.checked
					if (on) unlockAudio()
					setEnabled(on)
				}}
			/>
			<div>
				<Text size="sm">{t("solarSystem.sound.volume")}</Text>
				<Group gap="xs" wrap="nowrap">
					<IconVolumeOff size={14} aria-hidden className={classes.dim} />
					<Slider
						className={classes.slider}
						color="orange"
						min={0}
						max={100}
						step={5}
						label={null}
						value={Math.round(volume * 100)}
						onChange={(value) => setVolume(value / 100)}
						thumbLabel={t("solarSystem.sound.volume")}
					/>
					<IconVolume size={14} aria-hidden className={classes.dim} />
				</Group>
			</div>
			<Switch
				color="orange"
				size="xs"
				label={t("solarSystem.sound.ambient")}
				description={t("solarSystem.sound.ambientHint")}
				checked={ambient}
				onChange={(event) => setAmbient(event.currentTarget.checked)}
			/>
			<Switch
				color="orange"
				size="xs"
				label={t("solarSystem.sound.cues")}
				description={t("solarSystem.sound.cuesHint")}
				checked={cues}
				onChange={(event) => setCues(event.currentTarget.checked)}
			/>
			<Divider />
			<div>
				<Text size="sm" fw={600}>
					{t("solarSystem.sound.recordings")}
				</Text>
				<Text size="xs" c="dimmed" className={classes.honest}>
					{t("solarSystem.sound.honest")}
				</Text>
			</div>
			<Stack gap="xs">
				{RECORDINGS.map((recording) => (
					<RecordingButton
						key={recording.id}
						recording={recording}
						explain={false}
					/>
				))}
			</Stack>
		</Stack>
	)
}

function SoundControl() {
	const { t } = useI18n()
	const enabled = useSoundStore((state) => state.enabled)
	if (!canPlaySound()) return null
	const hint = t(
		enabled ? "solarSystem.sound.hintOn" : "solarSystem.sound.hintOff",
	)

	return (
		<Group gap={0} wrap="nowrap" className={classes.control}>
			<Hint text={hint}>
				<ActionIcon
					variant={enabled ? "light" : "subtle"}
					color={enabled ? "orange" : "gray"}
					size="md"
					aria-label={t("solarSystem.sound.toggle")}
					aria-pressed={enabled}
					aria-keyshortcuts="M"
					onClick={toggleSound}
					data-testid="sound-toggle"
					className={classes.toggle}
				>
					{enabled ? (
						<IconVolume size={18} aria-hidden />
					) : (
						<IconVolumeOff size={18} aria-hidden />
					)}
				</ActionIcon>
			</Hint>
			<Hint text={t("solarSystem.sound.settingsHint")}>
				<Popover
					width={300}
					position="bottom-end"
					withArrow
					shadow="md"
					trapFocus={false}
					transitionProps={{ duration: 0 }}
				>
					<Popover.Target>
						<ActionIcon
							variant="subtle"
							color="gray"
							size="sm"
							aria-label={t("solarSystem.sound.settings")}
							data-testid="sound-menu"
						>
							<IconChevronDown
								size={14}
								aria-hidden
								className={classes.chevron}
							/>
							<span
								className={classes.speaker}
								data-on={enabled || undefined}
								aria-hidden
							>
								{enabled ? (
									<IconVolume size={18} />
								) : (
									<IconVolumeOff size={18} />
								)}
							</span>
						</ActionIcon>
					</Popover.Target>
					{/* it scrolls inside, so it keeps its arrow (providers/fit.css) */}
					<Popover.Dropdown data-own-scroll>
						<Settings />
					</Popover.Dropdown>
				</Popover>
			</Hint>
		</Group>
	)
}

export default SoundControl
