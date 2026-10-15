import { useId, useLayoutEffect, useRef, type ReactNode } from "react"
import { CloseButton } from "@mantine/core"

import { useI18n } from "@/i18n"
import type { SheetKind } from "@/store/sheet"

import hudClasses from "../SolarSystem.module.css"
import classes from "./Dock.module.css"

export interface DockPanelProps {
	/** The panel's name, also the region's label. */
	title: string
	icon?: ReactNode
	onClose: () => void
	/** `data-dock-panel`, for styles and tests. */
	id: string
	/**
	 * Name the region after the title (default). False when the content is a
	 * region of its own with the same name (the scale panel), so there are
	 * never two regions called the same.
	 */
	labelled?: boolean
	/** What it is to the phone's sheet (#60), which decides the height it opens at; a panel by default. */
	kind?: SheetKind
	/**
	 * Shown whole in the phone's sheet (#62, the Tools tiles): its half height
	 * is all of it, up to just under the top row, so it never scrolls.
	 */
	whole?: boolean
	children: ReactNode
}

/**
 * A panel of the dock (#42): a named, non-modal region with a close button.
 * Opening it moves the keyboard focus to its title, so a keyboard user lands
 * in it; closing gives the focus back to the button that opened it. The scene stays usable
 * beside it, and it dims while the camera moves. On a phone held upright it
 * is what the sheet shows (#60): its header is the sheet's summary at small
 * height, and its × is what a pull below small presses.
 */
export function DockPanel({
	title,
	icon,
	onClose,
	id,
	labelled = true,
	kind = "panel",
	whole = false,
	children,
}: DockPanelProps) {
	const { t } = useI18n()
	const titleId = useId()
	const titleRef = useRef<HTMLHeadingElement>(null)
	const sectionRef = useRef<HTMLElement>(null)
	useLayoutEffect(() => {
		// the entry point that opened the panel gets the focus back when it closes
		const opener = document.activeElement
		titleRef.current?.focus({ preventScroll: true })
		const section = sectionRef.current
		return () => {
			const active = document.activeElement
			const inside = section !== null && section.contains(active)
			if ((inside || active === document.body) && opener instanceof HTMLElement)
				opener.focus({ preventScroll: true })
		}
	}, [])
	return (
		<section
			ref={sectionRef}
			className={`${hudClasses.panel} ${classes.panel}`}
			aria-labelledby={labelled ? titleId : undefined}
			data-dock-panel={id}
			data-sheet-kind={kind}
			data-sheet-whole={whole || undefined}
		>
			<header className={classes.header}>
				{icon}
				<h2 id={titleId} ref={titleRef} tabIndex={-1} className={classes.title}>
					{title}
				</h2>
				<CloseButton
					size="sm"
					aria-label={t("solarSystem.hud.close", { panel: title })}
					onClick={onClose}
					data-sheet-close
				/>
			</header>
			<div className={classes.body}>{children}</div>
		</section>
	)
}

export default DockPanel
