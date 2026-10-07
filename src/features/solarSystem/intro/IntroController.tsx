/**
 * Decides, once per arrival on the page, whether the opening plays (#30): a
 * first visit on this device, on a link that does not say where to look.
 * Rendered right after the URL sync, so a link's view is already applied and
 * a plain arrival starts from the seeded store. Leaving the page stops it.
 * Also installs the keys and the tap that pause and step it (#49, ./pace.ts).
 */
import { useEffect, useLayoutEffect, useState } from "react"
import { useSearch } from "@tanstack/react-router"

import { useI18n } from "@/i18n"

import {
	cancelIntro,
	shouldPlayOnArrival,
	startIntro,
	watchIntro,
} from "./intro"
import { onIntroKey, onSceneClick } from "./pace"

const IntroController = () => {
	const search = useSearch({ from: "/solar_system" })
	// decided from the URL the page was opened with, before anything writes to it;
	// `?intro=play` replays it on purpose (the help page's link, #43)
	const [play] = useState(
		() => search.intro === "play" || shouldPlayOnArrival(search),
	)
	const i18n = useI18n()
	// the captions are timed for the reading level the page opened with (#49)
	const [readingLevel] = useState(i18n.readingLevel)

	useLayoutEffect(() => {
		const unwatch = watchIntro()
		if (play) startIntro(readingLevel)
		return () => {
			unwatch()
			cancelIntro()
		}
	}, [play, readingLevel])

	useEffect(() => {
		const options = { capture: true }
		window.addEventListener("keydown", onIntroKey, options)
		window.addEventListener("click", onSceneClick, options)
		return () => {
			window.removeEventListener("keydown", onIntroKey, options)
			window.removeEventListener("click", onSceneClick, options)
		}
	}, [])

	return null
}

export default IntroController
