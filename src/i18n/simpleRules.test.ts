import { describe, expect, it } from "vitest"

import { simpleProblems } from "./simpleRules"

describe("simpleProblems (#51)", () => {
	it("lets small numbers and plain words through", () => {
		expect(simpleProblems("11 Earths wide, 2 moons, 4 hours", "en")).toEqual([])
		expect(simpleProblems("Phobos is only 22 km across", "en")).toEqual([])
		expect(simpleProblems("hundreds of rocks, 100 at most", "en")).toEqual([])
		expect(simpleProblems("Es dauert 8,5 Minuten.", "de")).toEqual([])
	})

	it("finds numbers above 100 in each language's own style, years too", () => {
		expect(simpleProblems("more than 1,300 Earths", "en")).toEqual(["1,300"])
		expect(simpleProblems("mehr als 1300 Erden", "de")).toEqual(["1300"])
		expect(simpleProblems("mehr als 1.300 Erden", "de")).toEqual(["1.300"])
		expect(simpleProblems("víc než 1 300 Zemí", "cs")).toEqual(["1 300"])
		expect(simpleProblems("plus de 1 300 Terres", "fr")).toEqual(["1 300"])
		expect(simpleProblems("In 2003 the Sun", "en")).toEqual(["2003"])
		expect(simpleProblems("−180 degrees", "en")).toEqual(["180"])
		// a German decimal comma is not a thousands separator
		expect(simpleProblems("1,5 Erden", "de")).toEqual([])
	})

	it("finds the words for big numbers, also inside compounds", () => {
		expect(simpleProblems("about 4 billion years", "en")).toEqual(["billion"])
		expect(simpleProblems("vor Jahrmillionen", "de")).toEqual(["million"])
		expect(simpleProblems("tisíce let", "cs")).toEqual(["tisíc"])
		expect(simpleProblems("mil millones de años", "es")).toEqual(["mil"])
		expect(simpleProblems("des milliers d’années", "fr")).toEqual(["milliers"])
		// "miles" is a Spanish word for thousands, not an English one
		expect(simpleProblems("five miles", "en")).toEqual([])
	})

	it("finds scientific units and notation", () => {
		expect(simpleProblems("5.2 AU", "en")).toEqual(["AU"])
		expect(simpleProblems("5,2 AE", "de")).toEqual(["AE"])
		expect(simpleProblems("5,2 au", "cs")).toEqual(["au"])
		// "au" is a French word
		expect(simpleProblems("au Soleil", "fr")).toEqual([])
		expect(simpleProblems("5,2 ua", "fr")).toEqual(["ua"])
		expect(simpleProblems("about 55 K", "en")).toEqual(["kelvin"])
		expect(simpleProblems("9.8 m/s²", "en")).toEqual(["m/s²", "superscript"])
		expect(simpleProblems("about 15 °C", "en")).toEqual(["degrees"])
		expect(simpleProblems("1.9 × 10²⁷ kg", "en")).toEqual([
			"× 10",
			"superscript",
		])
	})
})
