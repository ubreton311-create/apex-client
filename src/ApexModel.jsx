import React, { useRef, useEffect } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';

export function ApexModel({ talking = false }) {
  const group = useRef();
  const { scene, animations } = useGLTF('/models/apex.glb');
  const { actions } = useAnimations(animations, group);

  useEffect(() => {
    if (actions && Object.keys(actions).length > 0) {
      const idleAction = actions['Idle'] || Object.values(actions)[0];
      idleAction?.reset().fadeIn(0.5).play();
    }
  }, [actions]);

  useEffect(() => {
    if (!actions) return;
    const activeGesture = actions['Wave'] || actions['ThumbsUp'];
    const idleAction = actions['Idle'] || Object.values(actions)[0];

    if (talking && activeGesture) {
      idleAction?.fadeOut(0.2);
      activeGesture.reset().fadeIn(0.2).play();
    } else if (idleAction) {
      activeGesture?.fadeOut(0.2);
      idleAction.reset().fadeIn(0.2).play();
    }
  }, [talking, actions]);

  return (
    <primitive 
      ref={group} 
      object={scene} 
      position={[0, -1.1, 2.2]} 
      scale={0.4} 
    />
  );
}

useGLTF.preload('/models/apex.glb');
