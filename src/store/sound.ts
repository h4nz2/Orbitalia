/**
 * Sound (#32; docs/ARCHITECTURE.md, "Sound"): what the viewer asked the app to
 * play. The store holds choices only; `features/solarSystem/sound` turns them
 * into audio.
 *
 * Classroom rules:
 * - **Off by default.** `enabled` starts false on every fresh visit. Turning
 *   sound on lasts for the tab (sessionStorage), so a reload in the middle of a
 *   lesson keeps it; a new visit, a new tab or the projector tomorrow starts
 *   silent again. Even then nothing plays before the viewer's first click or
 *   key press (browser autoplay rules, `unlockAudio`).
 * - The volume and the two layer switches are preferences and are remembered
 *   (localStorage). They never switch sound on by themselves.
 * - `mute()` stops everything at once, recordings included (the M key, the
 *   speaker button, and for #29's presentation mode).
 * - `muted` remembers that the viewer turned sound off in this visit: a
 *   feature that may turn sound on by itself (an Easy hunt reading its clues
 *   aloud, #52) then leaves it off.
 */
import { create } from "zustand"

export const SOUND_PREFS_KEY = "orbitalia.sound"
export const SOUND_ON_KEY = "orbitalia.sound.on"

/** Quiet by default: half the slider is about a sixth of full level (see `volumeGain`). */
export const DEFAULT_VOLUME = 0.5

export interface SoundPrefs {
	/** 0..1, the slider's position (perceptual, see `volumeGain`). */
	volume: number
	/** The ambient bed that follows the camera. */
	ambient: boolean
	/** Motion and UI cues: the flight whoosh, arrival tones, finds. */
	cues: boolean
}

export const DEFAULT_PREFS: SoundPrefs = {
	volume: DEFAULT_VOLUME,
	ambient: true,
	cues: true,
}

export interface SoundState extends SoundPrefs {
	/** The one master switch: false means total silence. */
	enabled: boolean
	/** The recording being played (`recordings.ts` id), or null. */
	playing: string | null
	/** The viewer turned sound off after it was on, in this page visit (not stored). */
	muted: boolean
	/** Turning on only records the choice: the caller unlocks audio in its own click handler. */
	setEnabled: (enabled: boolean) => void
	/** Silence now: master off, recording stopped. */
	mute: () => void
	setVolume: (volume: number) => void
	setAmbient: (ambient: boolean) => void
	setCues: (cues: boolean) => void
	/** Marks recording `id` as playing (and sound as on); `stop` or its end clears it. */
	setPlaying: (id: string | null) => void
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** Preferences read back from storage; anything malformed falls back to the defaults. */
export function parsePrefs(raw: string | null): SoundPrefs {
	if (raw === null) return DEFAULT_PREFS
	try {
		const value = JSON.parse(raw) as Partial<SoundPrefs> | null
		if (value === null || typeof value !== "object") return DEFAULT_PREFS
		return {
			volume:
				typeof value.volume === "number" && Number.isFinite(value.volume)
					? clamp01(value.volume)
					: DEFAULT_PREFS.volume,
			ambient:
				typeof value.ambient === "boolean"
					? value.ambient
					: DEFAULT_PREFS.ambient,
			cues: typeof value.cues === "boolean" ? value.cues : DEFAULT_PREFS.cues,
		}
	} catch {
		return DEFAULT_PREFS
	}
}

function loadPrefs(): SoundPrefs {
	try {
		return parsePrefs(localStorage.getItem(SOUND_PREFS_KEY))
	} catch {
		return DEFAULT_PREFS
	}
}

function savePrefs({ volume, ambient, cues }: SoundPrefs): void {
	try {
		const prefs: SoundPrefs = { volume, ambient, cues }
		localStorage.setItem(SOUND_PREFS_KEY, JSON.stringify(prefs))
	} catch {
		// storage blocked: the choice lasts for this page only
	}
}

function loadEnabled(): boolean {
	try {
		return sessionStorage.getItem(SOUND_ON_KEY) === "1"
	} catch {
		return false
	}
}

function saveEnabled(enabled: boolean): void {
	try {
		if (enabled) sessionStorage.setItem(SOUND_ON_KEY, "1")
		else sessionStorage.removeItem(SOUND_ON_KEY)
	} catch {
		// storage blocked: a reload starts silent, which is the safe side
	}
}

export const useSoundStore = create<SoundState>()((set, get) => ({
	...loadPrefs(),
	enabled: loadEnabled(),
	playing: null,
	muted: false,
	setEnabled: (enabled) => {
		saveEnabled(enabled)
		set(
			enabled
				? { enabled, muted: false }
				: { enabled, playing: null, muted: get().muted || get().enabled },
		)
	},
	mute: () => get().setEnabled(false),
	setVolume: (volume) => {
		if (!Number.isFinite(volume)) return
		set({ volume: clamp01(volume) })
		savePrefs(get())
	},
	setAmbient: (ambient) => {
		set({ ambient })
		savePrefs(get())
	},
	setCues: (cues) => {
		set({ cues })
		savePrefs(get())
	},
	setPlaying: (playing) => {
		// one update, so nobody ever sees sound on without the recording
		if (playing !== null && !get().enabled) {
			saveEnabled(true)
			set({ enabled: true, muted: false, playing })
		} else {
			set({ playing })
		}
	},
}))
