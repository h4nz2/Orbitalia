import { Button } from "@mantine/core"
import { IconFocusCentered } from "@tabler/icons-react"

import { useI18n } from "@/i18n"
import { useBodyName } from "@/i18n/bodies"
import { useSimStore } from "@/store/sim"

import { freeCentre, freeCentreId } from "./centre"

import classes from "./CentreBadge.module.css"

/**
 * Says what the view is centred on while it is a point in space (#15), and
 * offers the obvious way back: centre on the body whose neighbourhood it is,
 * or back to the overview out between the planets. Renders nothing while a
 * body or the overview is at the centre (the picker names it then).
 */
const CentreBadge = () => {
	const { t } = useI18n()
	const name = useBodyName()
	const centre = freeCentre(useSimStore(freeCentreId))
	const setFocus = useSimStore((state) => state.setFocus)
	const overview = useSimStore((state) => state.overview)
	const markStep = useSimStore((state) => state.markStep)
	if (centre === null) return null
	const { anchor, interplanetary } = centre
	const body = name(anchor.id)

	return (
		<section
			className={classes.root}
			aria-label={t("solarSystem.centre.label")}
			role="status"
			data-testid="centre-badge"
		>
			<IconFocusCentered className={classes.icon} size={20} aria-hidden />
			<span className={classes.text}>
				<span className={classes.title}>
					{t("solarSystem.centre.freeView")}
				</span>
				<span className={classes.place}>
					{interplanetary
						? t("solarSystem.centre.interplanetary")
						: t("solarSystem.centre.near", { body })}
				</span>
			</span>
			<Button
				className={classes.action}
				size="compact-sm"
				variant="light"
				color="orange"
				onClick={() => {
					if (!interplanetary) {
						setFocus(anchor.id)
						return
					}
					// a step of the view history (#46), like the way out
					markStep()
					overview()
				}}
			>
				{interplanetary
					? t("solarSystem.overview")
					: t("solarSystem.centre.centreOn", { body })}
			</Button>
		</section>
	)
}

export default CentreBadge
