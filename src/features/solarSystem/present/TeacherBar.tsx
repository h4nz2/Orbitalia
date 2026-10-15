import type { ReactNode } from "react"
import { ActionIcon, Group } from "@mantine/core"
import { IconEyeOff } from "@tabler/icons-react"

import { useI18n } from "@/i18n"
import { Hint } from "@/primitives/hint"
import { usePresentationStore } from "@/store/presentation"

import { setChromeHidden } from "./commands"
import { PresentMenu, ShareMenu } from "./PresentMenu"

/**
 * "Hide the controls" for everyone (#42), not only while presenting: for
 * looking, for a picture (#33) or for a projector. The same action as the H
 * key; `PresentationLayer`'s "Show the controls" (or H again) brings them back.
 */
export function HideButton() {
	const { t } = useI18n()
	const label = t("solarSystem.present.hideControls")
	return (
		<Hint text={t("solarSystem.hud.hideHint")}>
			<ActionIcon
				variant="subtle"
				color="gray"
				size="lg"
				aria-label={label}
				aria-keyshortcuts="H"
				data-testid="hide-controls"
				onClick={() => {
					setChromeHidden(true)
					usePresentationStore
						.getState()
						.announce(t("solarSystem.present.announce.chromeHidden"))
				}}
			>
				<IconEyeOff size={18} aria-hidden />
			</ActionIcon>
		</Hint>
	)
}

/**
 * The top-right corner of the solar system (#29, #42): Present (the teacher's
 * menu, easy to find on purpose), Share, hide the controls, then whatever is
 * passed (sound, help and the language menu, which sit in the same corner on
 * every page). Where its half of the top row is too narrow for finger-sized
 * buttons (an upright tablet, #58) it wraps onto a second line rather than
 * squeezing the name of the world in view.
 */
export function TeacherBar({ children }: { children?: ReactNode }) {
	return (
		<Group gap={4} justify="flex-end" wrap="wrap">
			<PresentMenu />
			<ShareMenu />
			<HideButton />
			{children}
		</Group>
	)
}
