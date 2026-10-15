import { Suspense, lazy, useEffect, useLayoutEffect, useRef } from "react"
import { Center, Loader } from "@mantine/core"
import { useNavigate, useSearch } from "@tanstack/react-router"

import { useHuntStore } from "@/store/hunt"

import { resolveHunt } from "./hunts"

import hudClasses from "../SolarSystem.module.css"
import classes from "./Hunt.module.css"

// the panel and the clues' words load when the hunt is first opened
const HuntPanel = lazy(() => import("./HuntPanel"))

/**
 * The hunt panel's place on the page, and its link: `?hunt=true` opens the
 * chooser, `?hunt=<hunt id>` (or question ids joined by ".") opens that hunt,
 * continuing it if it is the one in progress. From then on the URL follows
 * the panel (absent while closed), so the address bar always names the hunt
 * on screen. Leaving the page closes the panel; the progress stays for the tab.
 */
export const HuntPanelSlot = () => {
	const open = useHuntStore((state) => state.open)
	const key = useHuntStore((state) => (state.choosing ? null : state.key))
	const param = useSearch({
		from: "/solar_system",
		select: (search) => search.hunt,
	})
	const navigate = useNavigate()
	const paramRef = useRef(param)
	const seeded = useRef(false)

	useLayoutEffect(() => {
		const store = useHuntStore.getState()
		const requested = paramRef.current
		if (typeof requested === "string") {
			const hunt = resolveHunt(requested)
			if (hunt === null) store.setOpen(true)
			else store.resume(hunt.key)
		} else if (requested === true) {
			store.setOpen(true)
			store.browse()
		}
		seeded.current = true
		return () => useHuntStore.getState().setOpen(false)
	}, [])

	// store -> URL; read from the store, not this render: the first render
	// happened before the link above opened the hunt
	useEffect(() => {
		paramRef.current = param
		if (!seeded.current) return
		const state = useHuntStore.getState()
		const wanted = state.open
			? state.choosing
				? true
				: (state.key ?? true)
			: undefined
		if (param === wanted) return
		void navigate({
			to: "/solar_system",
			search: (previous) => ({ ...previous, hunt: wanted }),
			replace: true,
		})
	}, [param, open, key, navigate])

	if (!open) return null
	return (
		<Suspense
			fallback={
				<div
					className={`${hudClasses.panel} ${classes.panel}`}
					data-sheet-kind="hunt"
				>
					<Center p="md">
						<Loader size="sm" color="orange" />
					</Center>
				</div>
			}
		>
			<HuntPanel />
		</Suspense>
	)
}
