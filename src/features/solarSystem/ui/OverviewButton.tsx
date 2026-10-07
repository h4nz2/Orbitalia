import { useEffect } from "react"
import { ActionIcon } from "@mantine/core"
import { IconHome2 } from "@tabler/icons-react"

import { useI18n } from "@/i18n"
import { Hint } from "@/primitives/hint"
import { useSimStore } from "@/store/sim"

import { hasModifier, isEditableTarget } from "./keyboard"

/** The way out, a step of the view history (#46): Back returns to where it was taken. */
export function wayOut(): void {
	const state = useSimStore.getState()
	state.markStep()
	state.reset()
}

/**
 * Escape is the way out from anywhere; an open dropdown or a text field keeps
 * its own Escape. Listened to in the capture phase, so a widget that swallows
 * Escape for itself (a tooltip or popover dismissing) cannot block it.
 */
const handleKeyDown = (event: KeyboardEvent): void => {
	if (event.key !== "Escape") return
	if (hasModifier(event) || isEditableTarget(event.target)) return
	// a modal dialog (#29's shortcut list, the class QR code) closes on Escape and nothing else
	if (
		event.target instanceof Element &&
		event.target.closest("[aria-modal='true']") !== null
	) {
		return
	}
	event.preventDefault()
	wayOut()
}

/**
 * The always-available way out (Escape does the same): back to the overview
 * from any state, even mid-transition or mid-sequence, and the selection is
 * cleared, so a lesson can always restart from a known view. It is *the* way
 * back: a click on empty space never leaves a body (#47).
 */
const OverviewButton = () => {
	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown, true)
		return () => window.removeEventListener("keydown", handleKeyDown, true)
	}, [])
	const { t } = useI18n()
	const label = t("solarSystem.overview")

	return (
		<Hint text={t("solarSystem.overviewHint")}>
			<ActionIcon
				variant="subtle"
				color="gray"
				size="lg"
				aria-label={label}
				aria-keyshortcuts="Escape"
				onClick={wayOut}
			>
				<IconHome2 size={18} />
			</ActionIcon>
		</Hint>
	)
}

export default OverviewButton
