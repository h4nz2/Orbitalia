import { FC, useMemo } from "react"
import { Box, Button } from "@mantine/core"
import { IconArrowLeft } from "@tabler/icons-react"
import { getRouteApi } from "@tanstack/react-router"
import {
	useSolarDictionary,
	type SolarDictionaryItem,
	type Textures,
} from "@/data/solarDictionary"
import { bodyById } from "@/data"
import { useBackToSolarSystem } from "@/hooks/useBackToSolarSystem"
import { useI18n } from "@/i18n"
import { CornerBar } from "@/features/help/HelpButton"
import { bodyName } from "@/i18n/bodies"
import Loader from "@/primitives/Loader"
import Navbar from "./components/Navbar"
import type { DictionarySection } from "./search"
import { dictionaryBodyId } from "./utils/bodyId"
import { getSidebarFacts, type FactKey } from "./utils/getSidebarLabels"
import Stage from "./components/Stage"

import classes from "./SolarDictionary.module.css"

export type Texture = keyof Textures

const defaultTexture: Texture = "base"

const requiredLabelsSun: FactKey[] = ["name", "diameter", "gravity", "avgTemp"]

const requiredLabels: FactKey[] = [
	"name",
	"diameter",
	"lengthOfDay",
	"orbitalPeriod",
	"gravity",
	"avgTemp",
]
/** A body's volume in km³ from the body model, when it has one. */
const volumeKm3 = (item: SolarDictionaryItem | undefined): number | null => {
	const vol = item && bodyById.get(dictionaryBodyId(item))?.info.vol
	if (typeof vol !== "object" || vol === null) return null
	const { volValue, volExponent } = vol as Record<string, unknown>
	return typeof volValue === "number" && typeof volExponent === "number"
		? volValue * 10 ** volExponent
		: null
}

const sunIdx = 0
const earthIdx = 3

// The selection is URL state (`?entity=3&texture=topo&section=weather`,
// validated in src/routes/solar_dictionary.tsx) so every body, and every
// story section, can be deep-linked.
const route = getRouteApi("/solar_dictionary")

export type SolarDictionaryProps = {
	data?: SolarDictionaryItem[]
}

const SolarDictionary: FC<SolarDictionaryProps> = () => {
	const { data: solarDict, loading } = useSolarDictionary()
	const i18n = useI18n()

	const {
		entity: activeEntityIndex = sunIdx,
		texture: requestedTexture = defaultTexture,
		section = null,
	} = route.useSearch()
	const navigate = route.useNavigate()

	const currentEntity = solarDict[activeEntityIndex]
	// opened from a link: the solar system on the world this page shows
	const back = useBackToSolarSystem(
		currentEntity ? { focus: dictionaryBodyId(currentEntity) } : {},
	)

	// a valid texture name the body does not have (`?entity=1&texture=topo`) falls back to
	// base for the menu and the stage alike, so the highlighted item is always the shown one
	const activeTexture: Texture = currentEntity?.textures?.[requestedTexture]
		? requestedTexture
		: defaultTexture

	// a newly selected body always starts on its base texture, but keeps the open
	// section, so a class can go through the planets' weather one by one;
	// defaults stay out of the URL
	const onEntityChange = (newIndex: number) => {
		const entity =
			newIndex > solarDict.length - 1 || newIndex < 0 ? sunIdx : newIndex
		void navigate({
			search: (prev) => ({
				entity: entity === sunIdx ? undefined : entity,
				section: prev.section,
			}),
			replace: true,
		})
	}

	const onSectionChange = (next: DictionarySection | null) =>
		void navigate({
			search: (prev) => ({ ...prev, section: next ?? undefined }),
			replace: true,
		})

	const onTextureChange = (texture: Texture) =>
		void navigate({
			search: (prev) => ({
				...prev,
				texture: texture === defaultTexture ? undefined : texture,
			}),
			replace: true,
		})

	const earth = solarDict[earthIdx]
	const facts = useMemo(
		() =>
			getSidebarFacts(
				currentEntity,
				activeEntityIndex === sunIdx ? requiredLabelsSun : requiredLabels,
				earth,
				i18n,
				currentEntity
					? bodyName(dictionaryBodyId(currentEntity), i18n.chain)
					: "",
				{ body: volumeKm3(currentEntity), earth: volumeKm3(earth) },
			),
		[currentEntity, activeEntityIndex, earth, i18n],
	)

	if (!currentEntity || loading) return <Loader />

	return (
		<Box w="100%" h="100vh">
			<CornerBar />
			<Button
				variant="subtle"
				color="gray"
				size="compact-md"
				className={classes.back}
				leftSection={<IconArrowLeft size={18} aria-hidden />}
				aria-label={i18n.t("dictionary.back")}
				onClick={back}
				data-testid="dictionary-back"
			>
				<span className={classes.label}>{i18n.t("dictionary.back")}</span>
			</Button>
			<Navbar
				activeEntityIndex={activeEntityIndex}
				activeTexture={activeTexture}
				onChange={onEntityChange}
				onTextureChange={onTextureChange}
				solarDict={solarDict}
			/>
			<Stage
				texture={currentEntity.textures?.[activeTexture] ?? undefined}
				facts={facts}
				bodyId={dictionaryBodyId(currentEntity)}
				section={section}
				onSectionChange={onSectionChange}
			/>
		</Box>
	)
}

export default SolarDictionary
