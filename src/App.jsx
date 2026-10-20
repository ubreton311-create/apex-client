import React, { useState, Suspense, useEffect, useCallback, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ApexCore } from './ApexCore';
import './App.css';

const STATE_COLORS = {
  idle: '#10b981', thinking: '#f59e0b', talking: '#3b82f6',
  sleeping: '#6366f1', listening: '#ef4444', standby: '#a855f7',
};

export default function App() {
  const [robotState, setRobotState] = useState('idle');
  const [inputText, setInputText] = useState('');
  const [conversation, setConversation] = useState([]);
  const [loading, setLoading] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isSleeping, setIsSleeping] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [showToast, setShowToast] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isStandby, setIsStandby] = useState(false);
  const [userName, setUserName] = useState(''); // 🎯 Nombre del usuario

  const fileInputRef = useRef(null);
  const conversationEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);
  
  const isStandbyRef = useRef(false);
  const isRecordingRef = useRef(false);
  const isSleepingRef = useRef(false);

  const APEX_API_URL = 'https://apex-orchestrator-production-da74.up.railway.app/ai/query';
  const WHISPER_API_URL = 'https://apex-orchestrator-production-da74.up.railway.app/voice/transcribe';

  const showToastMsg = (text, duration = 3500) => {
    setShowToast(text);
    setTimeout(() => setShowToast(null), duration);
  };

  useEffect(() => { isStandbyRef.current = isStandby; }, [isStandby]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isSleepingRef.current = isSleeping; }, [isSleeping]);

  // 🎯 DESBLOQUEO DE AUDIO
  useEffect(() => {
    let unlocked = false;
    const unlockAudio = () => {
      if (unlocked) return;
      unlocked = true;
      if (window.speechSynthesis) {
        const silent = new SpeechSynthesisUtterance('');
        silent.volume = 0;
        window.speechSynthesis.speak(silent);
      }
    };
    document.addEventListener('touchstart', unlockAudio, { once: true });
    document.addEventListener('click', unlockAudio, { once: true });
    return () => {
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('click', unlockAudio);
    };
  }, []);

  // 🎯 STANDBY: Solo escucha "Apex", no graba audio
  const startStandby = useCallback(() => {
    if (isSleepingRef.current) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToastMsg('Navegador no soporta Wake Word');
      return;
    }

    stopRecording();

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'es-MX';

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map(r => r[0].transcript).join('').toLowerCase();
      if (transcript.includes('apex') && isStandbyRef.current && !isRecordingRef.current) {
        showToastMsg('🎯 Apex activada');
        recognition.stop();
        setIsStandby(false);
        isStandbyRef.current = false;
        startRecording(true);
      }
    };

    recognition.onend = () => {
      // 🎯 Si el reconocimiento se apaga, NO reiniciar en bucle. Solo esperar interacción.
      if (isStandbyRef.current) {
        console.log('Standby apagado. Esperando activación manual.');
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsStandby(true);
      isStandbyRef.current = true;
      setRobotState('standby');
    } catch (err) {}
  }, []);

  const stopStandby = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsStandby(false);
    isStandbyRef.current = false;
  }, []);

  // 🎯 GRABACIÓN PESADA
  const startRecording = async (isFirstQuestion = false) => {
    if (isSleepingRef.current) return;
    stopStandby();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        
        if (audioBlob.size < 2000) {
          setRobotState('idle');
          showToastMsg('No se detectó voz');
          return;
        }

        const formData = new FormData();
        formData.append('audio', audioBlob, 'audio/webm');

        try {
          setRobotState('thinking');
          const res = await fetch(WHISPER_API_URL, { method: 'POST', body: formData });
          if (!res.ok) throw new Error(`Error ${res.status}`);
          const data = await res.json();
          
          if (data.text && data.text.trim().length > 0) {
            // 🎯 Enviar nombre de usuario si existe
            sendToApex(data.text, userName);
          } else {
            setRobotState('idle');
            showToastMsg('No se entendió el audio');
          }
        } catch (error) {
          showToastMsg(`⚠️ ${error.message}`);
          setRobotState('idle');
        }
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRobotState('listening');

      // VAD simple
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let silenceStart = Date.now();
      let hasSpoken = isFirstQuestion;
      
      const detectSilence = () => {
        if (mediaRecorder.state !== 'recording') return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        if ((sum / dataArray.length) > 15) {
          hasSpoken = true; silenceStart = Date.now();
        } else if (hasSpoken && Date.now() - silenceStart > 1800) {
          mediaRecorder.stop(); return;
        }
        requestAnimationFrame(detectSilence);
      };
      detectSilence();
    } catch (error) {
      showToastMsg('No se pudo acceder al micrófono');
      setRobotState('idle');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop();
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    setIsRecording(false);
  };

  // 🎯 HABLAR Y LUEGO SILENCIO TOTAL
  const speakResponse = useCallback((text) => {
    if (!window.speechSynthesis || isSleepingRef.current) return;
    
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-MX'; 
    u.rate = 1.0; 
    u.pitch = 1.0;
    u.volume = 1.0;

    const loadVoicesAndSpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(v => v.lang.startsWith('es') && v.name.includes('Google')) || 
                             voices.find(v => v.lang.startsWith('es') && v.name.includes('Microsoft')) ||
                             voices.find(v => v.lang.startsWith('es'));
      if (preferredVoice) u.voice = preferredVoice;

      u.onstart = () => setRobotState('talking');
      u.onend = () => {
        // 🎯 FIN DE CONVERSACIÓN: Apex se apaga. No vuelve a escuchar.
        setRobotState('idle');
        showToastMsg('👋 Apex en reposo. Di "Apex" o toca el Orbe.');
      };
      u.onerror = () => {
        setRobotState('idle');
        showToastMsg('👋 Apex en reposo.');
      };
      window.speechSynthesis.speak(u);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        loadVoicesAndSpeak();
        window.speechSynthesis.onvoiceschanged = null;
      };
    } else {
      loadVoicesAndSpeak();
    }
  }, []);

  // 🎯 ENVIAR A APEX (Con nombre de usuario)
  const sendToApex = useCallback(async (text, name = '') => {
    if (!text || !text.trim()) return;
    if (isSleeping) return;

    setLoading(true);
    setRobotState('thinking');
    const newUserMsg = { role: 'user', text: text, time: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) };
    setConversation(prev => [...prev, newUserMsg]);

    try {
      // 🎯 Incluir el nombre del usuario en el mensaje
      const messageWithName = name ? `El usuario se llama ${name}. ${text}` : text;
      const body = { message: messageWithName, sessionId: 'user-001' };
      
      const res = await fetch(APEX_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      const reply = data.reply || data.output || data.text || 'Sin respuesta';
      
      setConversation(prev => [...prev, { role: 'apex', text: reply, time: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) }]);
      
      if (!isMobile) setLeftPanelOpen(true);
      speakResponse(reply);
    } catch (err) {
      showToastMsg('Error al conectar con Apex');
      setRobotState('idle');
    } finally {
      setLoading(false);
    }
  }, [speakResponse, isMobile, isSleeping]);

  // 🎯 CONTROLES
  const handleOrbClick = () => {
    // Desbloquear audio
    if (window.speechSynthesis) {
      const silent = new SpeechSynthesisUtterance('');
      silent.volume = 0;
      window.speechSynthesis.speak(silent);
    }

    if (isSleeping) { setIsSleeping(false); startStandby(); return; }
    
    if (!isRecording && !isStandby) {
      showToastMsg('🎙️ Te escucho...');
      startRecording(false);
    } else {
      stopStandby(); stopRecording();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      setRobotState('idle');
      showToastMsg('🤫 Silencio');
    }
  };

  const toggleSleep = () => {
    const newState = !isSleeping;
    setIsSleeping(newState);
    if (newState) {
      stopStandby(); stopRecording();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      setRobotState('sleeping'); showToastMsg('😴 Apex descansando');
    } else { setRobotState('idle'); showToastMsg('👋 Apex despierta'); startStandby(); }
  };

  const submitForm = (e) => {
    e.preventDefault();
    if (!inputText.trim() && !attachedFile) return;
    sendToApex(inputText, userName);
    setInputText('');
    setAttachedFile(null);
  };

  const statusLabel = { 
    idle: '● EN REPOSO', thinking: '● PROCESANDO', talking: '● RESPONDIENDO', 
    sleeping: '● DORMIDO', listening: '● ESCUCHANDO...', standby: '● ESPERANDO "APEX"...'
  }[robotState] || '● EN REPOSO';

  return (
    <div className="apex-container">
      <div className="apex-background">
        <div className="bg-grid"></div>
        <div className="bg-glow bg-glow-1"></div>
        <div className="bg-glow bg-glow-2"></div>
      </div>

      <div className="hud hud-top-left">
        <div className="hud-time">{new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</div>
        <div className="hud-version">APEX v1.0</div>
      </div>

      <div className="hud hud-top-right">
        <div className="hud-status" style={{ color: STATE_COLORS[robotState], textShadow: `0 0 10px ${STATE_COLORS[robotState]}` }}>
          {statusLabel}
        </div>
        <button className={`sleep-btn ${isSleeping ? 'sleeping' : ''}`} onClick={toggleSleep}>
          {isSleeping ? '☀️ DESPERTAR' : '🌙 DORMIR'}
        </button>
      </div>

      <Canvas camera={{ position: [0, 0.6, 5], fov: 45 }} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
        <ambientLight intensity={0.9} />
        <directionalLight position={[5, 8, 5]} intensity={1.5} />
        <pointLight position={[-5, 2, -2]} intensity={0.6} color="#60a5fa" />
        <pointLight position={[5, 2, -2]} intensity={0.6} color={STATE_COLORS[robotState]} />
        <Suspense fallback={null}>
          <group onClick={handleOrbClick}>
            <mesh visible={false}><sphereGeometry args={[3, 16, 16]} /></mesh>
            <ApexCore state={robotState} color={STATE_COLORS[robotState]} scale={0.55} />
          </group>
        </Suspense>
        <OrbitControls enablePan={false} minDistance={2} maxDistance={7} maxPolarAngle={Math.PI / 2} />
      </Canvas>

      {showToast && <div className="toast-notification">{showToast}</div>}

      {conversation.length > 0 && !isMobile && (
        <>
          <button className="panel-toggle panel-toggle-left" onClick={() => setLeftPanelOpen(!leftPanelOpen)}>
            {leftPanelOpen ? '◀' : '▶'}
          </button>
          
          <div className={`panel panel-left ${leftPanelOpen ? 'open' : 'closed'}`}>
            <div className="panel-header">
              <div className="panel-tabs">
                <button className="panel-tab active">💬 Conversación</button>
              </div>
              <button className="panel-close" onClick={() => setLeftPanelOpen(false)}>×</button>
            </div>
            <div className="panel-content">
              {conversation.map((msg, i) => (
                <div key={i} className={`msg msg-${msg.role}`}>
                  <div className="msg-header">{msg.role === 'user' ? 'TÚ' : 'APEX'} · {msg.time}</div>
                  {msg.text && <div className="msg-text">{msg.text}</div>}
                </div>
              ))}
              <div ref={conversationEndRef} />
            </div>
          </div>
        </>
      )}

      <div className="input-panel">
        {attachedFile && (
          <div className="attachment-preview">
            <div className="attachment-icon">📎</div>
            <div className="attachment-info">
              <div className="attachment-name">{attachedFile.name}</div>
            </div>
            <button type="button" className="attachment-remove" onClick={() => setAttachedFile(null)}>×</button>
          </div>
        )}

        <form onSubmit={submitForm} className="input-form">
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={(e) => setAttachedFile(e.target.files[0])} />
          <button type="button" className="attach-btn" onClick={() => fileInputRef.current?.click()}>📎</button>
          <input type="text" placeholder={isSleeping ? '😴 Apex durmiendo' : 'Escribe aquí...'} value={inputText} onChange={(e) => setInputText(e.target.value)} disabled={loading || isRecording} className="input-field" />
          <button type="submit" disabled={loading || isRecording} className="input-button">Enviar</button>
        </form>
      </div>
    </div>
  );
}