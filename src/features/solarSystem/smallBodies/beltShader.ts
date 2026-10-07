/**
 * GLSL of the belt dots (#23). Every dot is moved on the GPU on its own Kepler orbit
 * (the twin of `beltDotPositionKm` in src/sim/belts.ts) and drawn with the scale
 * engine's rule for a child of the root (`displayOffset` with `orbitDistance`, the
 * planets' rule), plus the anchored reference frames (#31) the way
 * `applyReferenceFrame` / `mapTruePointKm` move a body there. So the belt stays where
 * the planets and the named asteroids are drawn, in every preset and frame.
 *
 * Positions are float32 here; the dots are markers of where a belt's members are, so
 * a few hundred km of rounding on an orbit of hundreds of millions of km never shows.
 */
import { FRAME_BLEND_SLOTS } from "../scene/simFrame"

/** Nodes of an anchored orbitDistance curve the shader takes: the knee and up to 11 anchors (Poster has 8). */
export const BELT_SPLINE_NODES = 12

export const beltVertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

#define BELT_FRAME_SLOTS ${FRAME_BLEND_SLOTS}
#define BELT_SPLINE_NODES ${BELT_SPLINE_NODES}

// per dot: semi-major axis (km), eccentricity, mean motion (rad/day), mean anomaly at J2000 (rad)
attribute vec4 aOrbit;
attribute vec3 aPeriapsis;
attribute vec3 aAhead;

uniform float uDays;
// the root's drawn position relative to the render origin (scene units)
uniform vec3 uRootRender;
uniform float uRootRadiusKm;
// the orbitDistance curve: knee, exponent, gain (the power law)
uniform vec3 uCurve;
// its anchored part (#54, Poster; anchoredDistance in src/sim/scale.ts): the share
// (0: the power law alone), the nodes (log true distance, drawn distance, slope)
// and the last one, which the curve goes on from in a straight line
uniform float uSplineShare;
uniform int uSplineCount;
uniform float uSplineU[BELT_SPLINE_NODES];
uniform float uSplineY[BELT_SPLINE_NODES];
uniform float uSplineM[BELT_SPLINE_NODES];
uniform vec3 uSplineEnd;
uniform vec3 uAnchorRender[BELT_FRAME_SLOTS];
uniform vec3 uAnchorTrue[BELT_FRAME_SLOTS];
uniform float uAnchorWeight[BELT_FRAME_SLOTS];
uniform float uPointSize;

// the monotone cubic through the nodes, in the log of the distance (x > knee)
float beltSpline(float x) {
	float v = log(x);
	if (v >= uSplineEnd.x) return uSplineEnd.y + uSplineEnd.z * (v - uSplineEnd.x);
	for (int k = 0; k < BELT_SPLINE_NODES - 1; k++) {
		if (k + 1 >= uSplineCount) break;
		if (v < uSplineU[k + 1]) {
			float h = uSplineU[k + 1] - uSplineU[k];
			float t = (v - uSplineU[k]) / h;
			float t2 = t * t;
			float t3 = t2 * t;
			return (2.0 * t3 - 3.0 * t2 + 1.0) * uSplineY[k]
				+ (t3 - 2.0 * t2 + t) * h * uSplineM[k]
				+ (-2.0 * t3 + 3.0 * t2) * uSplineY[k + 1]
				+ (t3 - t2) * h * uSplineM[k + 1];
		}
	}
	return uSplineEnd.y;
}

// displayOffset of a true offset (km) around a body of the root's size, display km
vec3 beltMapped(vec3 v) {
	float d = length(v);
	if (d <= 0.0) return vec3(0.0);
	float x = d / uRootRadiusKm;
	float knee = uCurve.x;
	float f = x <= knee ? x : knee * (1.0 + uCurve.z * (pow(x / knee, uCurve.y) - 1.0));
	if (x > knee && uSplineShare > 0.0) {
		float s = beltSpline(x);
		f = uSplineShare >= 1.0 ? s : pow(f, 1.0 - uSplineShare) * pow(s, uSplineShare);
	}
	return v * (uRootRadiusKm * f / d);
}

void main() {
	float e = aOrbit.y;
	float M = mod(aOrbit.w + aOrbit.z * uDays, 6.283185307179586);
	float E = e < 0.8 ? M : PI;
	for (int k = 0; k < 8; k++) {
		E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
	}
	vec3 p = aOrbit.x * ((cos(E) - e) * aPeriapsis + sqrt(1.0 - e * e) * sin(E) * aAhead);
	vec3 heliocentric = uRootRender + beltMapped(p) * 0.001;
	vec3 position = heliocentric;
	for (int k = 0; k < BELT_FRAME_SLOTS; k++) {
		float w = uAnchorWeight[k];
		if (w > 0.0) {
			position += w * (uAnchorRender[k] + beltMapped(p - uAnchorTrue[k]) * 0.001 - heliocentric);
		}
	}
	vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
	gl_Position = projectionMatrix * mvPosition;
	gl_PointSize = uPointSize;
	#include <logdepthbuf_vertex>
}
`

export const beltFragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uColor;
uniform float uOpacity;

void main() {
	#include <logdepthbuf_fragment>
	float r = length(gl_PointCoord - 0.5) * 2.0;
	float alpha = uOpacity * clamp(0.5 + (1.0 - r) / max(fwidth(r), 1e-3), 0.0, 1.0);
	if (alpha <= 0.0) discard;
	gl_FragColor = vec4(uColor, alpha);
}
`
