import { FC, useEffect, useRef, useState } from "react"
import { Box, Menu } from "@mantine/core"
import type { SolarDictionaryItem } from "@/data/solarDictionary"
import { useI18n } from "@/i18n"
import { useBodyName } from "@/i18n/bodies"
import { getTypedKeys } from "@/lib/getTypedKeys"
import type { Texture } from ".."
import { dictionaryBodyId } from "../utils/bodyId"
import classes from "./Navbar.module.css"

export type NavbarProps = {
	solarDict: SolarDictionaryItem[]
	activeEntityIndex: number
	onChange: (newIndex: number) => void
	activeTexture: Texture
	onTextureChange: (texture: Texture) => void
}

const Navbar: FC<NavbarProps> = ({
	activeEntityIndex,
	activeTexture,
	onChange,
	onTextureChange,
	solarDict,
}) => {
	const [openMenu, setOpenMenu] = useState(false)
	const { t } = useI18n()
	const bodyName = useBodyName()
	const row = useRef<HTMLDivElement>(null)
	const first = useRef(true)
	// a row that scrolls sideways (a phone, #75): the chosen world in its middle
	useEffect(() => {
		const element = row.current
		const active = element?.querySelector<HTMLElement>("[data-active]")
		if (element == null || active == null) return
		if (element.scrollWidth <= element.clientWidth + 1) return
		const reduced = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches
		element.scrollTo({
			left:
				active.offsetLeft -
				element.offsetLeft -
				(element.clientWidth - active.offsetWidth) / 2,
			behavior: first.current || reduced ? "auto" : "smooth",
		})
		first.current = false
	}, [activeEntityIndex])
	return (
		<Box ref={row} className={classes.base}>
			{solarDict.map((entity, i) => {
				const isActive = i === activeEntityIndex
				const handleOnChange = () => {
					if (isActive) setOpenMenu((o) => !o)
					else onChange(i)
				}
				return (
					<Menu
						key={entity.id}
						shadow="md"
						opened={isActive && openMenu}
						onChange={handleOnChange}
						closeOnItemClick={false}
					>
						<Menu.Target>
							<Box
								className={classes.menuTarget}
								mod={{ active: isActive }}
								data-dictionary-world={i}
								role="button"
								aria-label={t("dictionary.pick", {
									name: bodyName(dictionaryBodyId(entity)),
								})}
							/>
						</Menu.Target>

						<Menu.Dropdown>
							<Menu.Label>{t("dictionary.textures.label")}</Menu.Label>
							<Menu.Divider />

							{(entity.textures ? getTypedKeys(entity.textures) : [])
								.filter((t) => !!entity.textures?.[t])
								.map((texture) => {
									const active = texture === activeTexture
									return (
										<Menu.Item
											key={texture}
											onClick={() => onTextureChange(texture)}
											className={classes.item}
											mod={{ active }}
											my={5}
										>
											{t(`dictionary.textures.${texture}`)}
										</Menu.Item>
									)
								})}
						</Menu.Dropdown>
					</Menu>
				)
			})}
		</Box>
	)
}

export default Navbar
