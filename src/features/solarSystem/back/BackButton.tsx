import { useEffect } from "react"
import { ActionIcon } from "@mantine/core"
import { IconArrowLeft } from "@tabler/icons-react"

import { useI18n } from "@/i18n"
import { Hint } from "@/primitives/hint"
import { useSimStore } from "@/store/sim"
import { useTourStore } from "@/store/tour"
import { onArrive, useViewHistoryStore } from "@/store/viewHistory"

import { canStepBack, goBack, returnTo } from "./back"

/**
 * Back (#46), right next to the way out: one step back to where you just
 * were (the house goes all the way to the overview). Backspace does the same
 * (`present/keys.ts`), and so do the browser's back and the phone's back
 * gesture. Shown disabled, with a hint saying why, when there is nothing to
 * go back to. It also takes the scene to an entry the browser went back or
 * forward to (`returnTo`); the HUD is never unmounted, so it always can.
 */
const BackButton = () => {
	const { t } = useI18n()
	useEffect(() => onArrive(returnTo), [])

	const index = useViewHistoryStore((state) => state.index)
	const entries = useViewHistoryStore((state) => state.entries)
	const sequence = useSimStore((state) => state.sequence)
	const tour = useTourStore((state) => state.tour)
	const tourIndex = useTourStore((state) => state.index)
	const steps = useTourStore((state) => state.steps)
	const enabled = canStepBack({ index, entries }, sequence, {
		tour,
		index: tourIndex,
		steps,
	})
	const label = t("solarSystem.back.label")

	return (
		<Hint
			text={t("solarSystem.back.hint")}
			reason={enabled ? undefined : t("solarSystem.back.reason")}
		>
			<ActionIcon
				variant="subtle"
				color="gray"
				size="lg"
				aria-label={label}
				aria-keyshortcuts="Backspace"
				// still hoverable while disabled, so the hint can say why
				aria-disabled={!enabled}
				data-disabled={!enabled || undefined}
				onClick={() => {
					if (enabled) goBack()
				}}
				data-testid="back-button"
			>
				<IconArrowLeft size={18} />
			</ActionIcon>
		</Hint>
	)
}

export default BackButton
