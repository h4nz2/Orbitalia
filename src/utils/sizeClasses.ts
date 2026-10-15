/**
 * The size classes (#58; docs/ARCHITECTURE.md, "HUD layout"): one definition
 * of "a phone" and "a finger", shared by CSS and code.
 *
 * - **Phone**: a screen narrower than 600 px or lower than 480 px (Android's
 *   compact width or height), so a phone on its side counts too. It decides
 *   the arrangement, never the kind of device; rotating, resizing and split
 *   screen switch it live.
 * - **Touch**: the primary pointer is a finger (`pointer: coarse`): phones and
 *   tablets. Every control is at least 44×44 px there. A laptop with a mouse,
 *   touchscreen or not, keeps the dense look.
 * - **Upright phone** (#60): a phone held upright (narrower than 600 px, taller
 *   than wide). Its card, panels, tours and time share one sheet from the
 *   bottom; a phone on its side keeps #58's paired rows.
 *
 * CSS modules write `@media $phone { … }`, `@media $touch { … }` and `@media
 * $uprightPhone { … }` (postcss-simple-vars; `postcss.config.js` reads the
 * same JSON). Code uses the queries below, or `usePhone` / `useTouch` /
 * `useUprightPhone` (`@/hooks/useSizeClass`).
 */
import sizeClasses from "./sizeClasses.json"

/** A phone, upright or on its side: the phone arrangement. */
export const PHONE_QUERY: string = sizeClasses.phone

/** The primary pointer is a finger: finger-sized controls. */
export const TOUCH_QUERY: string = sizeClasses.touch

/** A phone held upright: the bottom sheet (#60). */
export const UPRIGHT_PHONE_QUERY: string = sizeClasses.uprightPhone

/** The smallest side of a control where the pointer is a finger (WCAG 2.5.5, Apple). */
export const TOUCH_TARGET_PX = 44

const matches = (query: string): boolean =>
	typeof window !== "undefined" &&
	typeof window.matchMedia === "function" &&
	window.matchMedia(query).matches

/** Whether the screen gets the phone arrangement right now. */
export const isPhone = (): boolean => matches(PHONE_QUERY)

/** Whether the primary pointer is a finger right now. */
export const isTouch = (): boolean => matches(TOUCH_QUERY)

/** Whether the screen is a phone held upright right now: the bottom sheet (#60). */
export const isUprightPhone = (): boolean => matches(UPRIGHT_PHONE_QUERY)
