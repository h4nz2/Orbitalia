/**
 * Send feedback: a bug, an idea or anything else, straight to the people who
 * make Orbitalia. The form posts to the Worker (`/api/feedback`, see
 * worker/feedback.ts), which checks Turnstile and mails the inbox; nothing is
 * stored and nothing becomes public. Opened from the Help menu on the scene
 * (with `from`: the view to attach), the help page and the error pages; the
 * other ways to take part (GitHub issues, Discussions, email) are listed below
 * the form for those who prefer them.
 */
import { useState, type FormEvent, type ReactNode } from "react"
import {
	Alert,
	Anchor,
	Button,
	Checkbox,
	SegmentedControl,
	Text,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core"
import { useMediaQuery } from "@mantine/hooks"
import {
	IconArrowLeft,
	IconBrandGithub,
	IconCode,
	IconMail,
	IconMessages,
	IconSend,
} from "@tabler/icons-react"
import { getRouteApi } from "@tanstack/react-router"

import { CornerBar } from "@/features/help/HelpButton"
import { useBackToSolarSystem } from "@/hooks/useBackToSolarSystem"
import { useI18n, type MessageKey } from "@/i18n"

import {
	FEEDBACK_ADDRESS,
	FEEDBACK_KINDS,
	FeedbackRequest,
	MESSAGE_MAX,
	MESSAGE_MIN,
	type FeedbackKind,
	type FeedbackResponse,
} from "./schema"
import Turnstile from "./Turnstile"

import classes from "./Feedback.module.css"

const route = getRouteApi("/feedback")

const REPO = "https://github.com/h4nz2/Orbitalia"
/** The issue form for each kind (`.github/ISSUE_TEMPLATE`). */
const ISSUE_FORMS: Record<FeedbackKind, string> = {
	bug: `${REPO}/issues/new?template=bug.yml`,
	idea: `${REPO}/issues/new?template=idea.yml`,
	other: `${REPO}/issues/new/choose`,
}
const DISCUSSIONS = `${REPO}/discussions`

const PLACEHOLDERS: Record<FeedbackKind, MessageKey> = {
	bug: "feedback.message.placeholderBug",
	idea: "feedback.message.placeholderIdea",
	other: "feedback.message.placeholderOther",
}

type Status =
	| { kind: "editing" }
	| { kind: "sending" }
	| { kind: "sent" }
	| { kind: "failed"; reason: "invalid" | "challenge" | "send" }

/** The Worker's answer, or null when there was none (offline, blocked, not JSON). */
async function post(report: FeedbackRequest): Promise<FeedbackResponse | null> {
	try {
		const response = await fetch(`${import.meta.env.BASE_URL}api/feedback`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(report),
		})
		return (await response.json()) as FeedbackResponse
	} catch {
		return null
	}
}

const Feedback = () => {
	const i18n = useI18n()
	const { t } = i18n
	const search = route.useSearch()
	const back = useBackToSolarSystem()
	// phones: the three kinds stack instead of squeezing their words
	const narrow = useMediaQuery("(max-width: 30em)") ?? false

	const [kind, setKind] = useState<FeedbackKind>(search.kind ?? "bug")
	const [message, setMessage] = useState("")
	const [email, setEmail] = useState("")
	const [attachView, setAttachView] = useState(true)
	const [token, setToken] = useState<string | null>(null)
	// a Turnstile token is good for one try: a new widget after a failure
	const [challenge, setChallenge] = useState(0)
	const [unavailable, setUnavailable] = useState(false)
	const [status, setStatus] = useState<Status>({ kind: "editing" })

	const view = search.from
	const emailInvalid =
		email.trim() !== "" &&
		!FeedbackRequest.shape.email.safeParse(email.trim()).success
	const ready =
		message.trim().length >= MESSAGE_MIN &&
		!emailInvalid &&
		token !== null &&
		status.kind !== "sending"

	const send = async (event: FormEvent) => {
		event.preventDefault()
		if (!ready || token === null) return
		const report: FeedbackRequest = {
			kind,
			message: message.trim(),
			...(email.trim() === "" ? {} : { email: email.trim() }),
			...(view !== undefined && attachView ? { view } : {}),
			context: {
				language: i18n.locale,
				reading: i18n.readingLevel,
				userAgent: navigator.userAgent.slice(0, 500),
				screen: `${window.innerWidth}×${window.innerHeight} @${Math.round(window.devicePixelRatio * 100) / 100}x`,
				version: __APP_VERSION__,
			},
			token,
		}
		setStatus({ kind: "sending" })
		const outcome = await post(report)
		if (outcome?.ok === true) {
			setStatus({ kind: "sent" })
			return
		}
		setToken(null)
		setChallenge((n) => n + 1)
		const reason = outcome?.ok === false ? outcome.error : "send"
		setStatus({
			kind: "failed",
			reason: reason === "invalid" || reason === "challenge" ? reason : "send",
		})
	}

	const again = () => {
		setMessage("")
		setToken(null)
		setChallenge((n) => n + 1)
		setStatus({ kind: "editing" })
	}

	const mail = (
		<Anchor href={`mailto:${FEEDBACK_ADDRESS}`}>{FEEDBACK_ADDRESS}</Anchor>
	)

	return (
		<main className={classes.page} data-testid="feedback-page">
			<CornerBar />
			<header className={classes.header}>
				<Button
					variant="subtle"
					color="gray"
					leftSection={<IconArrowLeft size={18} aria-hidden />}
					onClick={back}
					className={classes.back}
				>
					{t("feedback.back")}
				</Button>
				<Title order={1} className={classes.title}>
					{t("feedback.title")}
				</Title>
				<Text className={classes.lead}>{t("feedback.lead")}</Text>
			</header>

			<section className={classes.card} aria-live="polite">
				{status.kind === "sent" ? (
					<div className={classes.thanks} data-testid="feedback-sent">
						<Title order={2} className={classes.cardTitle}>
							{t("feedback.sentTitle")}
						</Title>
						<Text>{t("feedback.sentText")}</Text>
						<div className={classes.actions}>
							<Button color="orange" onClick={back}>
								{t("feedback.back")}
							</Button>
							<Button variant="subtle" color="gray" onClick={again}>
								{t("feedback.another")}
							</Button>
						</div>
					</div>
				) : (
					<form className={classes.form} onSubmit={send} noValidate>
						<div className={classes.field}>
							<Text
								component="span"
								className={classes.label}
								id="feedback-kind"
							>
								{t("feedback.kindLabel")}
							</Text>
							<SegmentedControl
								aria-labelledby="feedback-kind"
								value={kind}
								onChange={(value) => setKind(value as FeedbackKind)}
								data={FEEDBACK_KINDS.map((value) => ({
									value,
									label: t(`feedback.kind.${value}`),
								}))}
								fullWidth
								orientation={narrow ? "vertical" : "horizontal"}
								data-testid="feedback-kind"
							/>
						</div>
						<Textarea
							label={t("feedback.message.label")}
							placeholder={t(PLACEHOLDERS[kind])}
							value={message}
							onChange={(event) => setMessage(event.currentTarget.value)}
							maxLength={MESSAGE_MAX}
							autosize
							minRows={5}
							maxRows={14}
							required
							description={t("feedback.message.count", {
								count: message.length,
								max: MESSAGE_MAX,
							})}
						/>
						<TextInput
							type="email"
							label={t("feedback.email.label")}
							description={t("feedback.email.description")}
							value={email}
							onChange={(event) => setEmail(event.currentTarget.value)}
							error={emailInvalid ? t("feedback.email.invalid") : undefined}
							autoComplete="email"
						/>
						{view !== undefined && (
							<Checkbox
								checked={attachView}
								onChange={(event) => setAttachView(event.currentTarget.checked)}
								label={t("feedback.view.label")}
								description={
									<>
										{t("feedback.view.description")}{" "}
										<code className={classes.view}>{view}</code>
									</>
								}
							/>
						)}
						<Text className={classes.note}>{t("feedback.whatIsSent")}</Text>

						{unavailable ? (
							<Alert color="yellow" data-testid="feedback-unavailable">
								{t("feedback.unavailable")} {mail}
							</Alert>
						) : (
							<Turnstile
								key={challenge}
								language={i18n.locale}
								onToken={setToken}
								onUnavailable={() => setUnavailable(true)}
							/>
						)}

						{status.kind === "failed" && (
							<Alert color="red" data-testid="feedback-error">
								{t(`feedback.error.${status.reason}`)}
								{status.reason === "send" && <> {mail}</>}
							</Alert>
						)}

						<div className={classes.actions}>
							<Button
								type="submit"
								color="orange"
								disabled={!ready}
								loading={status.kind === "sending"}
								leftSection={<IconSend size={16} aria-hidden />}
							>
								{t("feedback.send")}
							</Button>
						</div>
					</form>
				)}
			</section>

			<section className={classes.other} aria-labelledby="feedback-other">
				<Title order={2} id="feedback-other" className={classes.cardTitle}>
					{t("feedback.other.title")}
				</Title>
				<ul className={classes.ways}>
					<Way
						icon={<IconBrandGithub size={20} aria-hidden />}
						href={ISSUE_FORMS[kind]}
						title={t("feedback.other.issue")}
						text={t("feedback.other.issueText")}
					/>
					<Way
						icon={<IconMessages size={20} aria-hidden />}
						href={DISCUSSIONS}
						title={t("feedback.other.discussions")}
						text={t("feedback.other.discussionsText")}
					/>
					<Way
						icon={<IconMail size={20} aria-hidden />}
						href={`mailto:${FEEDBACK_ADDRESS}`}
						title={t("feedback.other.email")}
						text={FEEDBACK_ADDRESS}
					/>
					<Way
						icon={<IconCode size={20} aria-hidden />}
						href={REPO}
						title={t("feedback.other.code")}
						text={t("feedback.other.codeText")}
					/>
				</ul>
			</section>
		</main>
	)
}

function Way({
	icon,
	href,
	title,
	text,
}: {
	icon: ReactNode
	href: string
	title: string
	text: string
}) {
	const external = href.startsWith("http")
	return (
		<li className={classes.way}>
			<span className={classes.wayIcon}>{icon}</span>
			<span>
				<Anchor
					href={href}
					className={classes.wayTitle}
					{...(external ? { target: "_blank", rel: "noreferrer" } : {})}
				>
					{title}
				</Anchor>
				<Text component="span" className={classes.wayText}>
					{text}
				</Text>
			</span>
		</li>
	)
}

export default Feedback
