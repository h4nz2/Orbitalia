import { Suspense, lazy, useEffect, useRef, useState } from "react"
import { Button, Kbd, Modal, Table, Text, VisuallyHidden } from "@mantine/core"
import { Link } from "@tanstack/react-router"
import { IconAdjustments } from "@tabler/icons-react"

import { useI18n, type MessageKey } from "@/i18n"
import { usePresentationStore } from "@/store/presentation"

import { setChromeHidden } from "./commands"
import { usePresentationDocument } from "./usePresentationDocument"
import { usePresenterKeys } from "./usePresenterKeys"

import classes from "./Presentation.module.css"
import "./presentation.css"

const ClassQr = lazy(() =>
	import("./SharePanel").then((module) => ({ default: module.ClassQr })),
)

/** How long the "controls hidden" hint and the show button stay after the pointer last moved, ms. */
export const CHROME_HINT_MS = 3000

/** The keyboard shortcuts, grouped as in the dialog; keys are shown as written, names from the locale. */
const SHORTCUTS: readonly {
	group: MessageKey
	rows: readonly { keys: readonly (string | MessageKey)[]; text: MessageKey }[]
}[] = [
	{
		group: "solarSystem.present.help.groups.move",
		rows: [
			{
				keys: [
					"solarSystem.present.help.keys.arrows",
					"solarSystem.present.help.keys.pageUpDown",
				],
				text: "solarSystem.present.help.step",
			},
			{
				keys: ["solarSystem.present.help.keys.digits"],
				text: "solarSystem.present.help.planets",
			},
			{ keys: ["0"], text: "solarSystem.present.help.overview" },
			{
				keys: ["solarSystem.present.help.keys.backspace"],
				text: "solarSystem.present.help.back",
			},
			{
				keys: ["solarSystem.present.help.keys.esc"],
				text: "solarSystem.present.help.reset",
			},
			{
				keys: ["R", "solarSystem.present.help.keys.home"],
				text: "solarSystem.present.help.start",
			},
		],
	},
	{
		group: "solarSystem.present.help.groups.time",
		rows: [
			{
				keys: ["solarSystem.present.help.keys.space"],
				text: "solarSystem.present.help.pause",
			},
			{ keys: ["+", "−"], text: "solarSystem.present.help.speed" },
		],
	},
	{
		group: "solarSystem.present.help.groups.show",
		rows: [
			{ keys: ["S"], text: "solarSystem.present.help.scale" },
			{ keys: ["L"], text: "solarSystem.present.help.labels" },
			{ keys: ["X"], text: "solarSystem.present.help.stopLight" },
		],
	},
	{
		group: "solarSystem.present.help.groups.present",
		rows: [
			{ keys: ["H"], text: "solarSystem.present.help.chrome" },
			{ keys: ["F"], text: "solarSystem.present.help.fullscreen" },
			{ keys: ["P"], text: "solarSystem.present.help.projector" },
			{ keys: ["C"], text: "solarSystem.present.help.contrast" },
			{ keys: ["M"], text: "solarSystem.sound.shortcut" },
			{ keys: ["?"], text: "solarSystem.present.help.help" },
		],
	},
]

const isMessageKey = (key: string): key is MessageKey =>
	key.startsWith("solarSystem.")

/** The keyboard shortcut list ("?"). */
function KeyHelp() {
	const { t } = useI18n()
	const opened = usePresentationStore((state) => state.helpOpen)
	const setHelpOpen = usePresentationStore((state) => state.setHelpOpen)
	return (
		<Modal
			opened={opened}
			onClose={() => setHelpOpen(false)}
			title={t("solarSystem.present.help.title")}
			size="lg"
			centered
		>
			<Text size="sm" c="dimmed" mb="sm">
				{t("solarSystem.present.help.intro")}
			</Text>
			<Table className={classes.keys} verticalSpacing={4}>
				{SHORTCUTS.map(({ group, rows }) => (
					<Table.Tbody key={group}>
						<Table.Tr>
							<Table.Th colSpan={2} scope="colgroup" className={classes.group}>
								{t(group)}
							</Table.Th>
						</Table.Tr>
						{rows.map(({ keys, text }) => (
							<Table.Tr key={text}>
								<Table.Td className={classes.keyCell}>
									{keys.map((key) => (
										<Kbd key={key} className={classes.kbd}>
											{isMessageKey(key) ? t(key) : key}
										</Kbd>
									))}
								</Table.Td>
								<Table.Td>{t(text)}</Table.Td>
							</Table.Tr>
						))}
					</Table.Tbody>
				))}
			</Table>
			<Text size="sm" mt="md">
				<Link
					to="/help"
					search={{ topic: "controls" }}
					style={{ color: "var(--mantine-color-orange-4)" }}
					onClick={() => setHelpOpen(false)}
				>
					{t("help.shortcutsLink")}
				</Link>
			</Text>
		</Modal>
	)
}

/**
 * While the controls are hidden: a hint and a "Show the controls" button, in
 * view for a few seconds after hiding and whenever the pointer moves (or the
 * button has keyboard focus), so a touch screen or a mouse can always bring
 * the controls back. The pointer itself is hidden while idle, so it does not
 * sit in the middle of the projection.
 */
function ChromeRestore() {
	const { t } = useI18n()
	const hidden = usePresentationStore((state) => state.chromeHidden)
	const [active, setActive] = useState(true)
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	useEffect(() => {
		if (!hidden) return
		const wake = () => {
			setActive(true)
			clearTimeout(timer.current)
			timer.current = setTimeout(() => setActive(false), CHROME_HINT_MS)
		}
		wake()
		window.addEventListener("pointermove", wake)
		window.addEventListener("pointerdown", wake)
		return () => {
			window.removeEventListener("pointermove", wake)
			window.removeEventListener("pointerdown", wake)
			clearTimeout(timer.current)
		}
	}, [hidden])

	useEffect(() => {
		const root = document.documentElement
		if (hidden && !active) root.setAttribute("data-idle", "")
		else root.removeAttribute("data-idle")
		return () => root.removeAttribute("data-idle")
	}, [hidden, active])

	if (!hidden) return null
	return (
		<div className={classes.restore} data-active={active || undefined}>
			<Text className={classes.restoreHint} size="sm">
				{t("solarSystem.present.chrome.hint")}
			</Text>
			<Button
				color="orange"
				size="md"
				leftSection={<IconAdjustments size={20} aria-hidden />}
				aria-keyshortcuts="H"
				onClick={() => {
					setChromeHidden(false)
					usePresentationStore
						.getState()
						.announce(t("solarSystem.present.announce.chromeShown"))
				}}
			>
				{t("solarSystem.present.chrome.show")}
			</Button>
		</div>
	)
}

/** Reads out what the presenter's keys did (`announce`), politely, once per announcement. */
function LiveRegion() {
	const announcement = usePresentationStore((state) => state.announcement)
	return (
		<VisuallyHidden
			role="status"
			aria-live="polite"
			aria-atomic="true"
			data-announcer
		>
			{announcement !== null && (
				<span key={announcement.id}>{announcement.text}</span>
			)}
		</VisuallyHidden>
	)
}

/**
 * Teacher and presentation mode (#29), the parts outside the HUD: the
 * presenter's keys, the document attributes the presentation styles key on,
 * the live region, the shortcut list, the class QR code and the way back
 * from hidden controls. Rendered once by the solar system page, outside the
 * HUD, so it stays when the HUD is hidden.
 */
export function PresentationLayer() {
	usePresenterKeys()
	usePresentationDocument()
	const qrOpen = usePresentationStore((state) => state.qrOpen)
	// hidden controls never outlive the page: coming back always shows them
	useEffect(
		() => () => {
			const store = usePresentationStore.getState()
			store.setChromeHidden(false)
			store.setHelpOpen(false)
			store.setQrOpen(false)
		},
		[],
	)
	return (
		<>
			<LiveRegion />
			<ChromeRestore />
			<KeyHelp />
			{qrOpen && (
				<Suspense fallback={null}>
					<ClassQr />
				</Suspense>
			)}
		</>
	)
}

export default PresentationLayer
