import { Canvas, useFrame } from '@react-three/fiber'
import { Center, Instance, Instances } from '@react-three/drei'
import { useRef } from 'react'
import * as THREE from 'three'

const COIN_COUNT = 6
const RADIUS = 1.8

function Coin({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null)

  useFrame(() => {
    if (ref.current) {
      ref.current.rotation.x += 0.012
      ref.current.rotation.y += 0.012
      ref.current.rotation.z += 0.012
    }
  })

  return (
    <group ref={ref} position={position}>
      <Instance />
    </group>
  )
}

function CoinsScene() {
  const groupRef = useRef<THREE.Group>(null!)

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.z -= 0.008
    }
  })

  const coins = Array.from({ length: COIN_COUNT }, (_, i) => {
    const angle = (i / COIN_COUNT) * Math.PI * 2
    return [
      Math.cos(angle) * RADIUS,
      Math.sin(angle) * RADIUS,
      0
    ] as [number, number, number]
  })

  return (
    <Center>
      <group ref={groupRef}>
        <Instances>
          <cylinderGeometry args={[0.7, 0.7, 0.15, 32]} />
          <meshNormalMaterial />
          {coins.map((pos, i) => (
            <Coin key={i} position={pos} />
          ))}
        </Instances>
      </group>
    </Center>
  )
}

export function CoinLoader() {
  return (
    <div className="w-[120px] h-[120px]">
      <Canvas
        camera={{ position: [0, 0, 6], fov: 50 }}
        gl={{ alpha: true, antialias: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <CoinsScene />
      </Canvas>
    </div>
  )
}
