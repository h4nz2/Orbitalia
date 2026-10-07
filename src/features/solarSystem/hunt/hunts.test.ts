import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { bodyById, moonsOf } from "@/data"
import { DEFAULT_LOCALE, LOCALES, READING_LEVELS, createI18n } from "@/i18n"
import { bodyName, levelsOf } from "@/i18n/bodies"
import { useHuntStore } from "@/store/hunt"
import { OVERVIEW, OVERVIEW_BODY_ID } from "@/store/navigation"
import { useSimStore } from "@/store/sim"

import { FRAME_PRESETS } from "../frame/presets"
import { certificate } from "./certificate"
import {
	DEFAULT_DIFFICULTY,
	DIFFICULTIES,
	HUNTS,
	HuntFile,
	QUESTIONS,
	customHuntKey,
	difficultyOf,
	guessOf,
	huntFile,
	huntsOf,
	isEasy,
	questionById,
	resolveHunt,
	showPreset,
	solves,
} from "./hunts"
import {
	HuntTextFile,
	arrivalText,
	huntText,
	huntTitle,
	questionText,
	spokenClue,
} from "./text"
import { showAnswer, watchAnswers } from "./watch"

describe("the question bank (src/data/hunts.json)", () => {
	it("matches the schema", () => {
		const result = HuntFile.safeParse(huntFile)
		expect(result.success ? [] : result.error.issues).toEqual([])
	})

	it("ships at least ten clues (the issue's acceptance criterion)", () => {
		expect(QUESTIONS.length).toBeGreaterThanOrEqual(10)
	})

	it("has unique question and hunt ids, and no id reads as a list", () => {
		const ids = QUESTIONS.map((question) => question.id)
		expect(new Set(ids).size).toBe(ids.length)
		const huntIds = HUNTS.map((hunt) => hunt.id)
		expect(new Set(huntIds).size).toBe(huntIds.length)
		// a hunt id must never be mistaken for a clue id (both go into ?hunt=)
		expect(huntIds.filter((id) => questionById.has(id))).toEqual([])
	})

	it("answers every clue with bodies of the app, never the Sun alone", () => {
		for (const question of QUESTIONS) {
			const unknown = question.answers.filter((id) => !bodyById.has(id))
			expect(unknown, question.id).toEqual([])
			expect(new Set(question.answers).size, question.id).toBe(
				question.answers.length,
			)
		}
	})

	it("holds only real bodies still", () => {
		for (const question of QUESTIONS) {
			if (question.frame === undefined) continue
			expect(bodyById.has(question.frame), question.id).toBe(true)
			expect(question.frame, question.id).not.toBe(OVERVIEW_BODY_ID)
			expect(question.answers, question.id).not.toContain(question.frame)
		}
	})

	it("builds every hunt from known clues, each clue once", () => {
		for (const hunt of HUNTS) {
			expect(
				hunt.questions.filter((id) => !questionById.has(id)),
				hunt.id,
			).toEqual([])
			expect(new Set(hunt.questions).size, hunt.id).toBe(hunt.questions.length)
		}
	})

	it("puts every clue into at least one ready-made hunt", () => {
		const used = new Set(HUNTS.flatMap((hunt) => hunt.questions))
		expect(QUESTIONS.filter((question) => !used.has(question.id))).toEqual([])
	})

	it("has ready-made hunts at every difficulty", () => {
		for (const difficulty of DIFFICULTIES) {
			expect(huntsOf(difficulty).length, difficulty).toBeGreaterThan(0)
		}
		// every hunt is listed under exactly one difficulty
		expect(DIFFICULTIES.flatMap((d) => huntsOf(d)).length).toBe(HUNTS.length)
	})

	it("opens the chooser on the difficulty of the reader's age (#52)", () => {
		expect(DEFAULT_DIFFICULTY).toEqual({
			simple: "easy",
			standard: "hard",
			advanced: "hard",
		})
	})
})

describe("Easy clues (#52)", () => {
	const easy = QUESTIONS.filter(isEasy)
	const easyHunts = huntsOf("easy")

	it("are the Easy hunts' only clues, 3 to 5 of them", () => {
		for (const hunt of easyHunts) {
			const questions = hunt.questions.map((id) => questionById.get(id)!)
			expect(questions.every(isEasy), hunt.id).toBe(true)
			expect(questions.length, hunt.id).toBeGreaterThanOrEqual(3)
			expect(questions.length, hunt.id).toBeLessThanOrEqual(5)
		}
		// the issue's content: at least two Easy hunts of five clues
		expect(
			easyHunts.filter((hunt) => hunt.questions.length === 5).length,
		).toBeGreaterThanOrEqual(2)
	})

	it("never sit in a Medium hunt, and Tricky clues never either", () => {
		for (const hunt of huntsOf("medium")) {
			const levels = hunt.questions.map(
				(id) => questionById.get(id)!.difficulty,
			)
			expect(
				levels.every((level) => level === "medium"),
				hunt.id,
			).toBe(true)
		}
	})

	it("each come with a picture of what to look for", () => {
		expect(easy.length).toBeGreaterThanOrEqual(10)
		for (const question of easy) {
			expect(question.picture, question.id).toBeDefined()
			// the picture shows the answer itself: matching it is the game
			expect(question.answers, question.id).toContain(question.picture)
			expect(question.answers.length, question.id).toBe(1)
		}
	})

	it("ask only for what can be seen: no point of view, a moon from its planet", () => {
		for (const question of easy) {
			expect(question.frame, question.id).toBeUndefined()
			const answer = bodyById.get(question.answers[0])!
			if (answer.kind === "moon") {
				// the hunt first takes the camera there ("We are at Jupiter.")
				expect(question.at, question.id).toBe(answer.parentId)
				expect(answer.featured, question.id).toBe(true)
			} else {
				expect(question.at, question.id).toBeUndefined()
				expect(["star", "planet"], question.id).toContain(answer.kind)
			}
		}
		// only Easy clues move the camera before asking
		for (const question of QUESTIONS.filter((q) => !isEasy(q))) {
			expect(question.at, question.id).toBeUndefined()
		}
		for (const question of QUESTIONS.filter((q) => q.at !== undefined)) {
			expect(bodyById.get(question.at!)?.kind, question.id).toBe("planet")
			expect(
				moonsOf(question.at!).some((moon) =>
					question.answers.includes(moon.id),
				),
				question.id,
			).toBe(true)
		}
	})

	describe.each(LOCALES)("%s", (locale) => {
		const file = huntText.get(locale)!
		/** Sentences: text up to a full stop, "!" or "?" (with Spanish's opening marks). */
		const sentences = (text: string) =>
			text.split(/(?<=[.!?])\s+(?=[¡¿"«„]?\p{Lu})/u).filter(Boolean)

		it("have read-aloud words at every level: one short sentence, no number above 20", () => {
			for (const question of easy) {
				for (const level of READING_LEVELS) {
					const i18n = createI18n({ locale, readingLevel: level })
					const words = questionText(question.id, i18n)
					const spoken = spokenClue(question, i18n)
					expect(spoken.length, `${question.id}@${level}`).toBeGreaterThan(0)
					expect(spoken, `${question.id}@${level}`).toContain(words.clue)
					for (const text of [words.clue, words.found]) {
						expect(
							sentences(text),
							`${question.id}@${level}: ${text}`,
						).toHaveLength(1)
						expect(text.length, `${question.id}: ${text}`).toBeLessThanOrEqual(
							70,
						)
					}
					for (const text of [spoken, words.found, ...words.hints]) {
						const numbers = (text.match(/\d+/g) ?? []).map(Number)
						expect(
							numbers.filter((n) => n > 20),
							`${question.id}: ${text}`,
						).toEqual([])
					}
				}
			}
		})

		it("say where the camera went first for a clue about moons", () => {
			const i18n = createI18n({ locale, readingLevel: "simple" })
			for (const question of easy) {
				const arrival = arrivalText(question, i18n)
				if (question.at === undefined) expect(arrival).toBeNull()
				else {
					expect(arrival, question.id).toContain(
						bodyName(question.at, i18n.chain),
					)
					expect(spokenClue(question, i18n).startsWith(arrival!)).toBe(true)
				}
			}
		})

		it("give every clue simple-level hints (#52), Easy ones two before 'Show me'", () => {
			for (const question of QUESTIONS) {
				const hints = file.questions[question.id]!.hints
				if (isEasy(question)) {
					// written for the youngest, so one text serves every level
					const simple = questionText(
						question.id,
						createI18n({ locale, readingLevel: "simple" }),
					).hints
					expect(simple.length, question.id).toBe(2)
					for (const text of simple) {
						expect(sentences(text), `${question.id}: ${text}`).toHaveLength(1)
					}
				} else {
					expect(levelsOf(hints), question.id).toContain("simple")
				}
			}
		})
	})
})

describe("the clues' words (src/locales/<locale>/hunts.json)", () => {
	const reference = huntText.get(DEFAULT_LOCALE)!

	it("exist for every locale", () => {
		expect([...huntText.keys()].sort()).toEqual([...LOCALES].sort())
	})

	describe.each(LOCALES)("%s", (locale) => {
		const file = huntText.get(locale)!

		it("matches the schema", () => {
			const result = HuntTextFile.safeParse(file)
			expect(result.success ? [] : result.error.issues).toEqual([])
		})

		it("has exactly the bank's hunts and clues", () => {
			expect(Object.keys(file.hunts).sort()).toEqual(
				HUNTS.map((hunt) => hunt.id).sort(),
			)
			expect(Object.keys(file.questions).sort()).toEqual(
				QUESTIONS.map((question) => question.id).sort(),
			)
		})

		it("writes every clue and discovery for every reading level", () => {
			for (const [id, entry] of Object.entries(file.questions)) {
				// an Easy clue is written for the youngest: one text serves every level
				if (isEasy(questionById.get(id)!)) continue
				for (const field of ["clue", "found"] as const) {
					expect(levelsOf(entry[field]).sort(), `${id}.${field}`).toEqual(
						[...READING_LEVELS].sort(),
					)
				}
			}
		})

		it("mirrors the reference's reading levels and hint counts", () => {
			for (const [id, entry] of Object.entries(file.questions)) {
				const ref = reference.questions[id]!
				expect(levelsOf(entry.hints), id).toEqual(levelsOf(ref.hints))
				for (const level of READING_LEVELS) {
					const i18n = createI18n({ locale, readingLevel: level })
					const en = createI18n({ locale: DEFAULT_LOCALE, readingLevel: level })
					expect(questionText(id, i18n).hints.length, `${id}@${level}`).toBe(
						questionText(id, en).hints.length,
					)
				}
			}
		})

		it("gives every clue at least two hints before 'Show me'", () => {
			for (const id of Object.keys(file.questions)) {
				for (const level of READING_LEVELS) {
					const i18n = createI18n({ locale, readingLevel: level })
					expect(
						questionText(id, i18n).hints.length,
						`${id}@${level}`,
					).toBeGreaterThanOrEqual(2)
				}
			}
		})

		it("names the answer in a clue's last hint, so nobody stalls", () => {
			const i18n = createI18n({ locale })
			for (const question of QUESTIONS) {
				const last = questionText(question.id, i18n).hints.at(-1) ?? ""
				// the translated name, as the scene's labels show it
				const names = question.answers.map((id) => bodyName(id, i18n.chain))
				expect(
					names.some((name) => last.includes(name)),
					`${question.id}: ${last}`,
				).toBe(true)
			}
		})
	})

	it("reads the level's text and falls back from German to English", () => {
		const simple = questionText(
			"walkedOn",
			createI18n({ locale: "de", readingLevel: "simple" }),
		)
		expect(simple.clue).toContain("Menschen")
		const advanced = questionText(
			"walkedOn",
			createI18n({ locale: "en", readingLevel: "advanced" }),
		)
		expect(advanced.clue).toBe(
			"Find the only other world that humans have set foot on.",
		)
		expect(huntTitle("weirdWorlds", createI18n({ locale: "de" })).title).toBe(
			"Seltsame Welten",
		)
		// an unknown clue shows its id rather than nothing
		expect(questionText("nope", createI18n()).clue).toBe("nope")
	})
})

describe("resolveHunt", () => {
	it("opens a ready-made hunt by its id", () => {
		const hunt = resolveHunt("weirdWorlds")
		expect(hunt?.id).toBe("weirdWorlds")
		expect(hunt?.difficulty).toBe("hard")
		expect(hunt?.questions.map((question) => question.id)).toEqual(
			HUNTS.find((h) => h.id === "weirdWorlds")!.questions,
		)
	})

	it("builds a teacher's hunt from clue ids, in the link's order", () => {
		const hunt = resolveHunt("oceanMoon.geysers.nope.geysers")
		expect(hunt?.id).toBeNull()
		expect(hunt?.questions.map((question) => question.id)).toEqual([
			"oceanMoon",
			"geysers",
		])
		expect(hunt?.key).toBe("oceanMoon.geysers")
		expect(resolveHunt(hunt!.key)?.key).toBe(hunt!.key)
	})

	it("returns nothing for empty or unknown keys", () => {
		expect(resolveHunt(undefined)).toBeNull()
		expect(resolveHunt("")).toBeNull()
		expect(resolveHunt("nope.alsoNope")).toBeNull()
	})

	it("rates a hunt by its hardest clue, a teacher's mix too", () => {
		expect(resolveHunt("lookAndFind")?.difficulty).toBe("easy")
		expect(resolveHunt("seeRed.walkedOn")?.difficulty).toBe("medium")
		expect(resolveHunt("seeRed.walkedOn.retrogradeLoop")?.difficulty).toBe(
			"hard",
		)
		expect(difficultyOf([])).toBeNull()
	})

	it("keys a custom hunt in the bank's order", () => {
		expect(customHuntKey(["hiddenRings", "walkedOn"])).toBe(
			"walkedOn.hiddenRings",
		)
	})
})

describe("answering", () => {
	const loop = questionById.get("retrogradeLoop")!
	const geysers = questionById.get("geysers")!
	const backwards = questionById.get("spinsBackwards")!

	it("is solved by selecting any answer", () => {
		expect(solves(backwards, { selectedId: "venus", frameId: "sun" })).toBe(
			true,
		)
		expect(solves(backwards, { selectedId: "uranus", frameId: "sun" })).toBe(
			true,
		)
		expect(solves(backwards, { selectedId: "earth", frameId: "sun" })).toBe(
			false,
		)
		expect(solves(backwards, { selectedId: null, frameId: "sun" })).toBe(false)
	})

	it("needs the clue's point of view when it names one", () => {
		expect(solves(loop, { selectedId: "mars", frameId: "sun" })).toBe(false)
		expect(solves(loop, { selectedId: "mars", frameId: "earth" })).toBe(true)
		expect(guessOf(loop, "mars")).toBe("almost")
	})

	it("is warm on the planet of a moon that answers it", () => {
		expect(guessOf(geysers, "saturn")).toBe("warm")
		expect(guessOf(geysers, "jupiter")).toBe("other")
		expect(guessOf(geysers, "sun")).toBe("other")
		expect(guessOf(geysers, "mimas")).toBe("other")
	})

	it("shows Mars from Earth for the loop, and nothing special otherwise", () => {
		expect(showPreset(loop)).toBe("planets")
		expect(FRAME_PRESETS.planets.selectId).toBe("mars")
		expect(showPreset(geysers)).toBeNull()
	})
})

describe("watchAnswers (with the real stores)", () => {
	let stop: (() => void) | undefined

	beforeEach(() => {
		useSimStore.getState().releaseFrame()
		useSimStore.getState().jumpTo(OVERVIEW, null)
		useSimStore.getState().select(null)
		useHuntStore.getState().start("weirdWorlds")
	})

	afterEach(() => {
		stop?.()
		stop = undefined
	})

	it("solves the clue on selecting an answer, and only then", () => {
		const question = questionById.get("spinsBackwards")!
		stop = watchAnswers(question)
		useSimStore.getState().setFocus("mars")
		expect(useHuntStore.getState().phase).toBe("asking")
		expect(useHuntStore.getState().guess).toEqual({
			bodyId: "mars",
			kind: "other",
		})
		useSimStore.getState().setFocus("uranus")
		expect(useHuntStore.getState().phase).toBe("found")
		expect(useHuntStore.getState().found).toEqual(["uranus"])
		expect(useHuntStore.getState().guess).toBeNull()
	})

	it("lets go of a selection that already answers the new clue", () => {
		useSimStore.getState().setFocus("venus")
		const question = questionById.get("dayLongerThanYear")!
		stop = watchAnswers(question)
		expect(useSimStore.getState().selectedId).toBeNull()
		expect(useHuntStore.getState().phase).toBe("asking")
		// clicking the focused planet selects it again: a fresh answer
		useSimStore.getState().setFocus("venus")
		expect(useHuntStore.getState().phase).toBe("found")
	})

	it("says 'warm' on the planet, then solves on its moon", () => {
		const question = questionById.get("geysers")!
		stop = watchAnswers(question)
		useSimStore.getState().setFocus("saturn")
		expect(useHuntStore.getState().guess?.kind).toBe("warm")
		useSimStore.getState().setFocus("enceladus")
		expect(useHuntStore.getState().found).toEqual(["enceladus"])
	})

	it("'Show me' solves a clue, points of view included", () => {
		const geysers = questionById.get("geysers")!
		stop = watchAnswers(geysers)
		showAnswer(geysers)
		expect(useHuntStore.getState().found).toEqual(["enceladus"])
		stop()

		useHuntStore.getState().start("lightAndMotion")
		const loop = questionById.get("retrogradeLoop")!
		stop = watchAnswers(loop)
		useSimStore.getState().setFocus("mars")
		expect(useHuntStore.getState().guess?.kind).toBe("almost")
		showAnswer(loop)
		expect(useSimStore.getState().frameId).toBe("earth")
		expect(useHuntStore.getState().phase).toBe("found")
		expect(useHuntStore.getState().found).toEqual(["mars"])
		useSimStore.getState().setPaused(true)
		useSimStore.getState().setTimeWarp(1)
	})

	it("'Show me' flies to an Easy clue's moon", () => {
		const titan = questionById.get("seeBiggestMoon")!
		stop = watchAnswers(titan)
		showAnswer(titan)
		expect(useSimStore.getState().selectedId).toBe("titan")
		expect(useHuntStore.getState().found).toEqual(["titan"])
	})

	it("stops watching when told to", () => {
		const question = questionById.get("spinsBackwards")!
		watchAnswers(question)()
		useSimStore.getState().setFocus("venus")
		expect(useHuntStore.getState().phase).toBe("asking")
	})
})

describe("the certificate (#52)", () => {
	it("stamps the hunt, the date and every world found on the postcard", () => {
		const i18n = createI18n({ locale: "en", readingLevel: "simple" })
		const hunt = resolveHunt("lookAndFind")!
		const found = ["earth", "mars", "jupiter", "saturn", "moon"]
		const extra = certificate(
			hunt,
			found,
			i18n,
			(id) => bodyName(id, i18n.chain),
			new Date("2026-10-07T12:00:00Z"),
		)
		expect(extra.title).toBe("Space explorer!")
		expect(extra.caption).toBe("Look and find: you found all 5!")
		expect(extra.date).toBe("October 7, 2026")
		expect(extra.rows?.map((row) => [row.label, row.value])).toEqual([
			["Clue 1", "Earth"],
			["Clue 2", "Mars"],
			["Clue 3", "Jupiter"],
			["Clue 4", "Saturn"],
			["Clue 5", "Moon"],
		])
		expect(extra.fileName).toBe("my-space-hunt-2026-10-07.png")
	})
})
