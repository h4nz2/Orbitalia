import { FC, memo } from "react"
import { Box } from "@mantine/core"
import Scene from "../THREE/Scene"
import Sidebar from "../components/Sidebar"
import type { DictionarySection } from "../search"
import type { SidebarFact } from "../utils/getSidebarLabels"
import BodyDescription from "./BodyDescription"
import WorldStories from "./WorldStories"
import classes from "./Stage.module.css"

export type StageProps = {
	texture?: string
	facts: SidebarFact[]
	/** Body id (src/data/bodies.json) of the shown entry, for its written description. */
	bodyId: string
	/** The open story section (#53), or null. */
	section: DictionarySection | null
	onSectionChange: (section: DictionarySection | null) => void
}

const Stage: FC<StageProps> = ({
	texture,
	facts,
	bodyId,
	section,
	onSectionChange,
}) => {
	return (
		<Box className={classes.base}>
			<Scene texture={texture} />
			<Sidebar facts={facts} />
			<aside className={classes.column} data-open={section ?? undefined}>
				<BodyDescription bodyId={bodyId} />
				<WorldStories
					bodyId={bodyId}
					section={section}
					onSectionChange={onSectionChange}
				/>
			</aside>
		</Box>
	)
}

export default memo(Stage)
