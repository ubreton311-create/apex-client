// ============ APEX CORE (ORBE HOLOGÁFICO) ============
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function ApexCore({
  state = 'idle',        // idle | thinking | talking | sleeping
  color = '#10b981',    // Esmeralda por defecto
  scale = 1,
  offsetX = 0,          // 🎯 NUEVO: Recibe la posición X (para moverse a los lados)
}) {
  const groupRef = useRef();
  const coreRef = useRef();
  const ring1Ref = useRef();
  const ring2Ref = useRef();
  const particlesRef = useRef();

  // ============ PARTÍCULAS ============
  const particles = useMemo(() => {
    const positions = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) {
      const radius = 2.0 + Math.random() * 1.0;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
    }
    return positions;
  }, []);

  // ============ COLORES ============
  const primaryColor = useMemo(() => new THREE.Color(color), [color]);
  const glowColor = useMemo(() => primaryColor.clone().multiplyScalar(1.5), [primaryColor]);

  // ============ ANIMACIÓN ============
  useFrame((s) => {
    if (!groupRef.current || !coreRef.current) return;

    const t = s.clock.getElapsedTime();
    const speed = {
      idle: 0.3, thinking: 1.5, talking: 0.8, sleeping: 0.1,
    }[state] || 0.3;

    // 🎯 Desplazamiento suave hacia los lados (Offset X)
    groupRef.current.position.x += (offsetX - groupRef.current.position.x) * 0.08;

    // Rotación principal (levitación)
    groupRef.current.rotation.y = t * speed * 0.2;
    const floatY = Math.sin(t * speed) * 0.1;
    groupRef.current.position.y = floatY;

    // Pulso del núcleo
    const pulse = {
      idle: 0.9 + Math.sin(t * 2) * 0.1,
      thinking: 1.0 + Math.sin(t * 6) * 0.2,
      talking: 1.0 + Math.sin(t * 8) * 0.3,
      sleeping: 0.6 + Math.sin(t * 1) * 0.05,
    }[state] || 1.0;
    coreRef.current.scale.setScalar(pulse);

    // Anillos giratorios
    if (ring1Ref.current) {
      ring1Ref.current.rotation.x = t * speed * 0.5;
      ring1Ref.current.rotation.y = t * speed * 0.3;
    }
    if (ring2Ref.current) {
      ring2Ref.current.rotation.x = -t * speed * 0.4;
      ring2Ref.current.rotation.z = t * speed * 0.6;
    }

    // Partículas
    if (particlesRef.current) {
      particlesRef.current.rotation.y = t * 0.2;
    }
  });

  return (
    <group ref={groupRef} scale={scale}>
      {/* NÚCLEO: Esfera interna brillante */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.7, 64, 64]} />
        <meshBasicMaterial color={glowColor} />
      </mesh>

      {/* ESFERA EXTERNA: Cristal con refracción (Efecto Premium) */}
      <mesh>
        <sphereGeometry args={[0.95, 64, 64]} />
        <meshPhysicalMaterial
          color={primaryColor}
          emissive={primaryColor}
          emissiveIntensity={0.4}
          metalness={0.2}
          roughness={0.05}
          transparent
          opacity={0.6}
          transmission={0.9} // Efecto de cristal real
          thickness={1.5}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ANILLO 1: Holográfico (más grueso y visible) */}
      <mesh ref={ring1Ref}>
        <torusGeometry args={[1.3, 0.03, 16, 100]} />
        <meshBasicMaterial color={glowColor} transparent opacity={0.8} />
      </mesh>

      {/* ANILLO 2: Más grande y sutil */}
      <mesh ref={ring2Ref}>
        <torusGeometry args={[1.6, 0.015, 16, 100]} />
        <meshBasicMaterial color={glowColor} transparent opacity={0.4} />
      </mesh>

      {/* HALO EXTERNO: Resplandor suave */}
      <mesh>
        <sphereGeometry args={[1.8, 32, 32]} />
        <meshBasicMaterial color={primaryColor} transparent opacity={0.05} side={THREE.BackSide} />
      </mesh>

      {/* PARTÍCULAS */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={particles.length / 3} array={particles} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial color={glowColor} size={0.06} transparent opacity={0.9} sizeAttenuation />
      </points>

      {/* LUCES INTERNAS (dan profundidad y brillo) */}
      <pointLight color={primaryColor} intensity={5} distance={10} />
      <pointLight color="#ffffff" intensity={2} distance={5} position={[1, 1, 1]} />
    </group>
  );
}