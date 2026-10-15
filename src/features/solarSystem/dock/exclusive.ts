/**
 * One panel at a time (#42). The dock holds whichever panel was opened last:
 * the HUD's own panels (Layers, Scale, the spacecraft list; `src/store/hud.ts`)
 * and the tools that keep their open flag in their own store (the light, the
 * birthday, tonight's sky, the scavenger hunt), and on a phone held upright
 * the time controls in the sheet (#60). Opening one closes the one
 * before, whichever way it was opened: a button, the Tools menu, a link
 * (`?sky=true`, `?hunt=…`) or a key.
 *
 * A new tool registers here with one entry (docs/ARCHITECTURE.md, "HUD layout").
 */
import { useBirthdayStore } from "@/store/birthday"
import { useHudStore } from "@/store/hud"
import { useHuntStore } from "@/store/hunt"
import { useLightStore } from "@/store/light"
import { useSheetStore } from "@/store/sheet"
import { useSkyTonightStore } from "@/store/skyTonight"

/** A panel that shares the dock: whether it is open, how to close it, and when to look again. */
export interface DockEntry {
	readonly id: string
	isOpen(): boolean
	close(): void
	subscribe(listener: () => void): () => void
}

/**
 * Keeps at most one of `entries` open: whenever one opens, every other open
 * one closes. Returns the function that stops watching.
 */
export function keepOneOpen(entries: readonly DockEntry[]): () => void {
	let open = new Set(entries.filter((entry) => entry.isOpen()).map((e) => e.id))
	const check = () => {
		const now = entries.filter((entry) => entry.isOpen())
		const opened = now.find((entry) => !open.has(entry.id))
		open = new Set(now.map((entry) => entry.id))
		if (opened === undefined) return
		// closing below re-enters check; `open` already knows the new panel
		open = new Set([opened.id])
		for (const entry of now) if (entry !== opened) entry.close()
	}
	const stops = entries.map((entry) => entry.subscribe(check))
	return () => stops.forEach((stop) => stop())
}

interface OpenStore {
	getState(): { open: boolean; setOpen(open: boolean): void }
	subscribe(listener: () => void): () => void
}

const toolEntry = (id: string, store: OpenStore): DockEntry => ({
	id,
	isOpen: () => store.getState().open,
	close: () => store.getState().setOpen(false),
	subscribe: (listener) => store.subscribe(listener),
})

/** Every panel of the solar system's dock. */
export const DOCK_ENTRIES: readonly DockEntry[] = [
	{
		id: "hud",
		isOpen: () => useHudStore.getState().panel !== null,
		close: () => useHudStore.getState().setPanel(null),
		subscribe: (listener) => useHudStore.subscribe(listener),
	},
	toolEntry("light", useLightStore),
	toolEntry("birthday", useBirthdayStore),
	toolEntry("sky", useSkyTonightStore),
	toolEntry("hunt", useHuntStore),
	{
		id: "time",
		isOpen: () => useSheetStore.getState().timeOpen,
		close: () => useSheetStore.getState().setTimeOpen(false),
		subscribe: (listener) => useSheetStore.subscribe(listener),
	},
]

/** Starts keeping the solar system's dock to one panel; returns the stop function. */
export const keepDockToOnePanel = (): (() => void) => keepOneOpen(DOCK_ENTRIES)
