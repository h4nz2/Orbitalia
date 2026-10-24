import { Suspense, type FC } from "react"

import { OrbitControls, PerspectiveCamera, Stats } from "@react-three/drei"
import { Canvas } from "@react-three/fiber"

import { useIsMobile } from "@/hooks/useIsMobile"
import { usePhone } from "@/hooks/useSizeClass"
import Sphere from "./Sphere"

export type SceneProps = {
	texture?: string
}

export const Scene: FC<SceneProps> = ({ texture }) => {
	const isMobile = useIsMobile()
	// a phone (#75): the globe has a box of its own above the facts, and fills more of it
	const phone = usePhone()
	return (
		<Canvas dpr={isMobile ? 1 : 2} gl={{ antialias: false }}>
			{/* camera and controls stay outside the Suspense so they are live from the first
			    frame; only the textured sphere waits for its download */}
			<PerspectiveCamera
				makeDefault
				position={[0, 0, phone ? 3.6 : 5]}
				fov={60}
			/>
			<Suspense fallback={null}>
				{texture ? <Sphere texture={texture} /> : null}
			</Suspense>
			<OrbitControls
				autoRotate
				autoRotateSpeed={2}
				enablePan={false}
				enableZoom={true}
				minDistance={3}
				maxDistance={8}
			/>
			{import.meta.env.DEV ? <Stats /> : null}
		</Canvas>
	)
}

export default Scene
