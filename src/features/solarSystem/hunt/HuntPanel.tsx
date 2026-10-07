import { useEffect, useMemo, useState } from "react"
import {
	ActionIcon,
	Badge,
	Button,
	Checkbox,
	CloseButton,
	CopyButton,
	Group,
	Popover,
	SegmentedControl,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
	UnstyledButton,
} from "@mantine/core"
import { useRouter } from "@tanstack/react-router"
import {
	IconArrowRight,
	IconBulb,
	IconCertificate,
	IconCheck,
	IconChevronDown,
	IconChevronUp,
	IconConfetti,
	IconCopy,
	IconEye,
	IconMapSearch,
	IconPlayerStopFilled,
	IconRefresh,
	IconShare,
	IconStar,
	IconStarFilled,
	IconVolume,
} from "@tabler/icons-react"

import { useI18n } from "@/i18n"
import { useBodyName } from "@/i18n/bodies"
import { Hint } from "@/primitives/hint"
import { useHuntStore } from "@/store/hunt"
import { useSimStore } from "@/store/sim"

import { takePostcard } from "../postcard/take"
import BodyPicture from "../ui/BodyPicture"
import {
	DEFAULT_DIFFICULTY,
	DIFFICULTIES,
	QUESTIONS,
	customHuntKey,
	huntsOf,
	isEasy,
	resolveHunt,
	type Difficulty,
	type Hunt,
	type HuntQuestion,
	type ResolvedHunt,
} from "./hunts"
import { certificate } from "./certificate"
import {
	askForVoice,
	speak,
	speakOnRequest,
	stopSpeaking,
	useSpoken,
	useVoice,
} from "./speech"
import { huntSpot, spotKindFor, spotSeed } from "./spot"
import { goToStart } from "./startView"
import { arrivalText, huntTitle, questionText, spokenClue } from "./text"
import { showAnswer, watchAnswers } from "./watch"

import hudClasses from "../SolarSystem.module.css"
import classes from "./Hunt.module.css"

const BADGE_COLOR: Readonly<Record<Difficulty, string>> = {
	easy: "teal",
	medium: "orange",
	hard: "grape",
}

/** The link that opens `key` for everyone, in the teacher's language and reading level. */
function useShareUrl(key: string): string {
	const router = useRouter()
	return useMemo(() => {
		const location = router.buildLocation({
			to: "/solar_system",
			search: { hunt: key } as never,
		})
		return new URL(location.publicHref, window.location.origin).toString()
	}, [router, key])
}

const ShareButton = ({ huntKey }: { huntKey: string }) => {
	const { t } = useI18n()
	const url = useShareUrl(huntKey)
	return (
		<Popover width={320} position="bottom-end" withArrow shadow="md">
			<Popover.Target>
				<Button
					variant="subtle"
					color="gray"
					size="compact-sm"
					className={classes.share}
					leftSection={<IconShare size={14} />}
				>
					{t("solarSystem.hunt.share.button")}
				</Button>
			</Popover.Target>
			<Popover.Dropdown>
				<Stack gap="xs">
					<Text fw={600} size="sm">
						{t("solarSystem.hunt.share.title")}
					</Text>
					<Text size="xs" c="dimmed">
						{t("solarSystem.hunt.share.text")}
					</Text>
					<TextInput
						readOnly
						value={url}
						aria-label={t("solarSystem.hunt.share.link")}
						onFocus={(event) => event.currentTarget.select()}
						data-testid="hunt-share-url"
					/>
					<CopyButton value={url}>
						{({ copied, copy }) => (
							<Button
								color={copied ? "teal" : "orange"}
								size="compact-sm"
								leftSection={
									copied ? <IconCheck size={14} /> : <IconCopy size={14} />
								}
								onClick={copy}
							>
								{copied
									? t("solarSystem.hunt.share.copied")
									: t("solarSystem.hunt.share.copy")}
							</Button>
						)}
					</CopyButton>
				</Stack>
			</Popover.Dropdown>
		</Popover>
	)
}

/**
 * The speaker beside a text (#52): reads it aloud in the language on screen,
 * or stops it while it is being read. Hidden when the browser has no voice
 * for the language.
 */
const ReadAloud = ({
	text,
	size = "lg",
}: {
	text: string
	size?: "md" | "lg" | "xl"
}) => {
	const { t, locale } = useI18n()
	const voice = useVoice(locale)
	const reading = useSpoken() === text
	if (voice === null) return null
	return (
		<Hint text={t("solarSystem.hunt.hint.readAloud")}>
			<ActionIcon
				variant={reading ? "filled" : "light"}
				color="orange"
				size={size}
				radius="xl"
				className={classes.speaker}
				aria-label={
					reading
						? t("solarSystem.hunt.stopReading")
						: t("solarSystem.hunt.readAloud")
				}
				aria-pressed={reading}
				onClick={() => (reading ? stopSpeaking() : speakOnRequest(text, voice))}
				data-testid="hunt-read"
			>
				{reading ? (
					<IconPlayerStopFilled size={16} />
				) : (
					<IconVolume size={18} />
				)}
			</ActionIcon>
		</Hint>
	)
}

/** Reads `text` aloud when it appears, while sound is on (Easy, #52). */
function useReadOut(text: string | null): void {
	const { locale } = useI18n()
	const voice = useVoice(locale)
	useEffect(() => {
		if (text !== null && voice !== null) speak(text, voice)
	}, [text, voice])
}

/** One star per clue: earned (filled), the current one (ringed), still to come. */
const ProgressStars = ({
	total,
	solved,
	current,
	large,
}: {
	total: number
	solved: number
	current: number
	large: boolean
}) => {
	const { t } = useI18n()
	return (
		<div
			className={classes.stars}
			data-large={large || undefined}
			role="img"
			aria-label={t("solarSystem.hunt.progressLabel", { found: solved, total })}
			data-testid="hunt-stars"
		>
			{Array.from({ length: total }, (_, index) => {
				const state =
					index < solved ? "found" : index === current ? "current" : "todo"
				return (
					<span key={index} className={classes.star} data-state={state}>
						{state === "found" ? <IconStarFilled /> : <IconStar />}
					</span>
				)
			})}
		</div>
	)
}

/** A ring of sparks bursting out once (none with reduced motion). */
const Burst = () => (
	<div className={classes.burst} aria-hidden="true">
		{Array.from({ length: 12 }, (_, index) => (
			<span
				key={index}
				className={classes.spark}
				style={{ "--angle": `${index * 30}deg` } as React.CSSProperties}
			/>
		))}
	</div>
)

/**
 * Opens a hunt from a click: starts it, or carries on with the one in
 * progress (`resume`). An Easy clue asks for the voice (sound on, unless the
 * viewer turned it off in this visit), so it is read out at once; the click
 * makes that allowed.
 */
function useOpenHunt(): (key: string, resume?: boolean) => void {
	const { locale } = useI18n()
	const voice = useVoice(locale)
	return (key, resume = false) => {
		const store = useHuntStore.getState()
		const step = resume && store.key === key ? store.step : 0
		const question = resolveHunt(key)?.questions[step]
		if (voice !== null && question !== undefined && isEasy(question)) {
			askForVoice()
		}
		if (resume) store.resume(key)
		else store.start(key)
	}
}

/** A ready-made hunt, as a card in the chooser. */
const HuntCard = ({
	hunt,
	difficulty,
}: {
	hunt: Hunt
	difficulty: Difficulty
}) => {
	const i18n = useI18n()
	const { t } = i18n
	const { title, description } = huntTitle(hunt.id, i18n)
	const key = useHuntStore((state) => state.key)
	const step = useHuntStore((state) => state.step)
	const open = useOpenHunt()
	const total = hunt.questions.length
	const inProgress = key === hunt.id && step > 0 && step < total
	const pictures = resolveHunt(hunt.id)?.questions.flatMap(
		(question) => question.picture ?? [],
	)
	return (
		<UnstyledButton
			className={classes.card}
			onClick={() => open(hunt.id, inProgress)}
			data-hunt={hunt.id}
		>
			<Group gap="xs" justify="space-between" wrap="nowrap">
				<Text fw={700}>{title}</Text>
				<Badge
					className={classes.badge}
					variant="light"
					color={BADGE_COLOR[difficulty]}
				>
					{t(`solarSystem.hunt.difficulty.${difficulty}`)}
				</Badge>
			</Group>
			{difficulty === "easy" && pictures !== undefined && (
				<div className={classes.cardPictures}>
					{pictures.map((id) => (
						<BodyPicture key={id} id={id} />
					))}
				</div>
			)}
			<Text size="sm" c="dimmed">
				{description}
			</Text>
			<Text size="xs" c="orange.4" fw={600}>
				{inProgress
					? t("solarSystem.hunt.inProgress", { step: step + 1, total })
					: t("solarSystem.hunt.clueCount", { count: total })}
			</Text>
		</UnstyledButton>
	)
}

/**
 * A teacher's own hunt: tick clues from the whole bank, grouped by
 * difficulty (a hunt may mix them; each clue keeps its own), then start it
 * (and share its link).
 */
const CustomHunt = () => {
	const i18n = useI18n()
	const { t } = i18n
	const open = useOpenHunt()
	const [picked, setPicked] = useState<string[]>([])
	return (
		<details className={classes.custom}>
			<summary className={classes.customSummary}>
				{t("solarSystem.hunt.custom.title")}
			</summary>
			<Stack gap="xs" mt="xs">
				<Text size="sm" c="dimmed">
					{t("solarSystem.hunt.custom.intro")}
				</Text>
				<Checkbox.Group value={picked} onChange={setPicked}>
					<Stack gap="sm">
						{DIFFICULTIES.map((difficulty) => (
							<Stack key={difficulty} gap={6}>
								<Text size="xs" fw={700} tt="uppercase" c="dimmed">
									{t(`solarSystem.hunt.difficulty.${difficulty}`)} ·{" "}
									{t(`solarSystem.hunt.ages.${difficulty}`)}
								</Text>
								{QUESTIONS.filter(
									(question) => question.difficulty === difficulty,
								).map((question) => (
									<Checkbox
										key={question.id}
										value={question.id}
										color="orange"
										label={questionText(question.id, i18n).clue}
									/>
								))}
							</Stack>
						))}
					</Stack>
				</Checkbox.Group>
				<Group justify="space-between">
					<Text size="sm">
						{t("solarSystem.hunt.custom.count", { count: picked.length })}
					</Text>
					<Button
						color="orange"
						size="compact-sm"
						disabled={picked.length === 0}
						onClick={() => open(customHuntKey(picked))}
					>
						{t("solarSystem.hunt.custom.start")}
					</Button>
				</Group>
			</Stack>
		</details>
	)
}

/** The difficulty as a real choice (#52): it filters the hunts; the default follows the reading level. */
const DifficultyChoice = ({ value }: { value: Difficulty }) => {
	const { t } = useI18n()
	const setDifficulty = useHuntStore((state) => state.setDifficulty)
	return (
		<Hint
			options={{
				easy: t("solarSystem.hunt.hint.easy"),
				medium: t("solarSystem.hunt.hint.medium"),
				hard: t("solarSystem.hunt.hint.hard"),
			}}
		>
			<SegmentedControl
				fullWidth
				radius="md"
				color="orange"
				aria-label={t("solarSystem.hunt.difficultyLabel")}
				value={value}
				onChange={(next) => {
					const difficulty = DIFFICULTIES.find((d) => d === next)
					if (difficulty !== undefined) setDifficulty(difficulty)
				}}
				data={DIFFICULTIES.map((difficulty) => ({
					value: difficulty,
					label: (
						<span className={classes.level}>
							<span>{t(`solarSystem.hunt.difficulty.${difficulty}`)}</span>
							<span className={classes.ages}>
								{t(`solarSystem.hunt.ages.${difficulty}`)}
							</span>
						</span>
					),
				}))}
				data-testid="hunt-difficulty"
			/>
		</Hint>
	)
}

const Chooser = () => {
	const { t, readingLevel, locale } = useI18n()
	const chosen = useHuntStore((state) => state.difficulty)
	const difficulty = chosen ?? DEFAULT_DIFFICULTY[readingLevel]
	const voice = useVoice(locale)
	const hunts = huntsOf(difficulty)
	return (
		<Stack gap="sm">
			<Text size="sm">{t("solarSystem.hunt.intro")}</Text>
			<DifficultyChoice value={difficulty} />
			{difficulty === "easy" && (
				<Text size="sm" c="teal.3" data-testid="hunt-easy-note">
					{voice === null
						? t("solarSystem.hunt.easyNote")
						: t("solarSystem.hunt.easyNoteVoice")}
				</Text>
			)}
			<Text fw={700} size="sm" tt="uppercase" c="dimmed">
				{t("solarSystem.hunt.choose")}
			</Text>
			<Stack gap="xs">
				{hunts.map((hunt) => (
					<HuntCard key={hunt.id} hunt={hunt} difficulty={difficulty} />
				))}
				{hunts.length === 0 && (
					<Text size="sm" c="dimmed">
						{t("solarSystem.hunt.none")}
					</Text>
				)}
			</Stack>
			<CustomHunt />
		</Stack>
	)
}

/**
 * The clue being asked: its words (and at Easy its picture and voice),
 * escalating hints, kind words on a miss, "Show me" last. An Easy clue is
 * asked from where it can be answered by looking (./startView.ts), and its
 * first two hints show: the area of the sky, then the answer pulsing.
 */
const Asking = ({ question }: { question: HuntQuestion }) => {
	const i18n = useI18n()
	const { t } = i18n
	const name = useBodyName()
	const words = questionText(question.id, i18n)
	const easy = isEasy(question)
	const arrival = arrivalText(question, i18n)
	const hints = useHuntStore((state) => state.hints)
	const guess = useHuntStore((state) => state.guess)
	const collapsed = useHuntStore((state) => state.collapsed)
	const hint = useHuntStore((state) => state.hint)
	const { locale } = i18n
	const voice = useVoice(locale)

	useEffect(() => watchAnswers(question), [question])
	// Easy: to where the clue can be answered by looking, once per clue
	useEffect(() => {
		if (easy) goToStart(question)
	}, [easy, question])
	useReadOut(easy ? spokenClue(question, i18n) : null)
	// Easy: the hints shown so far light up the sky
	useEffect(() => {
		const kind = easy ? spotKindFor(hints) : null
		huntSpot.target =
			kind === null
				? null
				: { bodyId: question.answers[0], kind, seed: spotSeed(question.id) }
		return () => {
			huntSpot.target = null
		}
	}, [easy, hints, question])

	const shown = words.hints.slice(0, hints)
	const nextHint = () => {
		hint(words.hints.length)
		const text = words.hints[hints]
		if (easy && voice !== null && text !== undefined) speak(text, voice)
	}
	const guessText =
		guess === null
			? null
			: guess.kind === "almost"
				? t("solarSystem.hunt.guess.almost", {
						name: name(guess.bodyId),
						frameId: question.frame ?? "",
						frame: name(question.frame ?? ""),
					})
				: t(`solarSystem.hunt.guess.${guess.kind}`, {
						bodyId: guess.bodyId,
						name: name(guess.bodyId),
					})

	return (
		<Stack gap="sm">
			<div className={classes.clueRow} data-easy={easy || undefined}>
				{question.picture !== undefined && (
					<BodyPicture
						id={question.picture}
						className={classes.cluePicture}
						size={collapsed ? "2.75rem" : "4.25rem"}
					/>
				)}
				<div className={classes.clueWords}>
					{arrival !== null && (
						<Text size="sm" fw={600} c="orange.3" data-testid="hunt-arrival">
							{arrival}
						</Text>
					)}
					<p className={classes.clue} data-testid="hunt-clue">
						{words.clue}
					</p>
				</div>
				<ReadAloud text={spokenClue(question, i18n)} />
			</div>
			{!collapsed && (
				<>
					<Text size="sm" c="dimmed">
						{t("solarSystem.hunt.answerHow")}
					</Text>
					{shown.length > 0 && (
						<ol className={classes.hints}>
							{shown.map((text, index) => (
								<li key={index} className={classes.hintItem}>
									<IconBulb size={16} className={classes.hintIcon} />
									<span className={classes.hintText}>
										<span className={classes.hintLabel}>
											{t("solarSystem.hunt.hintLabel", { n: index + 1 })}
										</span>{" "}
										{text}
									</span>
									<ReadAloud text={text} size="md" />
								</li>
							))}
						</ol>
					)}
					<Group gap="xs">
						{hints < words.hints.length ? (
							<Button
								variant="light"
								color="yellow"
								size={easy ? "sm" : "compact-sm"}
								leftSection={<IconBulb size={14} />}
								onClick={nextHint}
							>
								{hints === 0
									? t("solarSystem.hunt.firstHint")
									: t("solarSystem.hunt.moreHint")}
							</Button>
						) : (
							<Tooltip label={t("solarSystem.hunt.showMeHint")} openDelay={400}>
								<Button
									variant="light"
									color="yellow"
									size={easy ? "sm" : "compact-sm"}
									leftSection={<IconEye size={14} />}
									onClick={() => showAnswer(question)}
								>
									{t("solarSystem.hunt.showMe")}
								</Button>
							</Tooltip>
						)}
					</Group>
				</>
			)}
			<div aria-live="polite" className={classes.guess}>
				{guessText !== null && (
					<Text size="sm" c={guess?.kind === "other" ? "gray.4" : "yellow.3"}>
						{guessText}
					</Text>
				)}
			</div>
		</Stack>
	)
}

/**
 * Just solved: a star, a little celebration (a sticker of the world at
 * Easy), what the class found and learned, then on to the next clue.
 */
const Found = ({
	question,
	last,
}: {
	question: HuntQuestion
	last: boolean
}) => {
	const i18n = useI18n()
	const { t } = i18n
	const next = useHuntStore((state) => state.next)
	const collapsed = useHuntStore((state) => state.collapsed)
	const bodyId = useHuntStore((state) => state.found.at(-1) ?? null)
	const words = questionText(question.id, i18n)
	const easy = isEasy(question)
	useReadOut(easy ? words.found : null)
	return (
		<Stack gap="sm" aria-live="polite" data-testid="hunt-found">
			<div className={classes.foundTitle}>
				<span className={classes.earned}>
					<IconStarFilled size={26} className={classes.earnedStar} />
					<Burst />
				</span>
				<Text fw={800} size="lg" c="orange.4">
					{t("solarSystem.hunt.found")}
				</Text>
			</div>
			{easy && bodyId !== null && !collapsed && (
				<div className={classes.sticker} data-testid="hunt-sticker">
					<BodyPicture id={bodyId} size="4.5rem" />
					<Text fw={700} c="yellow.3">
						{t("solarSystem.hunt.star")}
					</Text>
				</div>
			)}
			{!collapsed && (
				<Group gap="xs" wrap="nowrap" align="flex-start">
					<Text className={classes.foundText} data-easy={easy || undefined}>
						{words.found}
					</Text>
					<ReadAloud text={words.found} size="md" />
				</Group>
			)}
			<Group>
				<Button
					color="orange"
					size={easy ? "md" : "sm"}
					rightSection={<IconArrowRight size={16} />}
					onClick={next}
					data-autofocus
				>
					{last ? t("solarSystem.hunt.finish") : t("solarSystem.hunt.next")}
				</Button>
			</Group>
		</Stack>
	)
}

/** Every clue solved: a celebration, a star per clue, the worlds found, a certificate and what next. */
const Done = ({ hunt }: { hunt: ResolvedHunt }) => {
	const i18n = useI18n()
	const { t } = i18n
	const name = useBodyName()
	const found = useHuntStore((state) => state.found)
	const browse = useHuntStore((state) => state.browse)
	const open = useOpenHunt()
	const setFocus = useSimStore((state) => state.setFocus)
	const worlds = [...new Set(found)]
	const total = hunt.questions.length
	const easy = hunt.questions.some(isEasy)
	const words = `${t("solarSystem.hunt.done.title")} ${t("solarSystem.hunt.done.text", { count: total })}`
	useReadOut(easy ? words : null)
	return (
		<Stack gap="sm" className={classes.done} data-testid="hunt-done">
			<div className={classes.celebrate} aria-hidden="true">
				<IconConfetti size={48} stroke={1.5} />
				<Burst />
			</div>
			<Title order={3} className={classes.doneTitle}>
				{t("solarSystem.hunt.done.title")}
			</Title>
			<Group gap="xs" justify="center" wrap="nowrap">
				<Text>{t("solarSystem.hunt.done.text", { count: total })}</Text>
				<ReadAloud text={words} size="md" />
			</Group>
			<div
				className={classes.doneStars}
				role="img"
				aria-label={t("solarSystem.hunt.done.stars", { count: total })}
			>
				{Array.from({ length: total }, (_, index) => (
					<IconStarFilled key={index} className={classes.doneStar} />
				))}
			</div>
			<Text size="sm" c="dimmed">
				{t("solarSystem.hunt.done.found")}
			</Text>
			<Group gap={6} justify="center">
				{worlds.map((id) => (
					<Button
						key={id}
						variant="light"
						color="gray"
						size="compact-sm"
						leftSection={<BodyPicture id={id} size="1.1rem" />}
						onClick={() => setFocus(id)}
					>
						{name(id)}
					</Button>
				))}
			</Group>
			<Hint text={t("solarSystem.hunt.hint.certificate")}>
				<Button
					color="yellow"
					variant="light"
					mt="xs"
					leftSection={<IconCertificate size={18} />}
					aria-haspopup="dialog"
					onClick={() => takePostcard(certificate(hunt, found, i18n, name))}
					data-testid="hunt-certificate"
				>
					{t("solarSystem.hunt.done.certificate")}
				</Button>
			</Hint>
			<Group gap="xs" justify="center">
				<Button
					color="orange"
					leftSection={<IconRefresh size={16} />}
					onClick={() => open(hunt.key)}
				>
					{t("solarSystem.hunt.done.again")}
				</Button>
				<Button variant="light" color="orange" onClick={browse}>
					{t("solarSystem.hunt.done.other")}
				</Button>
			</Group>
		</Stack>
	)
}

const Play = ({ hunt }: { hunt: ResolvedHunt }) => {
	const step = useHuntStore((state) => state.step)
	const phase = useHuntStore((state) => state.phase)
	const setAssist = useHuntStore((state) => state.setAssist)
	const total = hunt.questions.length
	const question = step < total ? hunt.questions[step] : null
	const easy = question !== null && isEasy(question)

	// an Easy clue on screen: pictures beside the names, forgiving clicks
	useEffect(() => {
		setAssist(easy)
		return () => setAssist(false)
	}, [easy, setAssist])
	// a new clue, a find or the end: whatever was being read stops
	useEffect(() => () => stopSpeaking(), [step, phase])

	if (question === null) return <Done hunt={hunt} />
	return phase === "found" ? (
		<Found question={question} last={step === total - 1} />
	) : (
		<Asking question={question} />
	)
}

/**
 * The scavenger hunt (#34), docked at the right like the birthday panel so the
 * scene stays in view: the chooser, or the hunt being played with its
 * progress, the clue, hints and what was found. It folds up to the clue alone
 * for a phone or a crowded projector.
 */
const HuntPanel = () => {
	const i18n = useI18n()
	const { t } = i18n
	const key = useHuntStore((state) => (state.choosing ? null : state.key))
	const step = useHuntStore((state) => state.step)
	const phase = useHuntStore((state) => state.phase)
	const collapsed = useHuntStore((state) => state.collapsed)
	const setCollapsed = useHuntStore((state) => state.setCollapsed)
	const setOpen = useHuntStore((state) => state.setOpen)
	const browse = useHuntStore((state) => state.browse)
	const hunt = useMemo(() => resolveHunt(key), [key])

	// closing the panel or leaving the page stops the voice
	useEffect(() => () => stopSpeaking(), [])

	const title =
		hunt === null
			? t("solarSystem.hunt.title")
			: hunt.id === null
				? t("solarSystem.hunt.custom.name")
				: huntTitle(hunt.id, i18n).title
	const total = hunt?.questions.length ?? 0
	const solved = Math.min(total, step + (phase === "found" ? 1 : 0))
	const easy =
		hunt?.questions[step] !== undefined && isEasy(hunt.questions[step])

	return (
		<section
			id="hunt-panel"
			className={`${hudClasses.panel} ${classes.panel}`}
			aria-labelledby="hunt-title"
			data-collapsed={collapsed || undefined}
			data-easy={easy || undefined}
		>
			<header className={classes.header}>
				<Group gap="xs" wrap="nowrap" justify="space-between">
					<Group gap={8} wrap="nowrap" miw={0}>
						<IconMapSearch size={20} className={classes.headerIcon} />
						<Title order={2} id="hunt-title" className={classes.title}>
							{title}
						</Title>
					</Group>
					<Group gap={2} wrap="nowrap">
						{hunt !== null && (
							<ActionIcon
								variant="subtle"
								color="gray"
								onClick={() => setCollapsed(!collapsed)}
								aria-label={
									collapsed
										? t("solarSystem.hunt.expand")
										: t("solarSystem.hunt.collapse")
								}
								aria-expanded={!collapsed}
							>
								{collapsed ? (
									<IconChevronDown size={18} />
								) : (
									<IconChevronUp size={18} />
								)}
							</ActionIcon>
						)}
						<CloseButton
							onClick={() => setOpen(false)}
							aria-label={t("solarSystem.hunt.close")}
						/>
					</Group>
				</Group>
				{hunt !== null && step < total && (
					<>
						<Group gap="xs" justify="space-between" wrap="nowrap" mt={4}>
							<Text
								size="sm"
								fw={600}
								className={classes.progress}
								data-testid="hunt-progress"
							>
								{t("solarSystem.hunt.progress", {
									step: step + 1,
									total,
								})}
							</Text>
							{!collapsed && <ShareButton huntKey={hunt.key} />}
						</Group>
						<ProgressStars
							total={total}
							solved={solved}
							current={step}
							large={easy}
						/>
					</>
				)}
			</header>
			<div className={classes.body}>
				{hunt === null ? <Chooser /> : <Play hunt={hunt} />}
				{hunt !== null && !collapsed && step < total && (
					<Button
						variant="subtle"
						color="gray"
						size="compact-xs"
						mt="md"
						onClick={browse}
					>
						{t("solarSystem.hunt.otherHunts")}
					</Button>
				)}
			</div>
		</section>
	)
}

export default HuntPanel
