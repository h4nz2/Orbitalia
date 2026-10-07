/**
 * The help page (#43): every feature of the app, grouped the way people think
 * (looking around, time, size and distance, light, comparing, teachers,
 * games), each with what it is, why it is worth using, how to use it and a
 * "try it" link that opens the app with the feature ready; then the controls
 * and shortcuts, what Orbitalia is (#45: what the start page used to say), and
 * the credits with their licences.
 *
 * Content is data (`src/data/help.json` + `src/locales/<locale>/help.json`,
 * see content.ts): adding a feature's entry needs no code. `?q=` is the
 * search, `?topic=` scrolls to an entry, a group, `controls`, `about` or
 * `credits`.
 */
import { useEffect, useMemo, useState, type MouseEvent } from "react"
import {
	Button,
	CloseButton,
	Kbd,
	Table,
	Text,
	TextInput,
	Title,
} from "@mantine/core"
import {
	IconArrowLeft,
	IconArrowRight,
	IconExternalLink,
	IconSearch,
} from "@tabler/icons-react"
import { Link, getRouteApi, useRouter } from "@tanstack/react-router"

import { useBackToSolarSystem } from "@/hooks/useBackToSolarSystem"
import { useI18n, type I18n } from "@/i18n"

import {
	CREDIT_SECTIONS,
	HELP_CONTROLS,
	controlText,
	creditRows,
	creditSectionText,
	entryText,
	groupText,
	helpFile,
	matchesQuery,
	queryWords,
	searchEntries,
	type HelpEntry,
	type HelpGroupId,
} from "./content"
import { CornerBar } from "./HelpButton"
import { parseTryLink } from "./links"

import classes from "./Help.module.css"

const route = getRouteApi("/help")

/** DOM id of a topic (an entry, a group, `controls`, `about`, `credits`). */
const anchorId = (topic: string) => `help-${topic}`

/** How long the search waits for the typing to pause before it writes `?q=`, ms. */
const QUERY_WRITE_MS = 250

/** How long after opening `?topic=` the page keeps landing on it while the router settles, ms. */
const TOPIC_SETTLE_MS = 3000

function scrollToTopic(topic: string, smooth: boolean): boolean {
	const target = document.getElementById(anchorId(topic))
	if (target === null) return false
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
	target.scrollIntoView({
		behavior: smooth && !reduced ? "smooth" : "auto",
		block: "start",
	})
	target.focus({ preventScroll: true })
	return true
}

function EntryCard({
	entry,
	i18n,
	highlighted,
}: {
	entry: HelpEntry
	i18n: I18n
	highlighted: boolean
}) {
	const { t } = i18n
	const text = entryText(entry.id, i18n)
	const link = parseTryLink(entry.try)
	return (
		<article
			id={anchorId(entry.id)}
			className={classes.entry}
			data-entry={entry.id}
			data-highlight={highlighted || undefined}
			tabIndex={-1}
			aria-labelledby={`${anchorId(entry.id)}-title`}
		>
			<h3 id={`${anchorId(entry.id)}-title`} className={classes.entryTitle}>
				{text.title}
			</h3>
			<p className={classes.what}>{text.what}</p>
			<p className={classes.why}>
				<span className={classes.label}>{t("help.why")}</span> {text.why}
			</p>
			<div className={classes.how}>
				<span className={classes.label}>{t("help.how")}</span>
				<ol className={classes.steps}>
					{text.how.map((step) => (
						<li key={step}>{step}</li>
					))}
				</ol>
			</div>
			{link !== null && (
				<Button
					component={Link}
					to={link.to}
					search={link.search as never}
					className={classes.try}
					variant="light"
					color="orange"
					rightSection={<IconArrowRight size={16} aria-hidden />}
					aria-label={t("help.tryLabel", { title: text.title })}
					data-try={entry.id}
				>
					{t("help.try")}
				</Button>
			)}
		</article>
	)
}

function ControlsTable({ i18n, words }: { i18n: I18n; words: string[] }) {
	const { t } = i18n
	const rows = HELP_CONTROLS.map((id) => ({
		id,
		...controlText(id, i18n),
	})).filter((row) =>
		matchesQuery([row.action, row.mouse, row.touch, row.keys], words),
	)
	if (rows.length === 0) return null
	const none = t("help.controls.none")
	const cell = (label: string, value: string | undefined) => (
		<Table.Td data-label={label} data-empty={value === undefined || undefined}>
			{value ?? none}
		</Table.Td>
	)
	return (
		<section
			id={anchorId("controls")}
			className={classes.section}
			tabIndex={-1}
			aria-labelledby={`${anchorId("controls")}-title`}
		>
			<Title
				order={2}
				id={`${anchorId("controls")}-title`}
				className={classes.groupTitle}
			>
				{t("help.controls.title")}
			</Title>
			<Text className={classes.groupIntro}>{t("help.controls.intro")}</Text>
			<Table className={classes.controls} verticalSpacing="xs" striped>
				<Table.Thead>
					<Table.Tr>
						<Table.Th scope="col">{t("help.controls.action")}</Table.Th>
						<Table.Th scope="col">{t("help.controls.mouse")}</Table.Th>
						<Table.Th scope="col">{t("help.controls.touch")}</Table.Th>
						<Table.Th scope="col">{t("help.controls.keys")}</Table.Th>
					</Table.Tr>
				</Table.Thead>
				<Table.Tbody>
					{rows.map((row) => (
						<Table.Tr key={row.id} data-control={row.id}>
							<Table.Th scope="row" className={classes.action}>
								{row.action}
							</Table.Th>
							{cell(t("help.controls.mouse"), row.mouse)}
							{cell(t("help.controls.touch"), row.touch)}
							<Table.Td
								data-label={t("help.controls.keys")}
								data-empty={row.keys === undefined || undefined}
							>
								{row.keys === undefined ? (
									none
								) : (
									<Kbd className={classes.kbd}>{row.keys}</Kbd>
								)}
							</Table.Td>
						</Table.Tr>
					))}
				</Table.Tbody>
			</Table>
		</section>
	)
}

function About({ i18n }: { i18n: I18n }) {
	const { t } = i18n
	return (
		<section
			id={anchorId("about")}
			className={classes.section}
			tabIndex={-1}
			aria-labelledby={`${anchorId("about")}-title`}
			data-testid="help-about"
		>
			<Title
				order={2}
				id={`${anchorId("about")}-title`}
				className={classes.groupTitle}
			>
				{t("help.about.title")}
			</Title>
			<Text
				component="p"
				variant="gradient"
				gradient={{ from: "yellow", to: "red" }}
				className={classes.tagline}
			>
				{t("help.about.tagline")}
			</Text>
			<Text className={classes.about}>{t("help.about.text")}</Text>
			<Text className={classes.about}>{t("help.about.madeBy")}</Text>
		</section>
	)
}

function Credits({ i18n }: { i18n: I18n }) {
	const { t } = i18n
	return (
		<section
			id={anchorId("credits")}
			className={classes.section}
			tabIndex={-1}
			aria-labelledby={`${anchorId("credits")}-title`}
		>
			<Title
				order={2}
				id={`${anchorId("credits")}-title`}
				className={classes.groupTitle}
			>
				{t("help.credits.title")}
			</Title>
			<div className={classes.creditGrid}>
				{CREDIT_SECTIONS.map((section) => {
					const credits = creditRows(section, i18n)
					if (credits.length === 0) return null
					const text = creditSectionText(section, i18n)
					return (
						<div
							key={section}
							className={classes.creditSection}
							data-credits={section}
						>
							<h3 className={classes.creditTitle}>{text.title}</h3>
							<p className={classes.creditIntro}>{text.intro}</p>
							<ul className={classes.creditList}>
								{credits.map((credit) => (
									<li key={credit.id} data-credit={credit.id}>
										{credit.url === undefined ? (
											<span className={classes.creditName}>{credit.name}</span>
										) : (
											<a
												className={classes.creditName}
												href={credit.url}
												target="_blank"
												rel="noreferrer"
											>
												{credit.name}
												<IconExternalLink size={13} aria-hidden />
											</a>
										)}
										<span className={classes.creditWhat}>{credit.what}</span>
										<span className={classes.licence}>
											{t("help.credits.licence", { licence: credit.licence })}
										</span>
									</li>
								))}
							</ul>
						</div>
					)
				})}
			</div>
		</section>
	)
}

const Help = () => {
	const i18n = useI18n()
	const { t, readingLevel } = i18n
	const search = route.useSearch()
	const navigate = route.useNavigate()
	const router = useRouter()
	const back = useBackToSolarSystem()

	// the box is local state; the URL follows once the typing pauses
	const [draft, setDraft] = useState(search.q ?? "")
	useEffect(() => {
		const next = draft.trim() === "" ? undefined : draft
		if (next === search.q) return
		const timer = setTimeout(
			() =>
				void navigate({
					search: (previous) => ({ ...previous, q: next }),
					replace: true,
					// the reader stays where they are while typing
					resetScroll: false,
				}),
			QUERY_WRITE_MS,
		)
		return () => clearTimeout(timer)
	}, [draft, search.q, navigate])

	const words = useMemo(() => queryWords(draft), [draft])
	const searching = words.length > 0
	const matches = useMemo(
		() => new Set(searchEntries(draft, i18n).map((entry) => entry.id)),
		[draft, i18n],
	)

	// ?topic= scrolls there once, when the page opens
	const [highlight, setHighlight] = useState<string | null>(
		search.topic ?? null,
	)
	useEffect(() => {
		if (search.topic === undefined) return
		const topic = search.topic
		scrollToTopic(topic, false)
		// the router scrolls to the top after rendering a navigation (this one,
		// and the language normalizing the address); land on the topic again
		// after those, for the page's first moments only
		const until = performance.now() + TOPIC_SETTLE_MS
		const unsubscribe = router.subscribe("onRendered", () => {
			if (performance.now() < until) {
				requestAnimationFrame(() => scrollToTopic(topic, false))
			}
		})
		const timer = setTimeout(unsubscribe, TOPIC_SETTLE_MS)
		return () => {
			clearTimeout(timer)
			unsubscribe()
		}
	}, [search.topic, router])

	const groups = helpFile.groups
		.map((group) => ({
			id: group as HelpGroupId,
			entries: helpFile.entries.filter(
				(entry) => entry.group === group && matches.has(entry.id),
			),
		}))
		.filter((group) => group.entries.length > 0)

	const jump = (topic: string) => (event: MouseEvent) => {
		event.preventDefault()
		setHighlight(topic)
		scrollToTopic(topic, true)
	}

	return (
		<main className={classes.page} data-testid="help-page">
			<CornerBar help={false} />
			<header className={classes.header}>
				<Button
					variant="subtle"
					color="gray"
					leftSection={<IconArrowLeft size={18} aria-hidden />}
					onClick={back}
					className={classes.back}
				>
					{t("help.back")}
				</Button>
				<Title order={1} className={classes.title}>
					{t("help.heading")}
				</Title>
				<Text className={classes.lead}>{t("help.lead")}</Text>
				<Text className={classes.reading}>
					{t("help.readingLevel", {
						level: t(`i18n.readingLevel.${readingLevel}.name`),
					})}
				</Text>
				<TextInput
					className={classes.search}
					size="md"
					type="search"
					value={draft}
					onChange={(event) => setDraft(event.currentTarget.value)}
					aria-label={t("help.searchLabel")}
					placeholder={t("help.searchPlaceholder")}
					leftSection={<IconSearch size={18} aria-hidden />}
					rightSection={
						draft === "" ? null : (
							<CloseButton
								aria-label={t("help.clearSearch")}
								onClick={() => setDraft("")}
							/>
						)
					}
				/>
				{searching ? (
					<p
						className={classes.results}
						aria-live="polite"
						data-testid="help-results"
					>
						{t("help.results", { count: matches.size, query: draft.trim() })}
					</p>
				) : (
					<nav className={classes.contents} aria-label={t("help.contents")}>
						{helpFile.groups.map((group) => (
							<a
								key={group}
								href={`#${anchorId(group)}`}
								onClick={jump(group)}
								className={classes.chip}
							>
								{groupText(group, i18n).title}
							</a>
						))}
						<a
							href={`#${anchorId("controls")}`}
							onClick={jump("controls")}
							className={classes.chip}
						>
							{t("help.controls.title")}
						</a>
						<a
							href={`#${anchorId("about")}`}
							onClick={jump("about")}
							className={classes.chip}
						>
							{t("help.about.title")}
						</a>
						<a
							href={`#${anchorId("credits")}`}
							onClick={jump("credits")}
							className={classes.chip}
						>
							{t("help.credits.title")}
						</a>
					</nav>
				)}
			</header>

			{groups.map((group) => {
				const text = groupText(group.id, i18n)
				return (
					<section
						key={group.id}
						id={anchorId(group.id)}
						className={classes.section}
						data-group={group.id}
						tabIndex={-1}
						aria-labelledby={`${anchorId(group.id)}-title`}
					>
						<Title
							order={2}
							id={`${anchorId(group.id)}-title`}
							className={classes.groupTitle}
						>
							{text.title}
						</Title>
						<Text className={classes.groupIntro}>{text.intro}</Text>
						<div className={classes.entries}>
							{group.entries.map((entry) => (
								<EntryCard
									key={entry.id}
									entry={entry}
									i18n={i18n}
									highlighted={highlight === entry.id}
								/>
							))}
						</div>
					</section>
				)
			})}

			<ControlsTable i18n={i18n} words={words} />
			{!searching && <About i18n={i18n} />}
			{!searching && <Credits i18n={i18n} />}
			<footer className={classes.footer}>{t("app.name")}</footer>
		</main>
	)
}

export default Help
