/**
 * The 3D scene runs but draws nothing (#76): an init script for a spec that
 * reads only the page's text and boxes, never the canvas's pixels. Every
 * WebGL context is made without antialiasing and its draw calls do nothing,
 * so software WebGL (swiftshader) skips the rasterising that is most of a
 * screen's time. Everything else runs as it does on screen: the frame loop,
 * the camera, the label layout that places the names from the camera's
 * projection, shader compiling and texture uploads. Only for a spec that
 * never looks at pixels; see docs/ARCHITECTURE.md, "Nothing overlaps".
 */
export const skipDrawing = () => {
	const WEBGL = ["webgl", "webgl2", "experimental-webgl"]
	const DRAWS = [
		"drawArrays",
		"drawElements",
		"drawArraysInstanced",
		"drawElementsInstanced",
		"drawRangeElements",
		// ANGLE_instanced_arrays
		"drawArraysInstancedANGLE",
		"drawElementsInstancedANGLE",
		// WEBGL_multi_draw and WEBGL_draw_instanced_base_vertex_base_instance
		"multiDrawArraysWEBGL",
		"multiDrawElementsWEBGL",
		"multiDrawArraysInstancedWEBGL",
		"multiDrawElementsInstancedWEBGL",
		"drawArraysInstancedBaseInstanceWEBGL",
		"drawElementsInstancedBaseVertexBaseInstanceWEBGL",
		"multiDrawArraysInstancedBaseInstanceWEBGL",
		"multiDrawElementsInstancedBaseVertexBaseInstanceWEBGL",
	]
	const noDraws = (target: object) => {
		const methods = target as Record<string, unknown>
		for (const name of DRAWS)
			if (typeof methods[name] === "function") methods[name] = () => undefined
	}
	const getContext = HTMLCanvasElement.prototype.getContext as (
		this: HTMLCanvasElement,
		kind: string,
		options?: object,
	) => RenderingContext | null
	HTMLCanvasElement.prototype.getContext = function (
		this: HTMLCanvasElement,
		kind: string,
		options?: object,
	) {
		return getContext.call(
			this,
			kind,
			WEBGL.includes(kind) ? { ...options, antialias: false } : options,
		)
	} as typeof HTMLCanvasElement.prototype.getContext
	for (const context of [WebGLRenderingContext, WebGL2RenderingContext]) {
		noDraws(context.prototype)
		// an extension's draws are its own object's: stubbed as it is handed out
		const getExtension = context.prototype.getExtension as (
			this: WebGLRenderingContext,
			name: string,
		) => object | null
		context.prototype.getExtension = function (
			this: WebGLRenderingContext,
			name: string,
		) {
			const extension = getExtension.call(this, name)
			if (extension !== null) noDraws(extension)
			return extension
		} as typeof context.prototype.getExtension
	}
}
