import * as React from "react"
import {
	createTheme,
	MantineProvider,
	Popover,
	type MantineColorsTuple,
	type PopoverProps,
} from "@mantine/core"

// finger sizes where the primary pointer is a finger (#58)
import "./touch.css"
// every menu and popover fits the screen it opens on (#58)
import "./fit.css"

// Mantine 6's dark palette: the app was designed on it (dark[7] = #1a1b1e is also what
// index.html paints before the CSS loads), while Mantine 9 ships a lighter dark[7] (#242424).
const dark: MantineColorsTuple = [
	"#C1C2C5",
	"#A6A7AB",
	"#909296",
	"#5c5f66",
	"#373A40",
	"#2C2E33",
	"#25262b",
	"#1A1B1E",
	"#141517",
	"#101113",
]

/**
 * Every menu and popover fits the screen it opens on (#58): a phone on its
 * side is 390 px high, so a dropdown taller than the room beside its button
 * scrolls (`fit.css`) instead of running off the screen. Floating UI's
 * `size` measures the room; Mantine's own defaults (flip, shift) stay.
 */
const fitTheScreen: NonNullable<PopoverProps["middlewares"]> = {
	flip: true,
	shift: true,
	inline: false,
	size: {
		padding: 8,
		apply({ availableHeight, elements }) {
			elements.floating.style.setProperty(
				"--dropdown-max-height",
				`${Math.max(0, Math.floor(availableHeight))}px`,
			)
		},
	},
}

export const theme = createTheme({
	primaryColor: "orange",
	primaryShade: 7,
	colors: { dark },
	components: {
		Popover: Popover.extend({ defaultProps: { middlewares: fitTheScreen } }),
	},
})

export type StylesProviderProps = { children: React.ReactNode }

const StylesProvider: React.FC<StylesProviderProps> = ({ children }) => {
	return (
		<MantineProvider theme={theme} forceColorScheme="dark">
			{children}
		</MantineProvider>
	)
}

export default StylesProvider
