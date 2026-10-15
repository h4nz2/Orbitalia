/**
 * Finger sizes (#58): where the primary pointer is a finger every control is
 * at least 44×44 px. These find the controls that are not.
 */
import type { Page } from "@playwright/test"

/** The smallest side of a control a finger hits (src/utils/sizeClasses.ts). */
export const TOUCH_TARGET_PX = 44

export interface SmallControl {
	name: string
	tag: string
	width: number
	height: number
}

/**
 * Every visible control smaller than 44 px on a side: on screen only, or in
 * the whole page with `whole` (a page that scrolls). What a finger hits is
 * measured: a switch, checkbox or segment by its label, a slider by its row.
 * Exempt, as WCAG 2.5.5 allows: links inside running text. The scene's labels
 * are not controls (the scene picks bodies with generous radii, #16, #20).
 */
export const smallControls = (
	page: Page,
	{ whole = false }: { whole?: boolean } = {},
): Promise<SmallControl[]> =>
	page.evaluate(
		({ whole, min }) => {
			const selector = [
				"button",
				"a[href]",
				"input:not([type=hidden])",
				"select",
				"textarea",
				...[
					"button",
					"switch",
					"radio",
					"checkbox",
					"tab",
					"menuitem",
					"menuitemradio",
					"menuitemcheckbox",
					"combobox",
					"slider",
					"option",
				].map((role) => `[role=${role}]`),
			].join(",")
			const target = (element: Element): Element => {
				if (element.matches("input[type=radio], input[type=checkbox]")) {
					const label =
						element.closest("label") ??
						(element.id === ""
							? null
							: document.querySelector(`label[for="${element.id}"]`))
					if (label !== null) return label
				}
				if (element.matches("[role=slider]"))
					return element.closest(".mantine-Slider-root") ?? element
				return element
			}
			// a link in a sentence or a block of text, not standing on its own
			const inline = (element: Element) =>
				element.tagName === "A" &&
				getComputedStyle(element).display === "inline" &&
				(element.parentElement?.textContent ?? "").trim().length >
					(element.textContent ?? "").trim().length + 3
			const seen = new Set<Element>()
			const small: SmallControl[] = []
			for (const element of document.querySelectorAll(selector)) {
				if (
					!element.checkVisibility({
						opacityProperty: true,
						visibilityProperty: true,
					}) ||
					element.closest("[aria-hidden=true], [inert]") !== null ||
					inline(element)
				)
					continue
				const hit = target(element)
				if (seen.has(hit)) continue
				seen.add(hit)
				const box = hit.getBoundingClientRect()
				// visually hidden (a native input under its own label)
				if (box.width <= 2 || box.height <= 2) continue
				if (
					!whole &&
					(box.bottom <= 0 ||
						box.right <= 0 ||
						box.top >= window.innerHeight ||
						box.left >= window.innerWidth)
				)
					continue
				if (box.width < min - 0.5 || box.height < min - 0.5)
					small.push({
						name: (
							hit.getAttribute("aria-label") ??
							element.getAttribute("aria-label") ??
							hit.textContent ??
							""
						)
							.trim()
							.replace(/\s+/g, " ")
							.slice(0, 60),
						tag: element.tagName.toLowerCase(),
						width: Math.round(box.width),
						height: Math.round(box.height),
					})
			}
			return small
		},
		{ whole, min: TOUCH_TARGET_PX },
	)
