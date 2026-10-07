import { useMemo } from "react"
import {
	Select,
	type ComboboxItem,
	type ComboboxItemGroup,
	type ComboboxLikeRenderOptionInput,
} from "@mantine/core"
import { IconFocus2 } from "@tabler/icons-react"

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
import { useI18n, type I18n } from "@/i18n"
import { bodyName } from "@/i18n/bodies"
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

/** Searchable picker of the focused body, grouped by planet. */
const FocusPicker = () => {
	// a free centre (#15) is not the anchor body: the badge names it instead
	const focusId = useSimStore((state) =>
		freeCentreId(state) === null ? state.focusId : null,
	)
	const setFocus = useSimStore((state) => state.setFocus)
	const i18n = useI18n()
	const { t, chain } = i18n
	const data = useMemo(() => focusOptions(chain, t), [chain, t])
	useWindowKeydown(handleKeyDown)

	const renderOption = ({
		option,
	}: ComboboxLikeRenderOptionInput<ComboboxItem>) => {
		const body = bodyById.get(option.value)
		const radius = body && i18n.quantity(body.radiusKm, "kilometer")
		return (
			<span className={classes.option}>
				<span>{option.label}</span>
				{body !== undefined && radius !== undefined && (
					<span className={classes.meta}>
						{body.radiusEstimated
							? t("units.approx", { value: radius })
							: radius}
					</span>
				)}
			</span>
		)
	}

	return (
		<Select
			className={classes.select}
			aria-label={t("solarSystem.picker.label")}
			placeholder={t("solarSystem.picker.placeholder")}
			leftSection={<IconFocus2 size={16} />}
			data={data}
			value={focusId}
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
	)
}

export default FocusPicker
