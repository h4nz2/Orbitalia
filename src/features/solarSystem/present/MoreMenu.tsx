/**
 * More (#59): on a phone, everything of the corner behind one labelled button
 * at the end of the top row. A word and not only ☰, because people use hidden
 * menus far less than visible ones. Laptops and tablets keep the corner
 * (`TeacherBar`).
 *
 * In groups, every item with its words: Share (the phone's share sheet, and
 * the link with the class QR code), sound, the language and reading level,
 * Help (the page, the opening, the quick look, the movement hints, feedback),
 * hiding the controls, and presenting (projector text, high contrast, back to
 * the start, full screen where the browser can do it, or on an iPhone how to
 * add Orbitalia to the Home Screen). A finger gets no keyboard keys and no
 * list of shortcuts. Each item is at most one tap after More; the share
 * panel, the sound settings, the languages and the Home Screen steps open as
 * a page of their own inside, with a way back.
 *
 * `MorePanel` is the content alone, so the phone's bottom sheet (#60) can show
 * it as well as this popover.
 */
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
	Divider,
	Kbd,
	List,
	Loader,
	Popover,
	Stack,
	Switch,
	Text,
	Title,
} from "@mantine/core"
import { useDidUpdate } from "@mantine/hooks"
import { Link } from "@tanstack/react-router"
import {
	IconArrowBackUp,
	IconArrowLeft,
	IconBook,
	IconCheck,
	IconChevronRight,
	IconContrast,
	IconDeviceMobile,
	IconEyeOff,
	IconHandClick,
	IconKeyboard,
	IconLanguage,
	IconMaximize,
	IconMenu2,
	IconMessageCircle,
	IconMinimize,
	IconPlayerPlay,
	IconQrcode,
	IconShare,
	IconSparkles,
	IconTextSize,
	IconVolume,
	IconVolumeOff,
} from "@tabler/icons-react"

import { useTouch } from "@/hooks/useSizeClass"
import { useI18n } from "@/i18n"
import { useBodyName } from "@/i18n/bodies"
import { LOCALES, READING_LEVELS } from "@/i18n/catalog"
import { nativeLocaleName } from "@/i18n/LanguageMenu"
import { Hint } from "@/primitives/hint"
import { usePresentationStore } from "@/store/presentation"
import { useSoundStore } from "@/store/sound"

import { showHints, startIntro } from "../intro/intro"
import { useSendFeedback } from "../intro/IntroMenu"
import { startQuickLook } from "../quickLook/quickLook"
import { canPlaySound, unlockAudio } from "../sound/engine"
import { SoundSettings } from "../sound/SoundControl"
import { runCommand, setChromeHidden, toggleFullscreen } from "./commands"
import { currentFullscreenOffer, useFullscreen } from "./fullscreen"
import { canShareLink, shareLink } from "./nativeShare"
import { usePrefersMoreContrast } from "./usePresentationDocument"

import classes from "./MoreMenu.module.css"

const SharePanel = lazy(() => import("./SharePanel"))

/** The pages of More: the list, and what opens inside it. */
type MorePage = "main" | "share" | "sound" | "language" | "homeScreen"

/** One item of the list: an icon and its words, a key where there is a keyboard, `›` where it opens a page. */
function Item({
	id,
	icon,
	shortcut,
	opens,
	onClick,
	children,
	...rest
}: {
	id: string
	icon: ReactNode
	shortcut?: string | null
	opens?: boolean
	onClick?: () => void
	children: ReactNode
	"data-testid"?: string
	"aria-current"?: boolean
}) {
	return (
		<Button
			variant="subtle"
			color="gray"
			justify="space-between"
			fullWidth
			leftSection={icon}
			rightSection={
				opens ? (
					<IconChevronRight size={16} aria-hidden />
				) : shortcut ? (
					<Kbd size="xs">{shortcut}</Kbd>
				) : undefined
			}
			aria-keyshortcuts={
				shortcut ? (shortcut === "?" ? "Shift+?" : shortcut) : undefined
			}
			data-more-item={id}
			onClick={onClick}
			classNames={{ label: classes.label }}
			{...rest}
		>
			{children}
		</Button>
	)
}

/** A page inside More: the way back, its title, and what it holds. */
function Page({
	title,
	onBack,
	children,
}: {
	title: string
	onBack: () => void
	children: ReactNode
}) {
	const { t } = useI18n()
	return (
		<Stack gap="xs">
			<div className={classes.pageHead}>
				<Button
					variant="subtle"
					color="gray"
					size="compact-sm"
					leftSection={<IconArrowLeft size={16} aria-hidden />}
					aria-label={t("solarSystem.more.backLabel")}
					onClick={onBack}
					data-more-back
				>
					{t("solarSystem.more.back")}
				</Button>
				<Title order={2} className={classes.pageTitle}>
					{title}
				</Title>
			</div>
			{children}
		</Stack>
	)
}

/** A switch in the list, as tall as an item, its words at the left like the items'. */
function SwitchItem({
	icon,
	label,
	hint,
	reason,
	checked,
	disabled,
	onChange,
	testId,
}: {
	icon: ReactNode
	label: string
	hint?: string
	reason?: string
	checked: boolean
	disabled?: boolean
	onChange: (checked: boolean) => void
	testId?: string
}) {
	return (
		<Hint text={hint} reason={reason}>
			<Switch
				color="orange"
				labelPosition="left"
				label={
					<span className={classes.switchLabel}>
						{icon}
						{label}
					</span>
				}
				checked={checked}
				disabled={disabled}
				onChange={(event) => onChange(event.currentTarget.checked)}
				classNames={{ body: classes.switchBody, labelWrapper: classes.grow }}
				data-testid={testId}
			/>
		</Hint>
	)
}

/** The languages and the reading levels, as in the language menu. */
function LanguageChoices() {
	const { t, locale, readingLevel, setLocale, setReadingLevel } = useI18n()
	const check = (active: boolean) =>
		active ? <IconCheck size={16} aria-hidden /> : undefined
	return (
		<Stack gap={2}>
			<Text size="xs" c="dimmed" className={classes.group}>
				{t("i18n.menu.language")}
			</Text>
			{LOCALES.map((id) => (
				<Button
					key={id}
					lang={id}
					variant={id === locale ? "light" : "subtle"}
					color={id === locale ? "orange" : "gray"}
					justify="space-between"
					fullWidth
					rightSection={check(id === locale)}
					aria-current={id === locale || undefined}
					onClick={() => setLocale(id)}
					classNames={{ label: classes.label }}
				>
					{nativeLocaleName(id)}
				</Button>
			))}
			<Text size="xs" c="dimmed" className={classes.group}>
				{t("i18n.menu.readingLevel")}
			</Text>
			{READING_LEVELS.map((level) => (
				<Button
					key={level}
					variant={level === readingLevel ? "light" : "subtle"}
					color={level === readingLevel ? "orange" : "gray"}
					justify="space-between"
					fullWidth
					h="auto"
					rightSection={check(level === readingLevel)}
					aria-current={level === readingLevel || undefined}
					onClick={() => setReadingLevel(level)}
					classNames={{ label: classes.label, inner: classes.tallInner }}
				>
					<span className={classes.twoLines}>
						<span>{t(`i18n.readingLevel.${level}.name`)}</span>
						<Text span size="xs" c="dimmed">
							{t(`i18n.readingLevel.${level}.description`)}
						</Text>
					</span>
				</Button>
			))}
		</Stack>
	)
}

/** How to get a full screen on an iPhone: Orbitalia from the Home Screen. */
function HomeScreenSteps() {
	const { t } = useI18n()
	return (
		<Stack gap="xs" className={classes.prose} data-testid="home-screen-steps">
			<Text size="sm">{t("solarSystem.more.homeScreen.intro")}</Text>
			<List type="ordered" size="sm" spacing={6}>
				<List.Item>{t("solarSystem.more.homeScreen.share")}</List.Item>
				<List.Item>{t("solarSystem.more.homeScreen.add")}</List.Item>
				<List.Item>{t("solarSystem.more.homeScreen.open")}</List.Item>
			</List>
		</Stack>
	)
}

export interface MorePanelProps {
	/** Closes More (an item did its job, or something takes its place). */
	onClose: () => void
	/** The class QR code is about to take More's place (#50). */
	onQr?: () => void
}

/** What More holds, whatever shows it: the popover today, the phone's sheet later (#60). */
export function MorePanel({ onClose, onQr }: MorePanelProps) {
	const { t, locale, readingLevel } = useI18n()
	const bodyName = useBodyName()
	const touch = useTouch()
	const [page, setPage] = useState<MorePage>("main")
	const opener = useRef<string | null>(null)
	const root = useRef<HTMLDivElement>(null)
	const sendFeedback = useSendFeedback()

	const presenting = usePresentationStore((state) => state.presenting)
	const highContrast = usePresentationStore((state) => state.highContrast)
	const setPresenting = usePresentationStore((state) => state.setPresenting)
	const setHighContrast = usePresentationStore((state) => state.setHighContrast)
	const setHelpOpen = usePresentationStore((state) => state.setHelpOpen)
	const moreContrast = usePrefersMoreContrast()
	const fullscreen = useFullscreen()
	const [fullscreenOffer] = useState(currentFullscreenOffer)
	const [shareSheet] = useState(canShareLink)
	const sound = useSoundStore((state) => state.enabled)
	const setSound = useSoundStore((state) => state.setEnabled)
	const [soundAvailable] = useState(canPlaySound)

	// a page opened: the focus goes to its way back; back on the list, to the item that opened it
	useEffect(() => {
		const element = root.current
		if (element === null) return
		const target =
			page === "main"
				? opener.current === null
					? null
					: element.querySelector<HTMLElement>(
							`[data-more-item="${opener.current}"]`,
						)
				: element.querySelector<HTMLElement>("[data-more-back]")
		target?.focus({ preventScroll: true })
		element.closest(".mantine-Popover-dropdown")?.scrollTo({ top: 0 })
	}, [page])

	const open = (next: MorePage) => {
		opener.current = next
		setPage(next)
	}
	const back = () => setPage("main")
	/** Closes More, then does it. */
	const act = (action: () => void) => () => {
		onClose()
		action()
	}
	const key = (shortcut: string) => (touch ? null : shortcut)

	const share = () => {
		// inside the tap, before any await: the sheet opens only in answer to one
		void shareLink({
			title: document.title,
			url: window.location.href,
		}).then((result) => {
			if (result === "shared") onClose()
			// no sheet after all: the link and the code instead; a cancel is silent
			else if (result === "failed") open("share")
		})
	}

	const hide = act(() => {
		setChromeHidden(true)
		usePresentationStore
			.getState()
			.announce(
				t(
					touch
						? "solarSystem.present.announce.chromeHiddenTouch"
						: "solarSystem.present.announce.chromeHidden",
				),
			)
	})

	const restart = act(() => {
		const text = runCommand({ kind: "start" }, { t, bodyName })
		if (text !== null) usePresentationStore.getState().announce(text)
	})

	if (page !== "main")
		return (
			<div ref={root} className={classes.panel} data-more-page={page}>
				{page === "share" && (
					<Page title={t("solarSystem.present.share.title")} onBack={back}>
						<Suspense fallback={<Loader size="sm" />}>
							<SharePanel
								onClose={() => {
									onQr?.()
									onClose()
								}}
							/>
						</Suspense>
					</Page>
				)}
				{page === "sound" && (
					<Page title={t("solarSystem.sound.settings")} onBack={back}>
						<SoundSettings scrolls={false} />
					</Page>
				)}
				{page === "language" && (
					<Page title={t("solarSystem.more.language")} onBack={back}>
						<LanguageChoices />
					</Page>
				)}
				{page === "homeScreen" && (
					<Page title={t("solarSystem.more.homeScreen.title")} onBack={back}>
						<HomeScreenSteps />
					</Page>
				)}
			</div>
		)

	return (
		<div ref={root} className={classes.panel} data-more-page="main">
			<Stack gap={2}>
				{/* Share: the phone's own sheet, and the link with the class QR code */}
				{shareSheet && (
					<Hint text={t("solarSystem.more.shareHint")}>
						<Item
							id="shareSheet"
							icon={<IconShare size={18} aria-hidden />}
							onClick={share}
							data-testid="more-share"
						>
							{t("solarSystem.present.share.button")}
						</Item>
					</Hint>
				)}
				<Hint text={t("solarSystem.present.share.hint")}>
					<Item
						id="share"
						icon={<IconQrcode size={18} aria-hidden />}
						opens
						onClick={() => open("share")}
						data-testid="more-share-panel"
					>
						{t("solarSystem.more.linkAndQr")}
					</Item>
				</Hint>

				{soundAvailable && (
					<>
						<Divider className={classes.divider} />
						<SwitchItem
							icon={
								sound ? (
									<IconVolume size={18} aria-hidden />
								) : (
									<IconVolumeOff size={18} aria-hidden />
								)
							}
							label={t("solarSystem.sound.on")}
							hint={t("solarSystem.sound.offNote")}
							checked={sound}
							onChange={(on) => {
								if (on) unlockAudio()
								setSound(on)
							}}
							testId="more-sound"
						/>
						<Hint text={t("solarSystem.sound.settingsHint")}>
							<Item
								id="sound"
								icon={<IconVolume size={18} aria-hidden />}
								opens
								onClick={() => open("sound")}
								data-testid="more-sound-settings"
							>
								{t("solarSystem.sound.settings")}
							</Item>
						</Hint>
					</>
				)}

				<Divider className={classes.divider} />
				<Hint text={t("solarSystem.more.languageHint")}>
					<Item
						id="language"
						icon={<IconLanguage size={18} aria-hidden />}
						opens
						onClick={() => open("language")}
						data-testid="more-language"
					>
						{t("i18n.menu.button", { code: locale.toUpperCase() })}
					</Item>
				</Hint>

				<Divider className={classes.divider} />
				<Text size="xs" c="dimmed" className={classes.group}>
					{t("help.title")}
				</Text>
				<Button
					component={Link}
					to="/help"
					variant="subtle"
					color="gray"
					justify="flex-start"
					fullWidth
					leftSection={<IconBook size={18} aria-hidden />}
					data-more-item="help"
					data-testid="more-help"
					classNames={{ label: classes.label }}
				>
					{t("help.buttonHint")}
				</Button>
				<Item
					id="intro"
					icon={<IconPlayerPlay size={18} aria-hidden />}
					onClick={act(() => startIntro(readingLevel))}
				>
					{t("solarSystem.intro.replay")}
				</Item>
				<Item
					id="quickLook"
					icon={<IconSparkles size={18} aria-hidden />}
					onClick={act(startQuickLook)}
					data-testid="more-quick-look"
				>
					{t("solarSystem.quickLook.replay")}
				</Item>
				<Item
					id="hints"
					icon={<IconHandClick size={18} aria-hidden />}
					onClick={act(showHints)}
				>
					{t("solarSystem.intro.hints")}
				</Item>
				<Item
					id="feedback"
					icon={<IconMessageCircle size={18} aria-hidden />}
					onClick={act(sendFeedback)}
				>
					{t("feedback.title")}
				</Item>

				<Divider className={classes.divider} />
				<Hint
					text={t(
						touch
							? "solarSystem.hud.hideHintTouch"
							: "solarSystem.hud.hideHint",
					)}
				>
					<Item
						id="hide"
						icon={<IconEyeOff size={18} aria-hidden />}
						shortcut={key("H")}
						onClick={hide}
						data-testid="more-hide"
					>
						{t("solarSystem.present.hideControls")}
					</Item>
				</Hint>

				<Divider className={classes.divider} />
				<Text size="xs" c="dimmed" className={classes.group}>
					{t("solarSystem.present.title")}
				</Text>
				<SwitchItem
					icon={<IconTextSize size={18} aria-hidden />}
					label={t("solarSystem.present.projector")}
					hint={t("solarSystem.present.hint.projector")}
					checked={presenting}
					onChange={setPresenting}
					testId="more-projector"
				/>
				<SwitchItem
					icon={<IconContrast size={18} aria-hidden />}
					label={t("solarSystem.present.highContrast")}
					hint={t("solarSystem.present.hint.highContrast")}
					reason={
						moreContrast
							? t("solarSystem.present.reason.highContrast")
							: undefined
					}
					checked={highContrast || moreContrast}
					disabled={moreContrast}
					onChange={setHighContrast}
					testId="more-contrast"
				/>
				<Hint text={t("solarSystem.present.restartHint")}>
					<Item
						id="restart"
						icon={<IconArrowBackUp size={18} aria-hidden />}
						shortcut={key("R")}
						onClick={restart}
					>
						{t("solarSystem.present.restart")}
					</Item>
				</Hint>
				{fullscreenOffer === "fullscreen" && (
					<Item
						id="fullscreen"
						icon={
							fullscreen ? (
								<IconMinimize size={18} aria-hidden />
							) : (
								<IconMaximize size={18} aria-hidden />
							)
						}
						shortcut={key("F")}
						onClick={act(toggleFullscreen)}
						data-testid="more-fullscreen"
					>
						{fullscreen
							? t("solarSystem.present.exitFullscreen")
							: t("solarSystem.present.fullscreen")}
					</Item>
				)}
				{fullscreenOffer === "homeScreen" && (
					<Hint text={t("solarSystem.more.homeScreen.hint")}>
						<Item
							id="homeScreen"
							icon={<IconDeviceMobile size={18} aria-hidden />}
							opens
							onClick={() => open("homeScreen")}
							data-testid="more-home-screen"
						>
							{t("solarSystem.more.homeScreen.button")}
						</Item>
					</Hint>
				)}
				{!touch && (
					<Item
						id="shortcuts"
						icon={<IconKeyboard size={18} aria-hidden />}
						shortcut="?"
						onClick={act(() => setHelpOpen(true))}
					>
						{t("solarSystem.present.shortcuts")}
					</Item>
				)}
			</Stack>
		</div>
	)
}

/**
 * The More button and its popover, at the end of a phone's top row. The
 * class QR code takes its place (#50) and gives the focus back to it.
 */
export function MoreMenu() {
	const { t } = useI18n()
	const [opened, setOpened] = useState(false)
	const qrOpen = usePresentationStore((state) => state.qrOpen)
	const button = useRef<HTMLButtonElement>(null)
	const qrFromHere = useRef(false)
	// the code's dialog mounts open, so Mantine has nothing to return focus to
	useDidUpdate(() => {
		if (qrOpen || !qrFromHere.current) return
		qrFromHere.current = false
		button.current?.focus({ preventScroll: true })
	}, [qrOpen])
	return (
		<Hint text={t("solarSystem.more.hint")}>
			<Popover
				opened={opened}
				onChange={setOpened}
				position="bottom-end"
				width="min(22rem, calc(100vw - 1rem))"
				shadow="md"
				trapFocus
				// the code's dialog takes the focus when it replaces More
				returnFocus={!qrOpen}
			>
				<Popover.Target>
					<Button
						ref={button}
						variant={opened ? "light" : "subtle"}
						color="gray"
						size="compact-sm"
						leftSection={<IconMenu2 size={18} aria-hidden />}
						aria-haspopup="dialog"
						aria-expanded={opened}
						data-testid="more-menu"
						className={classes.button}
						onClick={() => setOpened((open) => !open)}
					>
						{t("solarSystem.more.button")}
					</Button>
				</Popover.Target>
				<Popover.Dropdown
					data-testid="more-panel"
					aria-label={t("solarSystem.more.title")}
				>
					<MorePanel
						onClose={() => setOpened(false)}
						onQr={() => {
							qrFromHere.current = true
						}}
					/>
				</Popover.Dropdown>
			</Popover>
		</Hint>
	)
}

export default MoreMenu
