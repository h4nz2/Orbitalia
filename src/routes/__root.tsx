import {
	createRootRoute,
	Link,
	Outlet,
	retainSearchParams,
} from "@tanstack/react-router"
import { Button, Center, Stack, Text, Title } from "@mantine/core"

import {
	I18N_SEARCH_KEYS,
	i18nSearchSchema,
	useI18n,
	type I18nSearch,
} from "@/i18n"
import { CornerBar } from "@/features/help/HelpButton"
import Providers from "@/providers"

function RootLayout() {
	return (
		<Providers>
			<Outlet />
		</Providers>
	)
}

// Rendered in place of <Outlet /> for unknown URLs, so it keeps the providers and layout.
function NotFound() {
	const { t } = useI18n()
	return (
		<Center h="100vh">
			<CornerBar />
			<Stack align="center" gap="md">
				<Title order={1}>{t("notFound.title")}</Title>
				<Text c="dimmed">{t("notFound.text")}</Text>
				<Button
					component={Link}
					to="/solar_system"
					variant="gradient"
					gradient={{ from: "yellow", to: "red" }}
				>
					{t("notFound.back")}
				</Button>
			</Stack>
		</Center>
	)
}

export const Route = createRootRoute({
	// `?lang=de&reading=simple` on every page (src/i18n/search.ts); every navigation keeps them
	validateSearch: i18nSearchSchema,
	search: {
		middlewares: [retainSearchParams<I18nSearch>([...I18N_SEARCH_KEYS])],
	},
	component: RootLayout,
	notFoundComponent: NotFound,
})
