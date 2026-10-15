/**
 * Whether the camera is moving right now (#42): dragged, zoomed, panned or
 * flown. The quiet interface dims its secondary controls meanwhile and brings
 * them back the moment the camera stops; there is no idle timer.
 *
 * "Moving" is the camera's pose round its pivot (distance, azimuth, polar
 * angle) changing from one frame to the next, or a transition running (a
 * flight, a tour's move, a re-centre). A camera that follows a planet round
 * the Sun while time runs keeps its pose round the planet and so counts as
 * still: nothing dims just because time is running. The distance it is given
 * is a multiple of the framing (`CameraDirector.framingDistance`), so the
 * camera backing off to keep a planet whole in a smaller band (#61: a phone's
 * sheet rising, #60) counts as still too: the panel just opened never dims.
 */

/** The camera's pose round its pivot: camera-controls' distance and angles. */
export interface PivotPose {
	readonly distance: number
	readonly azimuth: number
	readonly polar: number
}

/** How long the camera must stay still before the controls come back, ms (hides one-frame gaps in a drag). */
export const MOTION_SETTLE_MS = 180

/** Relative distance change and angle change (radians) below which a frame counts as still. */
const DISTANCE_EPSILON = 1e-4
const ANGLE_EPSILON = 1e-4

export class MotionWatch {
	private distance = Number.NaN
	private azimuth = Number.NaN
	private polar = Number.NaN
	private movedAt = -Infinity

	/**
	 * One frame: `now` in ms, the pose after the camera's update, and whether a
	 * transition is running. Returns whether the camera counts as moving.
	 * Allocates nothing: it runs every frame.
	 */
	update(now: number, pose: PivotPose, transitioning: boolean): boolean {
		const changed =
			!Number.isNaN(this.distance) &&
			(Math.abs(pose.distance - this.distance) >
				DISTANCE_EPSILON * Math.max(Math.abs(this.distance), 1e-9) ||
				Math.abs(pose.azimuth - this.azimuth) > ANGLE_EPSILON ||
				Math.abs(pose.polar - this.polar) > ANGLE_EPSILON)
		this.distance = pose.distance
		this.azimuth = pose.azimuth
		this.polar = pose.polar
		if (changed || transitioning) this.movedAt = now
		return now - this.movedAt < MOTION_SETTLE_MS
	}
}
