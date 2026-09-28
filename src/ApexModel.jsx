import React, { useRef, useEffect, useMemo } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';

export function ApexModel({ robotState = 'idle', offsetX = 0, scaleTarget = 0.32 }) {
  const group = useRef();
  const { scene, animations } = useGLTF('/models/apex.glb');
  const { actions } = useAnimations(animations, group);

  const STATE_TO_ANIM = useMemo(() => ({
    idle: 'Idle',
    listening: 'Idle',
    thinking: 'Standing',
    talking: 'Yes',
    wake: 'Wave',
  }), []);

  // Cambio de animación según estado
  useEffect(() => {
    if (!actions || Object.keys(actions).length === 0) return;
    const animName = STATE_TO_ANIM[robotState] || 'Idle';
    const targetAction = actions[animName] || actions['Idle'];

    Object.values(actions).forEach(action => {
      if (action && action !== targetAction) action.fadeOut(0.3);
    });

    if (targetAction) targetAction.reset().fadeIn(0.3).play();
  }, [robotState, actions, STATE_TO_ANIM]);

  // Animación inicial
  useEffect(() => {
    if (actions && Object.keys(actions).length > 0) {
      const idleAction = actions['Idle'] || Object.values(actions)[0];
      idleAction?.reset().fadeIn(0.5).play();
    }
  }, [actions]);

  // Animación dinámica: bobbing + posición + escala
  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.getElapsedTime();

    let bobbingY = 0;
    let rotZ = 0;
    if (robotState === 'talking') {
      bobbingY = Math.sin(t * 8) * 0.015;
      rotZ = Math.sin(t * 4) * 0.015;
    } else if (robotState === 'wake') {
      bobbingY = Math.abs(Math.sin(t * 3)) * 0.02;
    }

    const targetX = offsetX;
    const targetY = -0.85 + bobbingY;
    const targetScale = scaleTarget;

    group.current.position.x += (targetX - group.current.position.x) * 0.08;
    group.current.position.y += (targetY - group.current.position.y) * 0.15;
    group.current.scale.x += (targetScale - group.current.scale.x) * 0.08;
    group.current.scale.y += (targetScale - group.current.scale.y) * 0.08;
    group.current.scale.z += (targetScale - group.current.scale.z) * 0.08;
    group.current.rotation.z += (rotZ - group.current.rotation.z) * 0.1;
  });

  return (
    <primitive
      ref={group}
      object={scene}
      position={[0, -0.85, 0]}
      scale={0.32}
    />
  );
}

useGLTF.preload('/models/apex.glb');