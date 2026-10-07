/**
 * A QR code as one SVG path (#29): the link to the current view, for a class
 * to scan off the projector. Encoding is `uqr` (tiny, no dependencies, loaded
 * with the share panel only); drawing is here, so the page renders it as
 * React SVG instead of injecting markup.
 */
import { encode } from "uqr"

export interface QrCode {
	/** Modules per side, the quiet zone included. */
	readonly size: number
	/** One SVG path of every dark module, in module units. */
	readonly path: string
}

/**
 * The dark modules of `modules` (rows of booleans, true = dark) as a path:
 * each horizontal run of dark modules is one rectangle.
 */
export function qrPath(modules: readonly (readonly boolean[])[]): string {
	const parts: string[] = []
	modules.forEach((row, y) => {
		let x = 0
		while (x < row.length) {
			if (!row[x]) {
				x += 1
				continue
			}
			const start = x
			while (x < row.length && row[x]) x += 1
			parts.push(`M${start} ${y}h${x - start}v1h${start - x}z`)
		}
	})
	return parts.join("")
}

/**
 * How the share codes are encoded (#50): low error correction, raised to
 * whatever the code's size holds for free, and the standard four-module quiet
 * zone. A code on a screen is never crumpled or stained (the printed
 * postcard keeps M); what fails at the back of a classroom is a module too
 * small for the camera, and L draws the same link with one or two versions
 * fewer, so every module is 10-20 % larger.
 */
export const QR_OPTIONS = { ecc: "L", boostEcc: true, border: 4 } as const

/** The QR code of `text` (see `QR_OPTIONS`). */
export function qrCode(text: string): QrCode {
	const { data, size } = encode(text, QR_OPTIONS)
	return { size, path: qrPath(data) }
}
