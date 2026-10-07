/**
 * The label names as DOM text over the Canvas (docs/ARCHITECTURE.md, "Labels"):
 * crisp at any resolution, translated through `@/i18n/bodies`, styled by CSS.
 * One element per body is rendered once (and again only when the language, the
 * Labels switch, the hover or the selection changes), plus one per orbit while
 * the orbit names are on; ./Labels.tsx positions and fades them every frame.
 * The layer never takes pointer events: picking goes through the scene
 * (Labels.tsx), so a drag on a label still orbits.
 * While an Easy clue of the scavenger hunt is on screen (#52) the Sun, the
 * planets and the moons of the planet in view carry a picture beside their
 * name, so a child who cannot read can match the clue's picture.
 * `aria-hidden`: the names are a visual aid, the focus picker is the
 * accessible way to reach every body.
 */
import { useLayoutEffect } from "react"

import { bodies, bodyById, type Body } from "@/data"
import { useBodyName } from "@/i18n/bodies"
import { useHuntStore } from "@/store/hunt"
import { useSimStore } from "@/store/sim"

import BodyPicture from "../ui/BodyPicture"

import { attachLabel, measureLabels, type LabelBoard } from "./board"
import { orbitSlot } from "./project"

import classes from "./Labels.module.css"

export interface LabelLayerProps {
	board: LabelBoard
}

/** The planet whose moons are in view: the focus, or the focused moon's planet. */
const familyOf = (focusId: string): string => {
	const focus = bodyById.get(focusId)
	return focus?.kind === "moon" ? (focus.parentId ?? focusId) : focusId
}

/**
 * Whether body's name gets a picture while pictures are on: the Sun and the
 * planets, and the featured moons of the planet in view (moon maps load only
 * near their planet, #37). Giants get a bigger one.
 */
export function labelPicture(body: Body, family: string): string | null {
	if (body.kind === "star") return "1.5em"
	if (body.kind === "planet") return body.radiusKm > 20_000 ? "1.6em" : "1.2em"
	if (body.kind === "moon" && body.featured && body.parentId === family) {
		return "1.15em"
	}
	return null
}

function LabelLayer({ board }: LabelLayerProps) {
	const name = useBodyName()
	const showLabels = useSimStore((state) => state.showLabels)
	const selectedId = useSimStore((state) => state.selectedId)
	const hoverId = useSimStore((state) => state.hoverId)
	const orbitNames = useSimStore(
		(state) => state.showOrbits && state.showOrbitLabels,
	)
	const pictures = useHuntStore((state) => state.assist)
	const family = useSimStore((state) => familyOf(state.focusId))
	const n = bodies.length

	// sizes change with the language, once the web font has loaded, and with
	// the viewport (the font size follows it)
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
	}, [board, name, showLabels, orbitNames, pictures, family])

	return (
		<div
			className={classes.layer}
			aria-hidden
			hidden={!showLabels}
			data-label-layer
		>
			{bodies.map((body, i) => {
				const picture = pictures ? labelPicture(body, family) : null
				return (
					<span
						key={body.id}
						ref={(element) => {
							attachLabel(board, i, element)
						}}
						className={classes.label}
						data-body={body.id}
						data-kind={body.kind}
						data-selected={body.id === selectedId || undefined}
						data-hovered={body.id === hoverId || undefined}
					>
						{picture === null ? (
							name(body.id)
						) : (
							<>
								<BodyPicture
									id={body.id}
									size={picture}
									className={classes.picture}
								/>
								<span data-label-text>{name(body.id)}</span>
							</>
						)}
					</span>
				)
			})}
			{orbitNames &&
				bodies.map((body, i) =>
					body.orbit === null ? null : (
						<span
							key={`orbit-${body.id}`}
							ref={(element) => {
								attachLabel(board, orbitSlot(i, n), element)
							}}
							className={`${classes.label} ${classes.orbit}`}
							data-orbit={body.id}
							data-kind={body.kind}
							data-hovered={body.id === hoverId || undefined}
						>
							{name(body.id)}
						</span>
					),
				)}
		</div>
	)
}

export default LabelLayer
