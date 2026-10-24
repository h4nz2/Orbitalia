/**
 * The decoded spacecraft trajectories (issue #35), shared by the scene and the
 * HUD. The data arrives on demand (`loadTrajectoryData` in @/data/spacecraft),
 * fetched the first time the spacecraft layer is shown (#73,
 * ./SpacecraftScene.tsx) or the spacecraft list opened; until it has, every
 * craft is simply absent from the scene and the HUD says nothing about
 * positions. `trajectoriesReady` in the spacecraft store flips when it
 * arrives, so React UI re-renders once.
 */
import { bodies } from "@/data"
import { loadTrajectoryData } from "@/data/spacecraft"
import { buildIndex } from "@/sim"
import { decodeTrajectory, type CraftTrajectory } from "@/sim/spacecraft"
import { useSpacecraftStore } from "@/store/spacecraft"
import { spacecraft } from "@/data/spacecraft"

let decoded: ReadonlyMap<string, CraftTrajectory> | null = null
let loading: Promise<void> | null = null

/** A craft's trajectory, or null while the data has not arrived. */
export const trajectoryOf = (id: string): CraftTrajectory | null =>
	decoded?.get(id) ?? null

/** Fetches and decodes every trajectory once; later calls share the first. */
export function loadTrajectories(): Promise<void> {
	loading ??= loadTrajectoryData().then((data) => {
		const index = buildIndex(bodies)
		decoded = new Map(
			spacecraft.flatMap((craft) => {
				const segments = data[craft.id]
				return segments === undefined
					? []
					: [
							[
								craft.id,
								decodeTrajectory(craft, segments, bodies, index),
							] as const,
						]
			}),
		)
		useSpacecraftStore.setState({ trajectoriesReady: true })
	})
	return loading
}

/**
 * Runs `then` with the trajectories in: at once when they are, else once
 * they have arrived (fetching them), so a craft chosen before the data is
 * there is still flown to.
 */
export function withTrajectories(then: () => void): void {
	if (decoded !== null) then()
	else void loadTrajectories().then(then)
}
