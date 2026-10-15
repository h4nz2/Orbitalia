import { useMediaQuery } from "@mantine/hooks"

import {
	PHONE_QUERY,
	TOUCH_QUERY,
	UPRIGHT_PHONE_QUERY,
} from "@/utils/sizeClasses"

// read at once, not after a first render: no frame with the wrong arrangement
const options = { getInitialValueInEffect: false }

/** The phone arrangement (#58, `@/utils/sizeClasses`); follows rotation and resizing live. */
export const usePhone = (): boolean =>
	useMediaQuery(PHONE_QUERY, false, options)

/** A finger is the primary pointer (#58): controls are finger-sized. */
export const useTouch = (): boolean =>
	useMediaQuery(TOUCH_QUERY, false, options)

/** A phone held upright (#60): the card, the panels, the tours and the time share one sheet from the bottom. */
export const useUprightPhone = (): boolean =>
	useMediaQuery(UPRIGHT_PHONE_QUERY, false, options)
