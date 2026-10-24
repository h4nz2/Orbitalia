/**
 * Where the point of view (#31) lives on a phone (#75): in the one top row
 * beside the name box (#59) wherever the row has room for it and for a name
 * like "Neptune" or "Voyager 1" whole; on a narrower screen it is an item
 * under More. The row's buttons keep 44 px each and the name box gives way
 * first (SolarSystem.module.css, ui/FocusPicker.module.css): measured in
 * every language, the name box with the point of view beside it is too
 * narrow for "Voyager 1" below 354 px, so the point of view moves under More
 * there, with a few px to spare for other fonts. Not a size class: it says
 * when one row stops fitting.
 */
import { useMediaQuery } from "@mantine/hooks"

export const POINT_OF_VIEW_IN_MORE_QUERY = "(max-width: 357px)"

/** The point of view is an item under More instead of a button in the top row. */
export const usePointOfViewInMore = (): boolean =>
	useMediaQuery(POINT_OF_VIEW_IN_MORE_QUERY, false, {
		getInitialValueInEffect: false,
	})
