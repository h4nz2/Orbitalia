import { FC, useEffect, useRef } from "react"
import { Box, Text } from "@mantine/core"
import gsap from "gsap"
import { blurUpIn } from "../keyframes/blurUpIn"
import type { SidebarFact } from "../utils/getSidebarLabels"
import classes from "./Sidebar.module.css"

export type StageLabelProps = {
	/** Translated, locale-formatted facts (utils/getSidebarLabels.ts). */
	facts: SidebarFact[]
}

const Sidebar: FC<StageLabelProps> = ({ facts }) => {
	const textRefs = useRef<HTMLElement[]>([])
	const textRef = (el: HTMLElement | null) => {
		if (el && !textRefs.current.includes(el)) textRefs.current.push(el)
	}

	useEffect(() => {
		gsap.fromTo(
			textRefs.current,
			{ alpha: 0 },
			{
				alpha: 1,
				keyframes: blurUpIn,
				duration: 0.5,
				stagger: 0.025,
			},
		)
	}, [facts])

	return (
		<Box className={classes.base}>
			{facts.map(({ key, label, value, extra }) => (
				<Box key={key} data-fact-key={key}>
					<Box ref={textRef} className={classes.label} data-fact-label>
						<Box className={classes.littleBar} />
						{label}
						<Box className={classes.littleBar} />
					</Box>

					<Text
						ref={textRef}
						data-fact-value
						className={
							key === "name"
								? `${classes.text} ${classes.largeText}`
								: classes.text
						}
					>
						{value}
						{extra ? (
							<>
								<br />
								<span className={classes.extra} data-fact-extra>
									{extra}
								</span>
							</>
						) : null}
					</Text>
				</Box>
			))}
		</Box>
	)
}

export default Sidebar
