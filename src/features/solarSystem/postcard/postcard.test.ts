import { describe, expect, it } from "vitest"

import { createI18n } from "@/i18n"
import { OVERVIEW } from "@/store/navigation"
import type { PostcardSnapshot } from "@/store/postcard"

import { postcardLink, postcardSubject, postcardText } from "./postcard"

// 2026-09-25T00:00Z
const JD = 2461308.5

const snapshot = (
	overrides: Partial<Omit<PostcardSnapshot, "shot">> = {},
): Omit<PostcardSnapshot, "shot"> => ({
	jd: JD,
	subjectId: "jupiter",
	scalePreset: "everythingVisible",
	hideDate: false,
	link: "https://example.org/solar_system",
	extra: null,
	...overrides,
})

describe("whom the postcard is of", () => {
	it("is the selection, else the focused body, else nobody", () => {
		expect(
			postcardSubject({
				selectedId: "io",
				view: { kind: "body", id: "jupiter" },
			}),
		).toBe("io")
		expect(
			postcardSubject({ selectedId: null, view: { kind: "body", id: "mars" } }),
		).toBe("mars")
		expect(postcardSubject({ selectedId: null, view: OVERVIEW })).toBeNull()
		expect(
			postcardSubject({
				selectedId: null,
				view: { kind: "point", anchorId: "sun", offsetKm: [1, 0, 0] },
			}),
		).toBeNull()
	})
})

describe("the link back to the view", () => {
	it("keeps the view and pins the moment on screen", () => {
		const link = new URL(
			postcardLink(
				"https://example.org/solar_system?focus=jupiter&cam=-40_15_2&lang=de&reading=simple#x",
				2461308.123456,
				false,
			),
		)
		expect(link.pathname).toBe("/solar_system")
		expect(link.searchParams.get("focus")).toBe("jupiter")
		expect(link.searchParams.get("cam")).toBe("-40_15_2")
		expect(link.searchParams.get("lang")).toBe("de")
		expect(link.searchParams.get("reading")).toBe("simple")
		expect(link.searchParams.get("t")).toBe("2461308.1235")
		expect(link.hash).toBe("")
	})

	it("never carries a birthday: no time while a birth date is entered", () => {
		const link = new URL(
			postcardLink(
				"https://example.org/solar_system?t=2456926&birthday=true&focus=mars",
				2456926,
				true,
			),
		)
		expect(link.searchParams.has("t")).toBe(false)
		expect(link.searchParams.has("birthday")).toBe(false)
		expect(link.searchParams.get("focus")).toBe("mars")
	})
})

describe("what the postcard says", () => {
	it("names the body, the date on screen and how honest the scale is", () => {
		const text = postcardText(snapshot(), createI18n({ locale: "en" }))
		expect(text.title).toBe("Jupiter")
		expect(text.date).toContain("2026")
		expect(text.date).toContain("UTC")
		expect(text.caption.length).toBeGreaterThan(0)
		expect(text.scaleNote).toMatch(/Not to scale/)
		expect(text.footer).toContain("Orbitalia")
		expect(text.fileName).toBe("orbitalia-jupiter-2026-09-25.png")
		expect(text.rows).toEqual([])
		expect(text.note).toBeNull()
		expect(text.facts).toEqual([])
	})

	it("speaks German, at every reading level", () => {
		const de = createI18n({ locale: "de" })
		const text = postcardText(snapshot({ subjectId: "earth" }), de)
		expect(text.title).toBe("Erde")
		expect(text.date).toContain("Sept")
		expect(text.scaleNote).toMatch(/Nicht maßstabsgetreu/)
		const simple = postcardText(
			snapshot({ subjectId: null, scalePreset: "trueScale" }),
			createI18n({ locale: "de", readingLevel: "simple" }),
		)
		expect(simple.title).toBe("Unser Sonnensystem")
		expect(simple.caption).toBe("Die Sonne und ihre acht Planeten")
		expect(simple.scaleNote).toMatch(/wie in echt/)
		expect(simple.fileName).toBe("orbitalia-solar-system-2026-09-25.png")
	})

	it("leaves the date out of the picture and the file name while it could be a birthday", () => {
		const text = postcardText(
			snapshot({ hideDate: true }),
			createI18n({ locale: "en" }),
		)
		expect(text.date).toBeNull()
		expect(text.fileName).toBe("orbitalia-jupiter.png")
		expect(JSON.stringify(text)).not.toContain("2026")
	})

	it("takes a feature's own title, date, facts and file name", () => {
		const text = postcardText(
			snapshot({
				hideDate: true,
				extra: {
					title: "How old am I?",
					date: "On 25 Sept 2026",
					caption: "My birthday sky",
					rows: [{ id: "mars", label: "Mars", value: "6 years old" }],
					note: "11.3 billion km",
					facts: ["Jupiter is 11 times as wide as Earth."],
					scaleNote: "True relative sizes",
					fileName: "my-age.png",
				},
			}),
			createI18n({ locale: "en" }),
		)
		expect(text.title).toBe("How old am I?")
		expect(text.date).toBe("On 25 Sept 2026")
		expect(text.caption).toBe("My birthday sky")
		expect(text.rows).toHaveLength(1)
		expect(text.note).toBe("11.3 billion km")
		expect(text.facts).toEqual(["Jupiter is 11 times as wide as Earth."])
		expect(text.scaleNote).toBe("True relative sizes")
		expect(text.fileName).toBe("my-age.png")
	})

	it("says nothing about the scale in the middle of a switch", () => {
		const text = postcardText(
			snapshot({ scalePreset: null }),
			createI18n({ locale: "en" }),
		)
		expect(text.scaleNote).toBeNull()
	})
})
