/**
 * The overlay of the Easy hints that show (#52, ./spot.ts): one element over
 * the canvas, placed every frame by `HuntSpotTracker` (in the Canvas), hidden
 * while no Easy hint asks for it.
 */
import { useLayoutEffect, useRef } from "react"

import { huntSpot } from "./spot"

import classes from "./HuntSpot.module.css"

const HuntSpot = () => {
	const ref = useRef<HTMLDivElement>(null)

	useLayoutEffect(() => {
		huntSpot.element = ref.current
		return () => {
			huntSpot.element = null
		}
	}, [])

	return (
		<div className={classes.layer} aria-hidden="true">
			<div ref={ref} className={classes.spot} data-testid="hunt-spot">
				<span className={classes.wave} />
			</div>
		</div>
	)
}

export default HuntSpot
