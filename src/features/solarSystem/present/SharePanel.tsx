import { useMemo } from "react"
import {
	Button,
	Group,
	Modal,
	Stack,
	Text,
	TextInput,
	getDefaultZIndex,
} from "@mantine/core"
import { useClipboard } from "@mantine/hooks"
import { IconCheck, IconCopy, IconQrcode } from "@tabler/icons-react"
import { useRouterState } from "@tanstack/react-router"

import { useI18n } from "@/i18n"
import { usePresentationStore } from "@/store/presentation"

import { qrCode } from "./qr"

import classes from "./Presentation.module.css"

/** The QR code of `link`, dark on white whatever the theme, so every phone camera reads it. */
function QrImage({ link, label }: { link: string; label: string }) {
	const code = useMemo(() => qrCode(link), [link])
	return (
		<svg
			className={classes.qr}
			viewBox={`0 0 ${code.size} ${code.size}`}
			role="img"
			aria-label={label}
			shapeRendering="crispEdges"
		>
			<rect width={code.size} height={code.size} fill="#fff" />
			<path d={code.path} fill="#000" />
		</svg>
	)
}

/** The address of what is on screen, absolute; re-read whenever the view writes a new one. */
function useViewLink(): string {
	const href = useRouterState({ select: (state) => state.location.href })
	return useMemo(
		() => (typeof window === "undefined" ? href : window.location.href),
		[href],
	)
}

/**
 * The QR code large, for a class to scan off the projector. A modal of its
 * own outside the share popover, which closes as it opens (#50). It sits
 * above everything on the page, the HUD's popovers and menus included, so
 * nothing covers the code or its white margin; only hints (which describe
 * a control inside it) would go higher.
 */
export function ClassQr() {
	const { t } = useI18n()
	const link = useViewLink()
	const opened = usePresentationStore((state) => state.qrOpen)
	const setQrOpen = usePresentationStore((state) => state.setQrOpen)
	return (
		<Modal
			opened={opened}
			onClose={() => setQrOpen(false)}
			title={t("solarSystem.present.share.qr")}
			size="auto"
			centered
			zIndex={getDefaultZIndex("max")}
		>
			<div className={classes.qrLarge}>
				<QrImage link={link} label={t("solarSystem.present.share.qrLabel")} />
			</div>
		</Modal>
	)
}

export interface SharePanelProps {
	/** Closes the panel: the class QR code takes its place (#50). */
	onClose: () => void
}

/**
 * "Share this view" (#29): the address of what is on screen, which already
 * holds the whole view (body, camera, date, speed, pause, scale, layers,
 * language), with a copy button and a QR code, small here and large for the
 * class (`ClassQr`). Loaded lazily with the QR encoder.
 */
function SharePanel({ onClose }: SharePanelProps) {
	const { t } = useI18n()
	const link = useViewLink()
	const clipboard = useClipboard({ timeout: 2500 })
	const setQrOpen = usePresentationStore((state) => state.setQrOpen)

	return (
		<Stack gap="sm">
			<Text size="sm" c="dimmed">
				{t("solarSystem.present.share.explain")}
			</Text>
			<TextInput
				label={t("solarSystem.present.share.link")}
				value={link}
				readOnly
				onFocus={(event) => event.currentTarget.select()}
				size="xs"
			/>
			<Group gap="xs" wrap="wrap">
				<Button
					size="compact-sm"
					color="orange"
					leftSection={
						clipboard.copied ? (
							<IconCheck size={16} aria-hidden />
						) : (
							<IconCopy size={16} aria-hidden />
						)
					}
					onClick={() => clipboard.copy(link)}
				>
					{clipboard.copied
						? t("solarSystem.present.share.copied")
						: t("solarSystem.present.share.copy")}
				</Button>
				<Button
					size="compact-sm"
					variant="light"
					color="gray"
					leftSection={<IconQrcode size={16} aria-hidden />}
					onClick={() => {
						setQrOpen(true)
						onClose()
					}}
				>
					{t("solarSystem.present.share.qrShow")}
				</Button>
			</Group>
			<div role="status" aria-live="polite" className={classes.status}>
				{clipboard.copied && t("solarSystem.present.share.copied")}
				{clipboard.error !== null && t("solarSystem.present.share.copyFailed")}
			</div>
			<div className={classes.qrSmall}>
				<QrImage link={link} label={t("solarSystem.present.share.qrLabel")} />
			</div>
		</Stack>
	)
}

export default SharePanel
