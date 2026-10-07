import { useMemo } from "react"
import { Text } from "@mantine/core"
import { IconAlertTriangle } from "@tabler/icons-react"

import { bodies } from "@/data"
import { useI18n } from "@/i18n"
import { useBodyName } from "@/i18n/bodies"
import { allMoonsShown, useSimStore } from "@/store/sim"

import { bodiesInView, tooFastToFollow } from "./tooFast"
import { useFrameRate } from "./useFrameRate"

import classes from "./TimeControls.module.css"

/**
 * The wagon-wheel warning under the speed presets (./tooFast.ts): names the
 * fastest body in view while it laps faster than the screen can show.
 * Nothing while paused or travelling to a date.
 */
const TooFastHint = () => {
	const { t } = useI18n()
	const name = useBodyName()
	const warp = useSimStore((state) => state.timeWarp)
	const paused = useSimStore((state) => state.paused)
	const gliding = useSimStore((state) => state.clock.glide !== null)
	const focusId = useSimStore((state) => state.focusId)
	const showMoons = useSimStore((state) => state.showMoons)
	const showAllMoons = useSimStore(allMoonsShown)
	const fps = useFrameRate()
	const inView = useMemo(
		() => bodiesInView(bodies, focusId, showMoons, showAllMoons),
		[focusId, showMoons, showAllMoons],
	)

	const fast = paused || gliding ? null : tooFastToFollow(inView, warp, fps)
	if (fast === null) return null

	return (
		<Text
			size="xs"
			className={classes.hint}
			role="status"
			data-too-fast={fast.id}
		>
			<IconAlertTriangle size={14} className={classes.hintIcon} aria-hidden />
			<span>
				{t("solarSystem.time.tooFast", {
					body: name(fast.id),
					parent: name(fast.parentId),
					parentId: fast.parentId,
					count: Math.round(fast.lapsPerSecond),
				})}
			</span>
		</Text>
	)
}

export default TooFastHint
