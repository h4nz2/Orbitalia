/**
 * The spacecraft names as DOM text beside the body labels (issue #35): one
 * element per craft, attached to the shared label board from `firstSlot` on,
 * positioned and faded by the labels' frame loop (labels/Labels.tsx) together
 * with the bodies' names. Translated through `@/i18n/spacecraft`. The marker
 * picking (CraftMarkers.tsx) makes the names clickable; the layer itself
 * never takes pointer events. Beside each name, a hidden probe tells tests
 * how the craft is drawn (#73, ./modelProbe.ts).
 */
import { useLayoutEffect } from "react"

import { spacecraft } from "@/data/spacecraft"
import { useSpacecraftName } from "@/i18n/spacecraft"
import { useSimStore } from "@/store/sim"
import { useSpacecraftStore } from "@/store/spacecraft"

import { attachLabel, measureLabels, type LabelBoard } from "../labels/board"
import { attachModelProbe } from "./modelProbe"

import labelClasses from "../labels/Labels.module.css"
import classes from "./Spacecraft.module.css"

export interface SpacecraftLabelLayerProps {
	board: LabelBoard
	firstSlot: number
}

function SpacecraftLabelLayer({ board, firstSlot }: SpacecraftLabelLayerProps) {
	const name = useSpacecraftName()
	const showLabels = useSimStore((state) => state.showLabels)
	const selected = useSpacecraftStore((state) => state.selectedCraftId)
	const hovered = useSpacecraftStore((state) => state.hoverCraftId)

	useLayoutEffect(() => {
		if (!showLabels) return
		const measure = () => measureLabels(board)
		measure()
		let live = true
		void document.fonts?.ready.then(() => {
			if (live) measure()
		})
		window.addEventListener("resize", measure)
		return () => {
			live = false
			window.removeEventListener("resize", measure)
		}
	}, [board, name, showLabels])

	return (
		<div className={labelClasses.layer} aria-hidden hidden={!showLabels}>
			{spacecraft.map((craft, k) => (
				<span
					key={craft.id}
					ref={(element) => {
						attachLabel(board, firstSlot + k, element)
					}}
					className={`${labelClasses.label} ${classes.label}`}
					data-craft={craft.id}
					data-selected={craft.id === selected || undefined}
					data-hovered={craft.id === hovered || undefined}
				>
					{name(craft.id)}
				</span>
			))}
			{spacecraft.map((craft) => (
				<span
					key={`model-${craft.id}`}
					hidden
					data-craft-model={craft.id}
					ref={(element) => attachModelProbe(craft.id, element)}
				/>
			))}
		</div>
	)
}

export default SpacecraftLabelLayer
