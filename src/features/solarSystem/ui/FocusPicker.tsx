import { useMemo } from "react"
import {
	Select,
	type ComboboxItem,
	type ComboboxItemGroup,
	type ComboboxLikeRenderOptionInput,
} from "@mantine/core"
import { IconCurrentLocation, IconFocus2 } from "@tabler/icons-react"

import {
	asteroids,
	bodyById,
	comets,
	dwarfPlanets,
	moonsOf,
	planets,
	sun,
	type Body,
} from "@/data"
import { formatSize, isSimple, useI18n, type I18n } from "@/i18n"
import { bodyName } from "@/i18n/bodies"
import { getSpacecraftText } from "@/i18n/spacecraft"
import { Hint } from "@/primitives/hint"
import { followedCraftId } from "@/store/navigation"
import { allMoonsShown, useSimStore } from "@/store/sim"

import { freeCentreId } from "./centre"
import { cycleFocus } from "./focusCycle"
import { hasModifier, isEditableTarget, useWindowKeydown } from "./keyboard"

import classes from "./FocusPicker.module.css"

/** The featured moons (#17) first, then the long tail; the larger first within each. */
const featuredThenLargest = (a: Body, b: Body): number =>
	Number(b.featured === true) - Number(a.featured === true) ||
	b.radiusKm - a.radiusKm

/**
 * The Sun, then one group per planet holding the planet itself and all its
 * moons, the featured ones first, largest first; then (#23) the dwarf planets
 * each followed by its moons, the asteroids and the comets. Names in the active
 * language, so the search matches "Erde" in German and "Earth" in English.
 * The long tail is listed even while it is hidden: picking a moon focuses, and
 * so draws, it; picking a small body shows it (and its moons) even while the
 * "Small bodies" layer is off.
 */
export function focusOptions(
	chain: I18n["chain"],
	t: I18n["t"],
): ComboboxItemGroup<ComboboxItem>[] {
	const toItem = (body: Body): ComboboxItem => ({
		value: body.id,
		label: bodyName(body.id, chain),
	})
	return [
		{ group: bodyName(sun.id, chain), items: [toItem(sun)] },
		...planets.map((planet) => ({
			group: bodyName(planet.id, chain),
			items: [planet, ...moonsOf(planet.id).sort(featuredThenLargest)].map(
				toItem,
			),
		})),
		{
			group: t("solarSystem.picker.dwarfPlanets"),
			items: dwarfPlanets
				.flatMap((dwarf) => [
					dwarf,
					...moonsOf(dwarf.id).sort(featuredThenLargest),
				])
				.map(toItem),
		},
		{
			group: t("solarSystem.picker.asteroids"),
			items: asteroids.map(toItem),
		},
		{ group: t("solarSystem.picker.comets"), items: comets.map(toItem) },
	].filter((group) => group.items.length > 0)
}

/** Left/Right cycle the focus among siblings; text fields and other widgets keep their arrows. */
const handleKeyDown = (event: KeyboardEvent): void => {
	if (hasModifier(event) || isEditableTarget(event.target)) return
	if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
	const state = useSimStore.getState()
	const { focusId, setFocus } = state
	const next = cycleFocus(
		focusId,
		event.key === "ArrowRight" ? 1 : -1,
		allMoonsShown(state),
	)
	if (next === focusId) return
	event.preventDefault()
	setFocus(next)
}

/**
 * Searchable picker of the focused body, grouped by planet: the "what you are
 * looking at" spot (#42). While a spacecraft is followed (#57) it names the
 * craft beside the follow mark; choosing a world there ends the ride.
 */
const FocusPicker = () => {
	// a free centre (#15) is not the anchor body: the badge names it instead
	const focusId = useSimStore((state) =>
		freeCentreId(state) === null ? state.focusId : null,
	)
	const followed = useSimStore((state) => followedCraftId(state.view))
	const setFocus = useSimStore((state) => state.setFocus)
	const i18n = useI18n()
	const { t, chain } = i18n
	const craftName =
		followed === null ? null : getSpacecraftText(followed, i18n).name
	const data = useMemo(() => focusOptions(chain, t), [chain, t])
	useWindowKeydown(handleKeyDown)

	const renderOption = ({
		option,
	}: ComboboxLikeRenderOptionInput<ComboboxItem>) => {
		const body = bodyById.get(option.value)
		// the simple level: a size word ("huge") instead of the kilometres (#51)
		const radius =
			body &&
			(isSimple(i18n)
				? formatSize(2 * body.radiusKm, i18n)
				: i18n.quantity(body.radiusKm, "kilometer"))
		return (
			<span className={classes.option}>
				<span>{option.label}</span>
				{body !== undefined && radius !== undefined && (
					<span className={classes.meta}>
						{body.radiusEstimated && !isSimple(i18n)
							? t("units.approx", { value: radius })
							: radius}
					</span>
				)}
			</span>
		)
	}

	return (
		<Hint
			text={
				craftName === null
					? undefined
					: t("solarSystem.spacecraft.hint.spot", { name: craftName })
			}
		>
			<Select
				className={classes.select}
				data-following={followed ?? undefined}
				aria-label={
					craftName === null
						? t("solarSystem.picker.label")
						: t("solarSystem.spacecraft.followSpot", { name: craftName })
				}
				placeholder={craftName ?? t("solarSystem.picker.placeholder")}
				leftSection={
					craftName === null ? (
						<IconFocus2 size={16} />
					) : (
						<IconCurrentLocation
							size={16}
							className={classes.following}
							data-follow-mark
						/>
					)
				}
				data={data}
				value={craftName === null ? focusId : null}
				onChange={(value) => {
					if (value !== null) setFocus(value)
				}}
				renderOption={renderOption}
				searchable
				nothingFoundMessage={t("solarSystem.picker.nothingFound")}
				allowDeselect={false}
				maxDropdownHeight={320}
				comboboxProps={{ shadow: "md" }}
			/>
		</Hint>
	)
}

export default FocusPicker
