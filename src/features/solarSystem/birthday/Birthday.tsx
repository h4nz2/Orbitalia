import { Suspense, lazy, useLayoutEffect } from "react"
import { Center, Loader } from "@mantine/core"
import { useSearch } from "@tanstack/react-router"

import { useBirthdayStore } from "@/store/birthday"

import classes from "./BirthdayPanel.module.css"

// the panel brings the calendar (@mantine/dates): loaded when first opened
const BirthdayPanel = lazy(() => import("./BirthdayPanel"))

/**
 * The birthday panel's place on the page: nothing until opened. A link with
 * `?birthday=true` opens it on arrival. Leaving the page closes it; the birth
 * date stays in memory until the tab is closed or "Forget my birthday" is
 * pressed.
 */
export const BirthdayPanelSlot = () => {
	const open = useBirthdayStore((state) => state.open)
	const requested = useSearch({
		from: "/solar_system",
		select: (search) => search.birthday === true,
	})
	useLayoutEffect(() => {
		if (requested) useBirthdayStore.getState().setOpen(true)
	}, [requested])
	useLayoutEffect(() => () => useBirthdayStore.getState().setOpen(false), [])
	if (!open) return null
	return (
		<Suspense
			fallback={
				<div className={classes.panel}>
					<Center h="100%">
						<Loader size="sm" color="orange" />
					</Center>
				</div>
			}
		>
			<BirthdayPanel />
		</Suspense>
	)
}
