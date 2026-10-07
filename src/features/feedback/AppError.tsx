/**
 * What any page shows when it breaks (the router's default error component):
 * a plain apology, a reload, and the way to tell us, with the broken view
 * attached. Plain elements, no Mantine: it may render outside the providers.
 */
import { Link, useLocation } from "@tanstack/react-router"

import { useI18n } from "@/i18n"

import classes from "./AppError.module.css"

export default function AppError() {
	const { t } = useI18n()
	const location = useLocation()
	const from = `${location.pathname}${location.searchStr}`.slice(0, 2000)
	return (
		<main className={classes.page} role="alert" data-testid="app-error">
			<h1 className={classes.title}>{t("error.title")}</h1>
			<p className={classes.text}>{t("error.text")}</p>
			<div className={classes.actions}>
				<button
					type="button"
					className={classes.reload}
					onClick={() => window.location.reload()}
				>
					{t("error.reload")}
				</button>
				<Link
					to="/feedback"
					search={{ kind: "bug", from }}
					className={classes.report}
				>
					{t("error.report")}
				</Link>
			</div>
		</main>
	)
}
