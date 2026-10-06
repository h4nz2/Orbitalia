/**
 * Resolves a path inside public/ against Vite's base URL, so every texture and icon
 * keeps working when the site is served from a sub path (VITE_BASE).
 * Accepts "assets/x.jpg" and "/assets/x.jpg" alike; BASE_URL always ends with "/".
 */
export const assetUrl = (path: string) =>
	`${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`
