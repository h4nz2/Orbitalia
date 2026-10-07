/**
 * Pure simulation code: units, time, the simulation clock, Kepler propagation,
 * hierarchy positions, axial rotation and spin speed. No React, no three.js. See docs/ARCHITECTURE.md.
 */
export {
	AU_KM,
	KM_PER_UNIT,
	SECONDS_PER_DAY,
	auToKm,
	kmToAu,
	toKm,
	toUnits,
} from "./units"
export {
	HOURS_PER_DAY,
	J2000_JD,
	MS_PER_DAY,
	UNIX_EPOCH_JD,
	dateToJD,
	daysBetween,
	jdToDate,
	secondsToDays,
} from "./time"
export {
	DEG_TO_RAD,
	KEPLER_MAX_ITERATIONS,
	KEPLER_TOLERANCE,
	RAD_TO_DEG,
	TWO_PI,
	degToRad,
	eclipticPositionAtEccentricAnomaly,
	eclipticToScene,
	meanAnomalyAt,
	orbitAt,
	orbitalPeriodToMeanMotion,
	positionAtEccentricAnomaly,
	propagate,
	propagateEcliptic,
	radToDeg,
	radius,
	sceneToEcliptic,
	solveEccentricAnomaly,
	trueAnomaly,
	wrapAngle,
} from "./kepler"
export type { MutableOrbitElements, OrbitElements, Vec3 } from "./kepler"
export {
	buildIndex,
	computePositions,
	relativePosition,
	relativeToOrigin,
} from "./positions"
export type { OrbitingBody, WritableVec3 } from "./positions"
export {
	DEFAULT_SCALE_PRESET,
	HIDES_LONG_TAIL,
	SCALE_PRESETS,
	SCALE_PRESET_IDS,
	TRUE_SCALE,
	anchorSpline,
	anchorWeightOf,
	anchoredDistance,
	childDistanceCurve,
	computeDisplayPositions,
	computeDisplayRadii,
	displayBodyLengthKm,
	displayDistanceKm,
	displayMoonRadiusKm,
	displayOffset,
	displayRadiusKm,
	distanceFactor,
	interpolateScale,
	isIdentityCurve,
	isScalePresetId,
	isTrueScale,
	isValidScale,
	mapDistance,
	moonSizeOf,
	presetOf,
	rootIndexOf,
	sameScale,
	sizeExaggeration,
	trueOffset,
	unmapDistance,
} from "./scale"
export type {
	AnchorSpline,
	DistanceAnchor,
	DistanceCurve,
	ScalableBody,
	ScaleFactor,
	ScalePresetId,
	ScaleSettings,
	SizeCurve,
} from "./scale"
export {
	OBLIQUITY_J2000_DEG,
	eclipticDirection,
	equatorNode,
	rotationAngle,
	spinAxis,
	synchronousAngle,
} from "./rotation"
export type { RotationElements } from "./rotation"
export {
	DEFAULT_SPIN_MODE,
	EARTH_SIDEREAL_DAY_DAYS,
	MAX_SPIN_STEP_MS,
	MIN_SECONDS_PER_EARTH_TURN,
	SPIN_MODES,
	advanceSpinClock,
	createSpinClock,
	isSpinMode,
	maxSpinStepDays,
} from "./spin"
export type { SpinClock, SpinMode } from "./spin"
export {
	GLIDE_MAX_MS,
	GLIDE_MIN_MS,
	INSTANT_JUMP_DAYS,
	MAX_FRAME_GAP_MS,
	createTimeline,
	easeInOutSine,
	glideDurationMs,
	glideTimeline,
	isGliding,
	jumpTimeline,
	retimeTimeline,
	settleTimeline,
	skipFrameGap,
	timelineJD,
} from "./clock"
export type { SimTimeline, TimeGlide } from "./clock"
export {
	MAX_OCCLUDERS,
	OCCLUDER_STRIDE,
	angleBetween,
	discOverlapArea,
	illuminatedFraction,
	occluderCandidates,
	phaseAngle,
	selectOccluders,
	sunVisibleFraction,
} from "./lighting"
export type { LitBody } from "./lighting"
export {
	RING_MIN_MU,
	ringShadowTransmittance,
	ringU,
	slantOpacity,
} from "./rings"
export {
	SCALE_LIES,
	bodyDistortion,
	isGridPreset,
	presetForLies,
} from "./scaleLies"
export type {
	BodyDistortion,
	DistanceLie,
	ScaleLies,
	SizeLie,
} from "./scaleLies"
