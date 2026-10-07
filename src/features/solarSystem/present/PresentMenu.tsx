import {
	Suspense,
	lazy,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react"
import {
	Button,
	Kbd,
	Loader,
	Popover,
	Stack,
	Switch,
	Text,
} from "@mantine/core"
import { useDidUpdate } from "@mantine/hooks"
import {
	IconArrowBackUp,
	IconEyeOff,
	IconKeyboard,
	IconMaximize,
	IconMinimize,
	IconPresentation,
	IconShare,
} from "@tabler/icons-react"

import { useI18n } from "@/i18n"
import { useBodyName } from "@/i18n/bodies"
import { Hint } from "@/primitives/hint"
import { usePresentationStore } from "@/store/presentation"

import { runCommand, setChromeHidden, toggleFullscreen } from "./commands"
import { usePrefersMoreContrast } from "./usePresentationDocument"

import classes from "./Presentation.module.css"

const SharePanel = lazy(() => import("./SharePanel"))

/** Whether the page is in full screen, following the browser (F11, Escape, the button). */
function useFullscreen(): boolean {
	const [full, setFull] = useState(
		() => typeof document !== "undefined" && !!document.fullscreenElement,
	)
	useEffect(() => {
		const update = () => setFull(!!document.fullscreenElement)
		document.addEventListener("fullscreenchange", update)
		return () => document.removeEventListener("fullscreenchange", update)
	}, [])
	return full
}

const fullscreenAvailable = () =>
	typeof document !== "undefined" && document.fullscreenEnabled === true

/** A menu action with its key shown on the right. */
function Action({
	icon,
	shortcut,
	onClick,
	disabled,
	children,
}: {
	icon: ReactNode
	shortcut: string
	onClick: () => void
	disabled?: boolean
	children: ReactNode
}) {
	return (
		<Button
			variant="subtle"
			color="gray"
			justify="space-between"
			fullWidth
			leftSection={icon}
			rightSection={<Kbd size="xs">{shortcut}</Kbd>}
			aria-keyshortcuts={shortcut === "?" ? "Shift+?" : shortcut}
			onClick={onClick}
			disabled={disabled}
			classNames={{ label: classes.actionLabel }}
		>
			{children}
		</Button>
	)
}

/**
 * The teacher's menu (#29): large text for a projector, high contrast, hide
 * the controls, full screen, back to the start of the lesson and the keyboard
 * shortcuts. Every entry is also a key, listed beside it.
 */
export function PresentMenu() {
	const { t } = useI18n()
	const bodyName = useBodyName()
	const [opened, setOpened] = useState(false)
	const presenting = usePresentationStore((state) => state.presenting)
	const highContrast = usePresentationStore((state) => state.highContrast)
	const setPresenting = usePresentationStore((state) => state.setPresenting)
	const setHighContrast = usePresentationStore((state) => state.setHighContrast)
	const setHelpOpen = usePresentationStore((state) => state.setHelpOpen)
	const moreContrast = usePrefersMoreContrast()
	const fullscreen = useFullscreen()

	const restart = () => {
		setOpened(false)
		const text = runCommand({ kind: "start" }, { t, bodyName })
		if (text !== null) usePresentationStore.getState().announce(text)
	}

	return (
		<Hint text={t("solarSystem.present.buttonHint")}>
			<Popover
				opened={opened}
				onChange={setOpened}
				position="bottom-end"
				width={340}
				shadow="md"
				trapFocus
				returnFocus
			>
				<Popover.Target>
					<Button
						// easy to find on purpose (#42): the one tinted button in the corner
						variant={presenting ? "filled" : "light"}
						color="orange"
						size="compact-sm"
						style={{ flexShrink: 0 }}
						leftSection={<IconPresentation size={16} aria-hidden />}
						data-testid="present-menu"
						aria-label={t("solarSystem.present.button")}
						aria-haspopup="dialog"
						aria-expanded={opened}
						onClick={() => setOpened((open) => !open)}
						classNames={{ section: classes.cornerSection }}
					>
						<span className={classes.cornerLabel}>
							{t("solarSystem.present.button")}
						</span>
					</Button>
				</Popover.Target>
				<Popover.Dropdown>
					<Stack gap="sm">
						<Text fw={600}>{t("solarSystem.present.title")}</Text>
						<Hint text={t("solarSystem.present.hint.projector")}>
							<Switch
								color="orange"
								label={t("solarSystem.present.projector")}
								description={t("solarSystem.present.projectorHint")}
								checked={presenting}
								aria-keyshortcuts="P"
								onChange={(event) => setPresenting(event.currentTarget.checked)}
							/>
						</Hint>
						<Hint
							text={t("solarSystem.present.hint.highContrast")}
							reason={
								moreContrast
									? t("solarSystem.present.reason.highContrast")
									: undefined
							}
						>
							<Switch
								color="orange"
								label={t("solarSystem.present.highContrast")}
								description={t("solarSystem.present.highContrastHint")}
								checked={highContrast || moreContrast}
								disabled={moreContrast}
								aria-keyshortcuts="C"
								onChange={(event) =>
									setHighContrast(event.currentTarget.checked)
								}
							/>
						</Hint>
						<Stack gap={2}>
							<Action
								icon={<IconEyeOff size={18} aria-hidden />}
								shortcut="H"
								onClick={() => {
									setOpened(false)
									setChromeHidden(true)
									usePresentationStore
										.getState()
										.announce(t("solarSystem.present.announce.chromeHidden"))
								}}
							>
								{t("solarSystem.present.hideControls")}
							</Action>
							<Action
								icon={
									fullscreen ? (
										<IconMinimize size={18} aria-hidden />
									) : (
										<IconMaximize size={18} aria-hidden />
									)
								}
								shortcut="F"
								onClick={toggleFullscreen}
								disabled={!fullscreenAvailable()}
							>
								{fullscreen
									? t("solarSystem.present.exitFullscreen")
									: t("solarSystem.present.fullscreen")}
							</Action>
							<Action
								icon={<IconArrowBackUp size={18} aria-hidden />}
								shortcut="R"
								onClick={restart}
							>
								{t("solarSystem.present.restart")}
							</Action>
							<Action
								icon={<IconKeyboard size={18} aria-hidden />}
								shortcut="?"
								onClick={() => {
									setOpened(false)
									setHelpOpen(true)
								}}
							>
								{t("solarSystem.present.shortcuts")}
							</Action>
						</Stack>
						<Text size="xs" c="dimmed">
							{t("solarSystem.present.restartHint")}
						</Text>
					</Stack>
				</Popover.Dropdown>
			</Popover>
		</Hint>
	)
}

/**
 * "Share this view" (#29): the link to what is on screen, to copy or to scan.
 * The class QR code takes the panel's place (#50): opening it closes the
 * panel, and closing it comes back to Share, not to the panel.
 */
export function ShareMenu() {
	const { t } = useI18n()
	const [opened, setOpened] = useState(false)
	const qrOpen = usePresentationStore((state) => state.qrOpen)
	const button = useRef<HTMLButtonElement>(null)
	// the code's dialog mounts open, so Mantine has nothing to return focus to
	useDidUpdate(() => {
		if (!qrOpen) button.current?.focus({ preventScroll: true })
	}, [qrOpen])
	return (
		<Hint text={t("solarSystem.present.share.hint")}>
			<Popover
				opened={opened}
				onChange={setOpened}
				position="bottom-end"
				width={340}
				shadow="md"
				trapFocus
				// the code's dialog takes the focus when it replaces the panel
				returnFocus={!qrOpen}
			>
				<Popover.Target>
					<Button
						ref={button}
						variant="subtle"
						color="gray"
						size="compact-sm"
						style={{ flexShrink: 0 }}
						leftSection={<IconShare size={16} aria-hidden />}
						aria-label={t("solarSystem.present.share.button")}
						aria-haspopup="dialog"
						data-testid="share-menu"
						onClick={() => setOpened((open) => !open)}
						classNames={{ section: classes.shareSection }}
					>
						<span className={classes.shareLabel}>
							{t("solarSystem.present.share.button")}
						</span>
					</Button>
				</Popover.Target>
				<Popover.Dropdown>
					<Text fw={600} mb="xs">
						{t("solarSystem.present.share.title")}
					</Text>
					<Suspense fallback={<Loader size="sm" />}>
						<SharePanel onClose={() => setOpened(false)} />
					</Suspense>
				</Popover.Dropdown>
			</Popover>
		</Hint>
	)
}
