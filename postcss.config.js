import { readFileSync } from "node:fs"

// The size classes (#58): `@media $phone` and `@media $touch` in every CSS
// module, from the one definition code reads too (src/utils/sizeClasses.ts).
const sizeClasses = JSON.parse(
	readFileSync(
		new URL("./src/utils/sizeClasses.json", import.meta.url),
		"utf8",
	),
)

export default {
	plugins: {
		"postcss-preset-mantine": {},
		"postcss-simple-vars": {
			variables: {
				"mantine-breakpoint-xs": "36em",
				"mantine-breakpoint-sm": "48em",
				"mantine-breakpoint-md": "62em",
				"mantine-breakpoint-lg": "75em",
				"mantine-breakpoint-xl": "88em",
				phone: sizeClasses.phone,
				touch: sizeClasses.touch,
			},
		},
	},
}
