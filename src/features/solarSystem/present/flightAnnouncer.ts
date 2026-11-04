/**
 * A flight shows nothing on screen, so it says where it goes through the live
 * region (#18): once, as it is asked for, however it then goes on (a drag hands
 * it over, a skip lands it). A presenter's command that flies announces in the
 * same tick and the region renders only the last announcement, so its words are
 * the ones read.
 */
import { FLIGHT_PROFILE } from "@/store/flight"
import { useSimStore } from "@/store/sim"

/** Calls `say` with the destination of every new flight; returns the unsubscribe. */
export function watchFlights(say: (bodyId: string) => void): () => void {
	return useSimStore.subscribe((state, prev) => {
		const { transition } = state
		if (
			transition === null ||
			transition.id === prev.transition?.id ||
			transition.profile !== FLIGHT_PROFILE ||
			transition.view.kind !== "body"
		) {
			return
		}
		say(transition.view.id)
	})
}
