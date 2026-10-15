import { useLayoutEffect, useRef } from "react"

import { useFreeAreaStore, type FreeArea as Area } from "@/store/freeArea"

/**
 * The part of the screen the HUD leaves free (#61; docs/ARCHITECTURE.md,
 * "Framing what is free"), measured for the camera. An empty, invisible
 * element of the HUD grid that the phone's arrangement places in the open
 * row between its top and bottom stacks (`.free` in SolarSystem.module.css;
 * `display: none` elsewhere, where nothing covers the scene in bands): its
 * box is exactly what can be seen, so the camera centres and fits what it
 * looks at there.
 *
 * Measured at mount (before the first frame) and whenever the box or any
 * piece of the HUD around it changes size (a card unfolded, a panel opened,
 * a badge shown), not every frame.
 */
export function measureFreeArea(free: HTMLElement, page: HTMLElement): Area {
	const screen = page.getBoundingClientRect()
	const box = free.getBoundingClientRect()
	const shown = box.width > 0 && box.height > 0
	return {
		width: screen.width,
		height: screen.height,
		top: shown ? Math.max(0, box.top - screen.top) : 0,
		bottom: shown ? Math.max(0, screen.bottom - box.bottom) : 0,
	}
}

export interface FreeAreaProps {
	className?: string
}

function FreeArea({ className }: FreeAreaProps) {
	const ref = useRef<HTMLDivElement>(null)

	useLayoutEffect(() => {
		const free = ref.current
		const hud = free?.parentElement
		// the page the canvas fills (the HUD may be hidden, #29: its box is then empty)
		const page = hud?.parentElement ?? hud
		if (free === null || hud == null || page == null) return
		const measure = () =>
			useFreeAreaStore.getState().setArea(measureFreeArea(free, page))
		measure()
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", measure)
			return () => window.removeEventListener("resize", measure)
		}
		// the band's own size, the HUD's (the screen), and every piece of the
		// HUD round it: a stack that grows while the other shrinks by as much
		// moves the band without resizing it
		const sizes = new ResizeObserver(measure)
		const observeAll = () => {
			sizes.disconnect()
			sizes.observe(free)
			sizes.observe(page)
			sizes.observe(hud)
			for (const child of hud.children) sizes.observe(child)
		}
		observeAll()
		const children = new MutationObserver(() => {
			observeAll()
			measure()
		})
		children.observe(hud, { childList: true })
		return () => {
			sizes.disconnect()
			children.disconnect()
			useFreeAreaStore.getState().setArea({
				...useFreeAreaStore.getState().area,
				top: 0,
				bottom: 0,
			})
		}
	}, [])

	return <div ref={ref} className={className} data-free-area aria-hidden />
}

export default FreeArea
