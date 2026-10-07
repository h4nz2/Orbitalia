/** The pictures the dictionary's story sections lead with (#53). */
import {
	IconCircleDot,
	IconCloud,
	IconCrown,
	IconDiamond,
	IconEye,
	IconFlame,
	IconFriends,
	IconHome,
	IconMathFunction,
	IconMoon,
	IconPlanet,
	IconRotate2,
	IconRun,
	IconSnowflake,
	IconStar,
	IconSun,
	IconSunMoon,
	IconTelescope,
	IconWind,
	IconWorld,
	type Icon,
} from "@tabler/icons-react"

import type {
	DiscoveryKind,
	NicknameIcon,
	TemperatureRange,
} from "@/data/worlds"

export const NICKNAME_ICON: Record<NicknameIcon, Icon> = {
	sun: IconSun,
	run: IconRun,
	star: IconStar,
	twins: IconFriends,
	world: IconWorld,
	dot: IconCircleDot,
	planet: IconPlanet,
	crown: IconCrown,
	diamond: IconDiamond,
	rotate: IconRotate2,
	wind: IconWind,
}

export const DISCOVERY_ICON: Record<DiscoveryKind, Icon> = {
	ancient: IconEye,
	home: IconHome,
	telescope: IconTelescope,
	predicted: IconMathFunction,
}

/** The icons of a range's two ends: what the hot end and the cold end are. */
export const TEMPERATURE_ICON: Record<
	TemperatureRange,
	{ high: Icon; low: Icon }
> = {
	dayNight: { high: IconSun, low: IconMoon },
	extremes: { high: IconFlame, low: IconSnowflake },
	records: { high: IconFlame, low: IconSnowflake },
	cloudsCore: { high: IconFlame, low: IconCloud },
	cloudLevels: { high: IconCloud, low: IconSnowflake },
	surfaceCore: { high: IconFlame, low: IconSun },
	steady: { high: IconSunMoon, low: IconSunMoon },
}
