import { useEffect, useState } from "react"
import { useSearch } from "@tanstack/react-router"

import { spacecraftById } from "@/data/spacecraft"
import { useScaleStore } from "@/store/scale"
import { withoutSteps } from "@/store/viewHistory"

import { showCraft } from "./facts"
import { loadTrajectories } from "./trajectories"

/**
 * `?craft=voyager1` (the help page's "try it" link, #43): selects that
 * spacecraft (#35) on arrival and flies to it once its trajectory has loaded.
 * Like `?light=`, only an instruction: the URL mirror drops it, so a reload
 * or a shared view does not fly anywhere by itself. With `follow=true` (#57)
 * it is the view itself, which the URL sync opens (src/store/urlSync.ts).
 */
const CraftLink = () => {
	const craft = useSearch({
		from: "/solar_system",
		select: (search) => (search.follow === true ? undefined : search.craft),
	})
	// read once, on arrival: the URL mirror drops `craft` at once, long before
	// the trajectories have loaded
	const [requested] = useState(craft)
	useEffect(() => {
		if (requested === undefined || !spacecraftById.has(requested)) return
		let live = true
		void loadTrajectories().then(() => {
			// arriving on a link is not a step of the view history (#46)
			if (live) {
				withoutSteps(() => showCraft(requested, useScaleStore.getState().scale))
			}
		})
		return () => {
			live = false
		}
	}, [requested])
	return null
}

export default CraftLink
