import React, { useState, Suspense, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { ApexModel } from './ApexModel';
import { useVoiceAssistant } from './useVoiceAssistant';
import './App.css';

const STATE_COLORS = {
  idle: '#3b82f6',
  listening: '#facc15',
  thinking: '#f97316',
  talking: '#10b981',
  wake: '#00d4ff',
};

// ============ DETECTOR DE CONTENIDO MEJORADO ============
const detectContentType = (text) => {
  if (!text) return 'text';

  // Bloques de código markdown
  if (text.includes('```')) return 'code';

  // Patrones de código comunes (def, function, const, import, etc.)
  const codeKeywords = /\b(def |function |const |let |var |class |import |from |return |print\(|console\.log|=> |if \(|for \(|while \()/;
  const codeSymbols = /[{}();]|=>|::|==/;
  if (codeKeywords.test(text) && codeSymbols.test(text)) return 'code';

  // Imágenes (markdown o URLs directas)
  if (text.match(/!\[.*\]\(.*\)/)) return 'image';
  if (text.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)/i)) return 'image';

  // Listas / datos
  if (text.match(/^[\-\*\d]+[\.\)]?\s/m)) return 'data';

  // Enlaces
  if (text.match(/https?:\/\/[^\s]+/)) return 'link';

  return 'text';
};

export default function App() {
  const [robotState, setRobotState] = useState('idle');
  const [inputText, setInputText] = useState('');
  const [responseMessage, setResponseMessage] = useState('');
  const [conversation, setConversation] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastTranscription, setLastTranscription] = useState('');
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [flash, setFlash] = useState(false);
  const [contentType, setContentType] = useState('text');

  const N8N_CHAT_URL = '/api-n8n/webhook/apex-core';

  // ============ DETECCIÓN MÓVIL ============
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 900);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // ============ RELOJ ============
  const [time, setTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  useEffect(() => {
    const interval = setInterval(() => {
      const d = new Date();
      setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // ============ AUDIO UNLOCK ============
  useEffect(() => {
    let unlocked = false;
    const unlockAudio = () => {
      if (unlocked) return;
      unlocked = true;
      if (window.speechSynthesis) {
        const silent = new SpeechSynthesisUtterance('');
        silent.volume = 0;
        silent.rate = 10;
        window.speechSynthesis.speak(silent);
      }
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume().then(() => ctx.close());
        else ctx.close();
      } catch (e) {}
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('click', unlockAudio);
    };
    document.addEventListener('touchstart', unlockAudio, { once: true });
    document.addEventListener('click', unlockAudio, { once: true });
    return () => {
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('click', unlockAudio);
    };
  }, []);

  // ============ TTS ============
  const speakResponse = useCallback((text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setTimeout(() => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-MX';
      u.rate = 1.0;
      u.pitch = 0.9;
      u.volume = 1.0;
      const trySpeak = () => {
        const voices = window.speechSynthesis.getVoices();
        const esp = voices.find(v => v.lang.startsWith('es'));
        if (esp) u.voice = esp;
        u.onstart = () => setRobotState('talking');
        u.onend = () => setRobotState('idle');
        u.onerror = () => setRobotState('idle');
        window.speechSynthesis.speak(u);
      };
      if (window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = () => {
          trySpeak();
          window.speechSynthesis.onvoiceschanged = null;
        };
      } else trySpeak();
    }, 100);
  }, []);

  // ============ ENVIAR A APEX ============
  const sendToApex = useCallback(async (text) => {
    if (!text || !text.trim()) return;
    setLoading(true);
    setRobotState('thinking');
    setLastTranscription(text);

    const newUserMsg = {
      role: 'user',
      text,
      time: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
    };
    setConversation(prev => [...prev, newUserMsg]);

    try {
      const res = await fetch(N8N_CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: 'user-001' }),
      });
      const data = await res.json();
      const reply = data.reply || data.output || data.text || 'Sin respuesta';
      setResponseMessage(reply);

      const newApexMsg = {
        role: 'apex',
        text: reply,
        time: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      };
      setConversation(prev => [...prev, newApexMsg]);

      const detected = detectContentType(reply);
      setContentType(detected);
      console.log('🎯 Tipo de contenido detectado:', detected);

      if (!isMobile) setLeftPanelOpen(true);
      if (detected !== 'text' && !isMobile) setRightPanelOpen(true);

      speakResponse(reply);
    } catch (err) {
      console.error(err);
      setResponseMessage('Error al conectar con Apex');
      setRobotState('idle');
    } finally {
      setLoading(false);
    }
  }, [speakResponse, isMobile]);

  // ============ VOICE ASSISTANT ============
  const { isAwake, isRecording, listening } = useVoiceAssistant({
    onTranscription: sendToApex,
  });

  // ============ FLASH AL DESPERTAR ============
  useEffect(() => {
    if (isAwake) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 500);
      return () => clearTimeout(t);
    }
  }, [isAwake]);

  // ============ DERIVAR ESTADO ============
  useEffect(() => {
    if (isRecording) setRobotState('thinking');
    else if (isAwake) {
      setRobotState('wake');
      const t = setTimeout(() => setRobotState('listening'), 2000);
      return () => clearTimeout(t);
    } else if (listening && !loading && robotState !== 'talking') {
      setRobotState('listening');
    }
  }, [isAwake, isRecording, listening, loading, robotState]);

  const statusLabel = {
    idle: '● EN ESPERA',
    listening: '● ESCUCHANDO',
    thinking: '● PROCESANDO',
    talking: '● RESPONDIENDO',
    wake: '● DESPERTANDO',
  }[robotState] || '● EN ESPERA';

  const statusColor = STATE_COLORS[robotState] || STATE_COLORS.idle;

  // ============ LÓGICA DE VISIBILIDAD ============
  const hasConversation = conversation.length > 0;
  const hasSpecialContent = contentType !== 'text' && responseMessage;

  const showRightPanel = !isMobile && hasSpecialContent && rightPanelOpen;

  // Robot se mueve solo si panel derecho está abierto
  const robotOffsetX = showRightPanel ? -0.9 : 0;
  const robotScale = showRightPanel ? 0.28 : 0.32;

  return (
    <div className="apex-container">
      <div className="apex-background">
        <div className="bg-grid"></div>
        <div className="bg-glow bg-glow-1"></div>
        <div className="bg-glow bg-glow-2"></div>
      </div>

      <Canvas
        camera={{ position: [0, 0.6, 5], fov: 45 }}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[5, 8, 5]} intensity={1.5} />
        <pointLight position={[-5, 2, -2]} intensity={0.6} color="#60a5fa" />
        <pointLight position={[5, 2, -2]} intensity={0.6} color={statusColor} />

        <Suspense fallback={null}>
          <AuraRing color={statusColor} pulse={robotState !== 'idle'} flash={flash} offsetX={robotOffsetX} />

          <ApexModel
            robotState={robotState}
            offsetX={robotOffsetX}
            scaleTarget={robotScale}
          />

          <ContactShadows position={[0, -1.5, 0]} opacity={0.5} scale={7} blur={2} />
        </Suspense>

        <OrbitControls
          enablePan={false}
          minDistance={2}
          maxDistance={7}
          maxPolarAngle={Math.PI / 2}
          enableZoom={!isMobile}
        />
      </Canvas>

      <div className="hud hud-top-left">
        <div className="hud-time">{time}</div>
        <div className="hud-version">APEX v0.4</div>
      </div>

      <div className="hud hud-top-right">
        <div className="hud-status" style={{ color: statusColor, textShadow: `0 0 10px ${statusColor}` }}>
          {statusLabel}
        </div>
      </div>

      <div className="hud hud-bottom-left">
        <div className="hud-mic">
          <span className={`mic-dot ${listening ? 'active' : ''}`}></span>
          MIC {listening ? 'ON' : 'OFF'}
        </div>
      </div>

      <div className="hud hud-bottom-right">
        {lastTranscription && (
          <div className="hud-transcription">"{lastTranscription.slice(0, 60)}"</div>
        )}
      </div>

      {/* Toggle IZQUIERDO */}
      {hasConversation && !isMobile && (
        <button
          className="panel-toggle panel-toggle-left"
          onClick={() => setLeftPanelOpen(!leftPanelOpen)}
        >
          {leftPanelOpen ? '◀' : '▶'}
        </button>
      )}

      {/* Toggle DERECHO */}
      {hasSpecialContent && !isMobile && (
        <button
          className="panel-toggle panel-toggle-right"
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
        >
          {rightPanelOpen ? '▶' : '◀'}
        </button>
      )}

      {/* Panel IZQUIERDO */}
      {hasConversation && (
        <div className={`panel panel-left ${leftPanelOpen ? 'open' : 'closed'}`}>
          <div className="panel-header">
            <span>💬 CONVERSACIÓN</span>
            <button className="panel-close" onClick={() => setLeftPanelOpen(false)}>×</button>
          </div>
          <div className="panel-content">
            {conversation.map((msg, i) => (
              <div key={i} className={`msg msg-${msg.role}`}>
                <div className="msg-header">
                  {msg.role === 'user' ? 'TÚ' : 'APEX'} · {msg.time}
                </div>
                <div className="msg-text">{msg.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Panel DERECHO */}
      {hasSpecialContent && (
        <div className={`panel panel-right ${rightPanelOpen ? 'open' : 'closed'}`}>
          <div className="panel-header">
            <span>{contentType === 'image' ? '🖼️ IMAGEN' : contentType === 'code' ? '💻 CÓDIGO' : contentType === 'data' ? '📊 DATOS' : contentType === 'link' ? '🔗 ENLACE' : '⚙ SISTEMA'}</span>
            <button className="panel-close" onClick={() => setRightPanelOpen(false)}>×</button>
          </div>
          <div className="panel-content">
            <div className="content-view">
              <div className="content-type-badge">{contentType.toUpperCase()}</div>
              <div className="content-body">{responseMessage}</div>
            </div>
          </div>
        </div>
      )}

      {/* Input inferior */}
      <div className="input-panel">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (inputText.trim()) {
              sendToApex(inputText);
              setInputText('');
            }
          }}
          className="input-form"
        >
          <input
            type="text"
            placeholder='Escribe o di "Nova" y habla...'
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={loading}
            className="input-field"
          />
          <button type="submit" disabled={loading} className="input-button">
            {loading ? '...' : 'Enviar'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============ AURA ============
function AuraRing({ color, pulse = false, flash = false, offsetX = 0 }) {
  const meshRef = React.useRef();

  React.useEffect(() => {
    if (!meshRef.current) return;
    let frame;
    let t = 0;
    const animate = () => {
      t += 0.05;
      if (meshRef.current) {
        const scale = flash ? 1.15 : pulse ? 1 + Math.sin(t) * 0.03 : 1;
        meshRef.current.scale.setScalar(scale);
        meshRef.current.material.opacity = flash ? 0.9 : pulse ? 0.45 + Math.sin(t) * 0.15 : 0.5;
      }
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, [pulse, flash]);

  React.useEffect(() => {
    if (!meshRef.current) return;
    let frame;
    const follow = () => {
      if (meshRef.current) {
        meshRef.current.position.x += (offsetX - meshRef.current.position.x) * 0.08;
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [offsetX]);

  return (
    <mesh ref={meshRef} position={[0, -0.85, 0]}>
      <ringGeometry args={[0.75, 0.82, 80]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.6}
        side={2}
        toneMapped={false}
      />
    </mesh>
  );
}