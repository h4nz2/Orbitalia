/**
 * The focused view's card (#16): the selected body (else the body the view is
 * on), its name and tagline, an authored comparison (with the way to the
 * walk on the school field where the walk has the body, #48), the headline facts
 * (comparative first: "11 Earths wide", with the exact number beside it), a
 * link into its dictionary entry, and a close button that leaves the camera
 * where it is (the way back to the overview is the home button). With
 * nothing to show (the overview, a free view) it tells a first-time visitor
 * that the planets can be clicked. The card starts small, name and one
 * sentence (#42), and its facts unfold on demand, so it never buries the scene.
 */
import { useEffect, useMemo } from "react"
import { ActionIcon, Anchor, Button, CloseButton } from "@mantine/core"
import {
	IconChevronDown,
	IconChevronUp,
	IconHandClick,
	IconScale,
	IconWalk,
} from "@tabler/icons-react"
import { Link, useNavigate } from "@tanstack/react-router"

import { compareSearchFor } from "@/features/compare/links"
import { isWalkFocusId } from "@/features/solarWalk/search"

import { bodyById } from "@/data"
import { useI18n } from "@/i18n"
import { useBodyText } from "@/i18n/bodies"
import { useHudStore } from "@/store/hud"
import { useSimStore, type SimState } from "@/store/sim"

import BodyRecording from "../sound/BodyRecording"
import {
	SmallBodiesLegend,
	SmallBodyNotes,
} from "../smallBodies/SmallBodyNotes"

import { headlineFacts } from "./bodyFacts"
import { dictionaryEntry } from "./dictionaryEntry"
import MoonSystem from "./MoonSystem"
import WorldSurfaceNote from "./WorldSurfaceNote"

import classes from "./BodyInfo.module.css"

/** The body the card is about: the selection, else the focused body; null in the overview or a free view. */
export const cardBodyId = (
	state: Pick<SimState, "selectedId" | "view">,
): string | null =>
	state.selectedId ?? (state.view.kind === "body" ? state.view.id : null)

/**
 * "Compare with…" (#24): the body beside its first partner at true relative
 * size, measured at the moment on screen. In the card's header, so it is one
 * click away however long the facts are and while a phone folds them away.
 */
const CompareButton = ({ bodyId }: { bodyId: string }) => {
	const { t } = useI18n()
	const navigate = useNavigate()
	return (
		<Button
			variant="light"
			color="orange"
			size="compact-sm"
			leftSection={<IconScale size={16} />}
			// the quick look (#44) points at it
			data-spot="compare"
			onClick={() =>
				void navigate({
					to: "/compare",
					search: compareSearchFor(bodyId, useSimStore.getState()),
				})
			}
		>
			{t("solarSystem.card.compare")}
		</Button>
	)
}

/**
 * Under the comparison (#48): the same idea taken outside, the walk opened on
 * this body's line (`/solar_walk?focus=<id>`); only for the bodies the walk
 * has (the Sun, the planets, their big moons).
 */
const WalkLink = ({ bodyId }: { bodyId: string }) => {
	const { t } = useI18n()
	if (!isWalkFocusId(bodyId)) return null
	return (
		<Anchor
			className={classes.walk}
			size="sm"
			data-testid="card-walk"
			renderRoot={(props) => (
				<Link {...props} to="/solar_walk" search={{ focus: bodyId }} />
			)}
		>
			<IconWalk size={16} aria-hidden className={classes.walkIcon} />
			<span>{t("solarSystem.card.walk", { bodyId })}</span>
		</Anchor>
	)
}

const ClickHint = () => {
	const { t } = useI18n()
	return (
		<p className={classes.hint} data-testid="click-hint">
			<IconHandClick size={18} aria-hidden="true" />
			{t("solarSystem.pick.hint")}
		</p>
	)
}

const BodyCard = ({ bodyId }: { bodyId: string }) => {
	const i18n = useI18n()
	const { t } = i18n
	const text = useBodyText(bodyId)
	const body = bodyById.get(bodyId)
	const facts = useMemo(
		() => (body === undefined ? [] : headlineFacts(body, i18n)),
		[body, i18n],
	)
	// starts small (#42): name and one sentence; the viewer's choice holds from body to body
	const open = useHudStore((state) => state.cardExpanded)
	const setExpanded = useHudStore((state) => state.setCardExpanded)
	if (body === undefined) return null
	const entry = dictionaryEntry(body.id)
	const story = text.comparisons[0]
	const close = t("solarSystem.card.close")
	// the camera stays: the selection goes and the focused body's card stays closed
	const onClose = () => {
		const sim = useSimStore.getState()
		sim.select(null)
		const { view } = useSimStore.getState()
		useHudStore
			.getState()
			.setCardClosedFor(view.kind === "body" ? view.id : null)
	}
	const toggle = t(
		open ? "solarSystem.card.hideFacts" : "solarSystem.card.showFacts",
	)

	return (
		<section
			className={classes.root}
			aria-label={t("solarSystem.info.label")}
			data-testid="body-card"
			data-card-body={body.id}
		>
			<header className={classes.header}>
				<div className={classes.title}>
					<h2 className={classes.name}>{text.name}</h2>
					<p className={classes.tagline}>{text.tagline}</p>
				</div>
				<CompareButton bodyId={body.id} />
				<ActionIcon
					className={classes.toggle}
					variant="subtle"
					color="gray"
					size="lg"
					aria-label={toggle}
					aria-expanded={open}
					title={toggle}
					data-testid="card-toggle"
					onClick={() => setExpanded(!open)}
				>
					{open ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
				</ActionIcon>
				<CloseButton
					size="lg"
					aria-label={close}
					title={close}
					data-testid="card-close"
					onClick={onClose}
				/>
			</header>
			{open && (
				<div className={classes.details} data-card-details>
					{story !== undefined && (
						<>
							<p className={classes.story}>{story}</p>
							<WalkLink bodyId={body.id} />
						</>
					)}
					<BodyRecording bodyId={body.id} />
					<MoonSystem body={body} />
					<dl className={classes.facts}>
						{facts.map((fact) => (
							<div key={fact.key} className={classes.fact} data-fact={fact.key}>
								<dt className={classes.label}>{fact.label}</dt>
								<dd className={classes.comparison}>
									{fact.comparison}
									{fact.value !== null && (
										<span className={classes.value}>{fact.value}</span>
									)}
								</dd>
							</div>
						))}
					</dl>
					<SmallBodyNotes body={body} />
					{entry !== null && (
						<Anchor
							className={classes.more}
							size="sm"
							renderRoot={(props) => (
								<Link
									{...props}
									to="/solar_dictionary"
									search={{ entity: entry === 0 ? undefined : entry }}
								/>
							)}
						>
							{t("solarSystem.card.dictionary")} →
						</Anchor>
					)}
					<WorldSurfaceNote body={body} />
				</div>
			)}
		</section>
	)
}

/**
 * The card of the selected or focused body, else the click hint; nothing while
 * the viewer has closed the focused body's card and selected nothing since.
 */
const BodyInfo = () => {
	const bodyId = useSimStore(cardBodyId)
	const selectedId = useSimStore((state) => state.selectedId)
	const closedFor = useHudStore((state) => state.cardClosedFor)
	const closed =
		closedFor !== null && closedFor === bodyId && selectedId === null
	// another body, or this one clicked again, brings the card back
	useEffect(() => {
		if (closedFor !== null && !closed)
			useHudStore.getState().setCardClosedFor(null)
	}, [closedFor, closed])
	if (closed) return null
	return bodyId === null ? (
		<>
			<ClickHint />
			<SmallBodiesLegend />
		</>
	) : (
		<BodyCard key={bodyId} bodyId={bodyId} />
	)
}

export default BodyInfo
