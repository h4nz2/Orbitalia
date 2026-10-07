/**
 * The Help menu (#30): the opening is shown once per device, and replayed
 * only deliberately from here; the movement hints can be called back too.
 * Since #43 it is the chevron beside the Help button (a split button): the
 * button opens the help page in one click, the chevron offers the rest, last
 * "Send feedback" with the view on screen offered to attach.
 */
import { ActionIcon, Menu } from "@mantine/core"
import { Link, useRouter } from "@tanstack/react-router"
import {
	IconBook,
	IconChevronDown,
	IconHandClick,
	IconMessageCircle,
	IconPlayerPlay,
	IconSparkles,
} from "@tabler/icons-react"

import { useI18n } from "@/i18n"
import { Hint } from "@/primitives/hint"

import { startQuickLook } from "../quickLook/quickLook"
import { showHints, startIntro } from "./intro"

const IntroMenu = () => {
	const { t, readingLevel } = useI18n()
	const router = useRouter()
	const label = t("help.more")
	// the view as it is when the item is picked: every view is in its address
	const sendFeedback = () => {
		const { pathname, searchStr } = router.state.location
		void router.navigate({
			to: "/feedback",
			search: { from: `${pathname}${searchStr}`.slice(0, 2000) },
		})
	}
	return (
		<Hint text={t("solarSystem.intro.menuHint")}>
			<Menu shadow="md" position="bottom-start">
				<Menu.Target>
					<ActionIcon
						variant="subtle"
						color="gray"
						size="md"
						aria-label={label}
						data-testid="intro-menu"
					>
						<IconChevronDown size={16} />
					</ActionIcon>
				</Menu.Target>
				<Menu.Dropdown>
					<Menu.Item
						component={Link}
						to="/help"
						leftSection={<IconBook size={16} aria-hidden />}
					>
						{t("help.buttonHint")}
					</Menu.Item>
					<Menu.Item
						leftSection={<IconPlayerPlay size={16} aria-hidden />}
						onClick={() => startIntro(readingLevel)}
					>
						{t("solarSystem.intro.replay")}
					</Menu.Item>
					<Menu.Item
						leftSection={<IconSparkles size={16} aria-hidden />}
						onClick={startQuickLook}
						data-testid="quick-look-replay"
					>
						{t("solarSystem.quickLook.replay")}
					</Menu.Item>
					<Menu.Item
						leftSection={<IconHandClick size={16} aria-hidden />}
						onClick={showHints}
					>
						{t("solarSystem.intro.hints")}
					</Menu.Item>
					<Menu.Divider />
					<Menu.Item
						leftSection={<IconMessageCircle size={16} aria-hidden />}
						onClick={sendFeedback}
						data-testid="feedback-menu"
					>
						{t("feedback.title")}
					</Menu.Item>
				</Menu.Dropdown>
			</Menu>
		</Hint>
	)
}

export default IntroMenu
