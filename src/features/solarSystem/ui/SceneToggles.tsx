import { Group, Switch } from "@mantine/core"

import { useI18n } from "@/i18n"
import { Hint } from "@/primitives/hint"
import { useLightingStore } from "@/store/lighting"
import { useSimStore } from "@/store/sim"

import classes from "./SceneToggles.module.css"

/** Which switches Orbit names still waits for: the argument of `solarSystem.layers.reason.orbitNames`. */
export function orbitNamesMissing(
	showOrbits: boolean,
	showLabels: boolean,
): "orbits" | "labels" | "both" | null {
	if (showOrbits && showLabels) return null
	if (!showOrbits && !showLabels) return "both"
	return showOrbits ? "labels" : "orbits"
}

/**
 * Switches for the orbit lines, the labels, the moons (all of them, #17), the
 * markers, the orbit names, the small bodies (#23) and the "always lit" teaching mode. Each has a hint
 * (#39) saying what it does and, while disabled, what to turn on first (or, for All
 * moons in Poster, that the scale hides them, #54).
 */
const SceneToggles = () => {
	const { t } = useI18n()
	const showOrbits = useSimStore((state) => state.showOrbits)
	const showLabels = useSimStore((state) => state.showLabels)
	const showMoons = useSimStore((state) => state.showMoons)
	const showAllMoons = useSimStore((state) => state.showAllMoons)
	const longTailHidden = useSimStore((state) => state.longTailHidden)
	const showMarkers = useSimStore((state) => state.showMarkers)
	const showOrbitLabels = useSimStore((state) => state.showOrbitLabels)
	const setShowOrbits = useSimStore((state) => state.setShowOrbits)
	const setShowLabels = useSimStore((state) => state.setShowLabels)
	const setShowMoons = useSimStore((state) => state.setShowMoons)
	const setShowAllMoons = useSimStore((state) => state.setShowAllMoons)
	const setShowMarkers = useSimStore((state) => state.setShowMarkers)
	const setShowOrbitLabels = useSimStore((state) => state.setShowOrbitLabels)
	const showSmallBodies = useSimStore((state) => state.showSmallBodies)
	const setShowSmallBodies = useSimStore((state) => state.setShowSmallBodies)
	const alwaysLit = useLightingStore((state) => state.alwaysLit)
	const setAlwaysLit = useLightingStore((state) => state.setAlwaysLit)
	const missing = orbitNamesMissing(showOrbits, showLabels)

	return (
		<Group
			className={classes.layers}
			gap="md"
			wrap="wrap"
			role="group"
			aria-label={t("solarSystem.layers.label")}
		>
			<Hint text={t("solarSystem.layers.hint.orbits")}>
				<Switch
					size="xs"
					color="orange"
					label={t("solarSystem.layers.orbits")}
					checked={showOrbits}
					onChange={(event) => setShowOrbits(event.currentTarget.checked)}
				/>
			</Hint>
			<Hint text={t("solarSystem.layers.hint.labels")}>
				<Switch
					size="xs"
					color="orange"
					label={t("solarSystem.layers.labels")}
					checked={showLabels}
					onChange={(event) => setShowLabels(event.currentTarget.checked)}
				/>
			</Hint>
			<Hint text={t("solarSystem.layers.hint.moons")}>
				<Switch
					size="xs"
					color="orange"
					label={t("solarSystem.layers.moons")}
					checked={showMoons}
					onChange={(event) => setShowMoons(event.currentTarget.checked)}
				/>
			</Hint>
			<Hint
				text={t("solarSystem.layers.hint.allMoons")}
				reason={
					longTailHidden
						? t("solarSystem.layers.reason.allMoonsPoster")
						: showMoons
							? undefined
							: t("solarSystem.layers.reason.allMoons")
				}
			>
				<Switch
					size="xs"
					color="orange"
					label={t("solarSystem.layers.allMoons")}
					checked={showAllMoons}
					disabled={!showMoons || longTailHidden}
					onChange={(event) => setShowAllMoons(event.currentTarget.checked)}
				/>
			</Hint>
			<Hint text={t("solarSystem.layers.hint.markers")}>
				<Switch
					size="xs"
					color="orange"
					label={t("solarSystem.layers.markers")}
					checked={showMarkers}
					onChange={(event) => setShowMarkers(event.currentTarget.checked)}
				/>
			</Hint>
			<Hint
				text={t("solarSystem.layers.hint.orbitNames")}
				reason={
					missing === null
						? undefined
						: t("solarSystem.layers.reason.orbitNames", { missing })
				}
			>
				<Switch
					size="xs"
					color="orange"
					label={t("solarSystem.layers.orbitNames")}
					checked={showOrbitLabels}
					disabled={missing !== null}
					onChange={(event) => setShowOrbitLabels(event.currentTarget.checked)}
				/>
			</Hint>
			<Hint text={t("solarSystem.layers.hint.smallBodies")}>
				<Switch
					size="xs"
					color="orange"
					label={t("solarSystem.layers.smallBodies")}
					checked={showSmallBodies}
					onChange={(event) => setShowSmallBodies(event.currentTarget.checked)}
				/>
			</Hint>
			<Hint text={t("solarSystem.layers.hint.alwaysLit")}>
				<Switch
					size="xs"
					color="orange"
					label={t("solarSystem.layers.alwaysLit")}
					checked={alwaysLit}
					onChange={(event) => setAlwaysLit(event.currentTarget.checked)}
				/>
			</Hint>
		</Group>
	)
}

export default SceneToggles
