import { useEffect, useMemo, useState } from "react"
import {
	Button,
	Group,
	Modal,
	Stack,
	Switch,
	Text,
	TextInput,
} from "@mantine/core"
import { useDebouncedValue } from "@mantine/hooks"
import {
	IconCopy,
	IconDownload,
	IconLink,
	IconLock,
	IconShare,
} from "@tabler/icons-react"

import { usePhone } from "@/hooks/useSizeClass"
import { useI18n, type MessageKey } from "@/i18n"
import { Hint } from "@/primitives/hint"
import { usePostcardStore, type PostcardSnapshot } from "@/store/postcard"

import { canvasToPng, drawPostcard } from "./draw"
import { postcardText } from "./postcard"
import { qrModules } from "./qr"
import {
	canCopyImage,
	canCopyText,
	canShareFile,
	copyImage,
	downloadBlob,
	shareFile,
} from "./share"

import classes from "./Postcard.module.css"

/** The finished postcard: the PNG and its preview URL. */
interface Picture {
	blob: Blob
	url: string
	file: File
	width: number
	height: number
}

/** How long a "Copied!" stays, ms. */
const STATUS_MS = 2500

/**
 * The postcard (#33): the picture taken at the click, stamped, with a caption
 * the visitor may change, the names and a QR code back to the view as
 * switches, and the ways to take it away: save, copy, share, copy the link.
 * Made on the device; nothing is uploaded.
 */
const PostcardDialog = () => {
	const snapshot = usePostcardStore((state) => state.snapshot)
	const close = usePostcardStore((state) => state.close)
	if (snapshot === null) return null
	return <PostcardView snapshot={snapshot} onClose={close} />
}

const PostcardView = ({
	snapshot,
	onClose,
}: {
	snapshot: PostcardSnapshot
	onClose: () => void
}) => {
	const i18n = useI18n()
	const { t } = i18n
	const phone = usePhone()
	const text = useMemo(() => postcardText(snapshot, i18n), [snapshot, i18n])
	const hasNames = snapshot.shot.labels.length > 0
	const [names, setNames] = useState(hasNames)
	const [withLink, setWithLink] = useState(true)
	const [caption, setCaption] = useState(text.caption)
	const [debouncedCaption] = useDebouncedValue(caption, 250)
	// undefined while the encoder loads, so the first picture already has its code
	const [qr, setQr] = useState<boolean[][] | null | undefined>(undefined)
	useEffect(() => {
		let live = true
		void qrModules(snapshot.link).then((modules) => {
			if (live) setQr(modules)
		})
		return () => {
			live = false
		}
	}, [snapshot.link])

	// repainted whenever an option changes; the PNG is kept ready for the buttons
	const [picture, setPicture] = useState<Picture | null>(null)
	useEffect(() => {
		if (qr === undefined) return
		const canvas = drawPostcard(snapshot.shot, text, {
			names,
			caption: debouncedCaption,
			qr: withLink ? qr : null,
		})
		let live = true
		void canvasToPng(canvas).then((blob) => {
			if (!live) return
			setPicture({
				blob,
				url: URL.createObjectURL(blob),
				file: new File([blob], text.fileName, { type: "image/png" }),
				width: canvas.width,
				height: canvas.height,
			})
		})
		return () => {
			live = false
		}
	}, [snapshot, text, names, debouncedCaption, withLink, qr])
	// a preview URL lives as long as its picture is shown
	useEffect(() => {
		if (picture === null) return
		return () => URL.revokeObjectURL(picture.url)
	}, [picture])

	const [status, setStatus] = useState<MessageKey | null>(null)
	useEffect(() => {
		if (status === null) return
		const timer = setTimeout(() => setStatus(null), STATUS_MS)
		return () => clearTimeout(timer)
	}, [status])

	const copy = () => {
		if (picture === null) return
		copyImage(Promise.resolve(picture.blob)).then(
			() => setStatus("solarSystem.postcard.copied"),
			() => setStatus("solarSystem.postcard.copyFailed"),
		)
	}
	const copyLink = () => {
		navigator.clipboard.writeText(snapshot.link).then(
			() => setStatus("solarSystem.postcard.linkCopied"),
			() => setStatus("solarSystem.postcard.copyFailed"),
		)
	}
	const share = () => {
		if (picture === null) return
		shareFile(picture.file, text.title).catch(() =>
			setStatus("solarSystem.postcard.shareFailed"),
		)
	}
	const sharable = picture !== null && canShareFile(picture.file)

	return (
		<Modal
			opened
			onClose={onClose}
			title={t("solarSystem.postcard.title")}
			size="xl"
			fullScreen={phone}
			centered
			closeButtonProps={{ "aria-label": t("solarSystem.postcard.close") }}
		>
			<Stack
				gap="sm"
				// the scene's hotkeys (Space, arrows) must not fire while the dialog has the keys
				onKeyDown={(event) => {
					if (event.key !== "Escape") event.stopPropagation()
				}}
			>
				<div className={classes.preview}>
					{picture === null ? (
						<div className={classes.placeholder} />
					) : (
						<img
							className={classes.image}
							src={picture.url}
							alt={t("solarSystem.postcard.preview", { title: text.title })}
							width={picture.width}
							height={picture.height}
							data-testid="postcard-image"
						/>
					)}
				</div>
				<TextInput
					label={t("solarSystem.postcard.caption")}
					placeholder={t("solarSystem.postcard.captionPlaceholder")}
					value={caption}
					maxLength={140}
					onChange={(event) => setCaption(event.currentTarget.value)}
				/>
				<Group gap="lg">
					<Hint
						text={t("solarSystem.postcard.hint.names")}
						reason={
							hasNames ? undefined : t("solarSystem.postcard.reason.names")
						}
					>
						<Switch
							color="orange"
							label={t("solarSystem.postcard.names")}
							checked={names}
							disabled={!hasNames}
							onChange={(event) => setNames(event.currentTarget.checked)}
						/>
					</Hint>
					<Hint
						text={t("solarSystem.postcard.hint.link")}
						reason={
							qr === null ? t("solarSystem.postcard.reason.link") : undefined
						}
					>
						<Switch
							color="orange"
							label={t("solarSystem.postcard.link")}
							checked={withLink && qr !== null}
							disabled={qr === null}
							onChange={(event) => setWithLink(event.currentTarget.checked)}
						/>
					</Hint>
				</Group>
				<Group gap="xs">
					<Button
						color="orange"
						leftSection={<IconDownload size={18} />}
						disabled={picture === null}
						onClick={() =>
							picture !== null && downloadBlob(picture.blob, text.fileName)
						}
					>
						{t("solarSystem.postcard.download")}
					</Button>
					{canCopyImage() ? (
						<Button
							variant="default"
							leftSection={<IconCopy size={18} />}
							disabled={picture === null}
							onClick={copy}
						>
							{t("solarSystem.postcard.copy")}
						</Button>
					) : null}
					{sharable ? (
						<Button
							variant="default"
							leftSection={<IconShare size={18} />}
							onClick={share}
						>
							{t("solarSystem.postcard.share")}
						</Button>
					) : null}
					{canCopyText() ? (
						<Button
							variant="subtle"
							color="gray"
							leftSection={<IconLink size={18} />}
							onClick={copyLink}
						>
							{t("solarSystem.postcard.copyLink")}
						</Button>
					) : null}
				</Group>
				<Text size="sm" c="orange.3" aria-live="polite" mih="1.4em">
					{status === null ? "" : t(status)}
				</Text>
				<Group gap={6} wrap="nowrap" align="flex-start">
					<IconLock size={16} className={classes.lock} aria-hidden />
					<Text size="xs" c="dimmed" lh={1.4}>
						{t("solarSystem.postcard.privacy")}
						{snapshot.hideDate
							? ` ${t("solarSystem.postcard.privacyBirthday")}`
							: ""}
					</Text>
				</Group>
			</Stack>
		</Modal>
	)
}

export default PostcardDialog
