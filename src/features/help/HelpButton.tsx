import { Button } from "@mantine/core"
import { Link } from "@tanstack/react-router"
import { IconHelp } from "@tabler/icons-react"

import { LanguageMenu, useI18n } from "@/i18n"
import { Hint } from "@/primitives/hint"

import classes from "./HelpButton.module.css"

/**
 * The way to the help page (#43), in the same place on every screen: right
 * before the language menu at the top right. One click; the page the viewer
 * came from is the browser's "back", and every view is in its address.
 */
export function HelpButton() {
	const { t } = useI18n()
	return (
		<Hint text={t("help.buttonHint")}>
			<Button
				component={Link}
				to="/help"
				variant="subtle"
				color="gray"
				size="compact-sm"
				style={{ flexShrink: 0 }}
				leftSection={<IconHelp size={16} aria-hidden />}
				aria-label={t("help.button")}
				data-testid="help-button"
				classNames={{ section: classes.section }}
			>
				<span className={classes.label}>{t("help.button")}</span>
			</Button>
		</Hint>
	)
}

export interface CornerBarProps {
	/** Show the help button (false on the help page itself). */
	help?: boolean
}

/**
 * The top-right corner of pages without the 3D scene's HUD (dictionary, walk,
 * comparison, not found, help): help and the language menu.
 * The solar system puts the same two buttons at the end of its teacher bar.
 */
export function CornerBar({ help = true }: CornerBarProps) {
	return (
		<div className={classes.corner}>
			{help && <HelpButton />}
			<LanguageMenu />
		</div>
	)
}
