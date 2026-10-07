import { useEffect, useRef, type FC } from "react"
import { Accordion } from "@mantine/core"
import {
	IconStack2,
	IconTag,
	IconTemperature,
	type Icon,
} from "@tabler/icons-react"

import { worldById } from "@/data/worlds"
import { useI18n } from "@/i18n"
import { useBodyName } from "@/i18n/bodies"

import { DICTIONARY_SECTIONS, type DictionarySection } from "../search"
import MadeOf from "./MadeOf"
import Names from "./Names"
import Weather from "./Weather"
import classes from "./Stories.module.css"

export type WorldStoriesProps = {
	bodyId: string
	/** The open section (URL state), or null when all are closed. */
	section: DictionarySection | null
	onSectionChange: (section: DictionarySection | null) => void
}

const ICONS: Record<DictionarySection, Icon> = {
	madeOf: IconStack2,
	weather: IconTemperature,
	names: IconTag,
}

/**
 * The stories about a world (#53) in sections the reader opens one at a time,
 * so the page never becomes a wall of text: what it is made of, how hot it
 * gets, its names.
 */
const WorldStories: FC<WorldStoriesProps> = ({
	bodyId,
	section,
	onSectionChange,
}) => {
	const { t } = useI18n()
	const name = useBodyName()(bodyId)
	const world = worldById.get(bodyId)
	const root = useRef<HTMLDivElement>(null)

	// bring the opened section to the top of the scrolling column, once it has unfolded
	useEffect(() => {
		if (section === null) return
		const timer = window.setTimeout(() => {
			const control = root.current?.querySelector(`[data-section="${section}"]`)
			const reduced = window.matchMedia(
				"(prefers-reduced-motion: reduce)",
			).matches
			control?.scrollIntoView({
				block: "start",
				behavior: reduced ? "auto" : "smooth",
			})
		}, 200)
		return () => window.clearTimeout(timer)
	}, [section])

	if (world === undefined) return null

	return (
		<Accordion
			ref={root}
			value={section}
			onChange={(value) => onSectionChange(value as DictionarySection | null)}
			classNames={{
				root: classes.accordion,
				control: classes.control,
				label: classes.controlLabel,
				content: classes.content,
				item: classes.item,
			}}
			chevronPosition="right"
			keepMounted={false}
			order={2}
			transitionDuration={150}
			aria-label={t("dictionary.section.label", { name })}
		>
			{DICTIONARY_SECTIONS.map((id) => {
				const Icon = ICONS[id]
				return (
					<Accordion.Item key={id} value={id} data-section={id}>
						<Accordion.Control
							icon={<Icon size={20} aria-hidden />}
							data-testid={`dictionary-section-${id}`}
						>
							{t(`dictionary.section.${id}`)}
						</Accordion.Control>
						<Accordion.Panel>
							{id === "madeOf" ? (
								<MadeOf world={world} name={name} />
							) : id === "weather" ? (
								<Weather world={world} />
							) : (
								<Names world={world} />
							)}
						</Accordion.Panel>
					</Accordion.Item>
				)
			})}
		</Accordion>
	)
}

export default WorldStories
