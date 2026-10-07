/**
 * The moons part of the focused view's card (#17, docs/ARCHITECTURE.md,
 * "Moons"). For a planet: its featured moons by name (a click flies there),
 * "See the whole moon system" (a shot that fits every drawn orbit) and the
 * switch for the long tail ("Show 53 smaller moons"; in Poster, which hides
 * the long tail, a line saying so, #54). For a moon: the planet
 * it belongs to (a click flies back), its written story behind "Read more",
 * because moons have no dictionary entry, and where its surface map comes from (#37).
 */
import { useState } from "react"
import { Anchor, Button, Group, UnstyledButton } from "@mantine/core"
import { IconArrowBackUp, IconFocusCentered } from "@tabler/icons-react"

import { bodyById, type Body } from "@/data"
import { useI18n } from "@/i18n"
import { bodyKindLabel, useBodyName, useBodyText } from "@/i18n/bodies"
import { useScaleStore } from "@/store/scale"
import { useSimStore } from "@/store/sim"

import { moonSystemOf, moonSystemShot } from "./moonSystem"
import SurfaceNote from "./SurfaceNote"

import classes from "./MoonSystem.module.css"

const viewAspect = (): number =>
	typeof window === "undefined" || window.innerHeight === 0
		? 1
		: window.innerWidth / window.innerHeight

const PlanetMoons = ({ planet }: { planet: Body }) => {
	const { t } = useI18n()
	const name = useBodyName()
	const setFocus = useSimStore((state) => state.setFocus)
	const goTo = useSimStore((state) => state.goTo)
	const showMoons = useSimStore((state) => state.showMoons)
	const showAllMoons = useSimStore((state) => state.showAllMoons)
	const longTailHidden = useSimStore((state) => state.longTailHidden)
	const setShowMoons = useSimStore((state) => state.setShowMoons)
	const setShowAllMoons = useSimStore((state) => state.setShowAllMoons)
	const { featured, others } = moonSystemOf(planet.id)

	if (featured.length === 0 && others.length === 0) {
		return (
			<p className={classes.none} data-testid="moon-system">
				{t("solarSystem.moons.none", { planet: name(planet.id) })}
			</p>
		)
	}

	const allShown = showMoons && showAllMoons && !longTailHidden
	const drawn = allShown ? [...featured, ...others] : featured
	const viewSystem = () => {
		if (!showMoons) setShowMoons(true)
		goTo(
			{ kind: "body", id: planet.id },
			{
				shot: moonSystemShot(
					planet,
					drawn,
					useScaleStore.getState().scale,
					viewAspect(),
					useSimStore.getState().simTimeJD,
				),
			},
		)
	}
	const toggleOthers = () => {
		if (allShown) {
			setShowAllMoons(false)
			return
		}
		setShowMoons(true)
		setShowAllMoons(true)
	}

	return (
		<section
			className={classes.root}
			aria-label={t("solarSystem.moons.label")}
			data-testid="moon-system"
		>
			<h3 className={classes.heading}>{t("solarSystem.moons.label")}</h3>
			{featured.length > 0 && (
				<ul className={classes.list}>
					{featured.map((moon) => (
						<li key={moon.id}>
							<UnstyledButton
								className={classes.moon}
								data-moon={moon.id}
								onClick={() => setFocus(moon.id)}
							>
								{name(moon.id)}
							</UnstyledButton>
						</li>
					))}
				</ul>
			)}
			<Group gap="xs" mt={6}>
				<Button
					size="compact-xs"
					variant="light"
					color="orange"
					leftSection={<IconFocusCentered size={14} />}
					onClick={viewSystem}
				>
					{t("solarSystem.moons.viewSystem")}
				</Button>
				{others.length > 0 && !longTailHidden && (
					<Button
						size="compact-xs"
						variant="subtle"
						color="gray"
						aria-pressed={allShown}
						title={t("solarSystem.moons.othersNote")}
						onClick={toggleOthers}
						data-testid="toggle-other-moons"
					>
						{allShown
							? t("solarSystem.moons.hideOthers")
							: t("solarSystem.moons.showOthers", { count: others.length })}
					</Button>
				)}
			</Group>
			{others.length > 0 && longTailHidden && (
				<p className={classes.note} data-testid="other-moons-hidden">
					{t("solarSystem.moons.othersHidden", { count: others.length })}
				</p>
			)}
		</section>
	)
}

const MoonStory = ({ moon }: { moon: Body }) => {
	const i18n = useI18n()
	const { t } = i18n
	const text = useBodyText(moon.id)
	const setFocus = useSimStore((state) => state.setFocus)
	const [open, setOpen] = useState(false)
	const parent =
		moon.parentId === null ? undefined : bodyById.get(moon.parentId)

	return (
		<section className={classes.root} data-testid="moon-story">
			{text.authored && (
				<>
					{open && (
						<p className={classes.description} data-testid="moon-description">
							{text.description}
						</p>
					)}
					<Anchor
						component="button"
						type="button"
						size="sm"
						aria-expanded={open}
						onClick={() => setOpen(!open)}
					>
						{t(
							open
								? "solarSystem.moons.readLess"
								: "solarSystem.moons.readMore",
						)}
					</Anchor>
				</>
			)}
			<SurfaceNote moon={moon} />
			{parent !== undefined && (
				<Button
					className={classes.parent}
					size="compact-xs"
					variant="subtle"
					color="gray"
					leftSection={<IconArrowBackUp size={14} />}
					onClick={() => setFocus(parent.id)}
				>
					{bodyKindLabel(moon, i18n)}
				</Button>
			)}
		</section>
	)
}

/** The moon section of the card for `body`: a planet's moons or a moon's story; nothing for the Sun. */
const MoonSystem = ({ body }: { body: Body }) => {
	if (body.kind === "planet" || body.kind === "dwarfPlanet")
		return <PlanetMoons planet={body} />
	if (body.kind === "moon") return <MoonStory key={body.id} moon={body} />
	return null
}

export default MoonSystem
