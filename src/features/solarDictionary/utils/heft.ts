import type { Body } from "@/data"

/**
 * Mean density in g/cm³ from the body model's mass and mean radius (the
 * source's own density field mixes units: kg/m³ for the Sun, g/cm³ for the
 * planets). The mean radius gives the volume of the flattened giants too.
 */
export function densityOf(
	body: Pick<Body, "massKg" | "radiusKm">,
): number | null {
	if (body.massKg === null) return null
	const volumeM3 = (4 / 3) * Math.PI * (body.radiusKm * 1000) ** 3
	return body.massKg / volumeM3 / 1000
}
