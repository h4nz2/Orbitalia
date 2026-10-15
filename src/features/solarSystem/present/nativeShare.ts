/**
 * The phone's own share sheet for the link to the view (#59): straight to a
 * chat, a mail or AirDrop, as the postcard already does with its picture
 * (#33, postcard/share.ts). Where the browser has none, the share panel (the
 * link to copy and the class QR code) is the way.
 */

/** A link to share: what is on screen, and its address. */
export interface SharedLink {
	title: string
	url: string
}

/** How a share ended: sent, cancelled by the visitor (silent), or not possible here. */
export type ShareResult = "shared" | "cancelled" | "failed"

/** The browser has a share sheet for links. */
export const canShareLink = (): boolean =>
	typeof navigator !== "undefined" && typeof navigator.share === "function"

/**
 * Opens the share sheet with `link`. Call it inside the tap's handler, before
 * any await: browsers allow the sheet only in answer to a tap.
 */
export async function shareLink(link: SharedLink): Promise<ShareResult> {
	try {
		if (
			typeof navigator.canShare === "function" &&
			!navigator.canShare({ title: link.title, url: link.url })
		)
			return "failed"
		await navigator.share({ title: link.title, url: link.url })
		return "shared"
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError")
			return "cancelled"
		return "failed"
	}
}
