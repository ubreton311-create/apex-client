import React, { useState, Suspense, useEffect, useCallback, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { ApexModel } from './ApexModel';
import './App.css';

const STATE_COLORS = {
  idle: '#3b82f6',
  thinking: '#f97316',
  talking: '#10b981',
  sleeping: '#1e3a8a',
};

const detectContentType = (text) => {
  if (!text) return 'text';
  if (text.includes('```')) return 'code';
  const codeKeywords = /\b(def |function |const |let |var |class |import |from |return |print\(|console\.log|=> |if \(|for \(|while \()/;
  const codeSymbols = /[{}();]|=>|::|==/;
  if (codeKeywords.test(text) && codeSymbols.test(text)) return 'code';
  if (text.match(/!\[.*\]\(.*\)/)) return 'image';
  if (text.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)/i)) return 'image';
  if (text.match(/^[\-\*\d]+[\.\)]?\s/m)) return 'data';
  if (text.match(/https?:\/\/[^\s]+/)) return 'link';
  return 'text';
};

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const compressImage = (file, maxWidth = 800, quality = 0.7) => {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            const newFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
              type: 'image/jpeg',
            });
            resolve(newFile);
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
};

export default function App() {
  const [robotState, setRobotState] = useState('idle');
  const [inputText, setInputText] = useState('');
  const [responseMessage, setResponseMessage] = useState('');
  const [conversation, setConversation] = useState([]);
  const [loading, setLoading] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [flash, setFlash] = useState(false);
  const [contentType, setContentType] = useState('text');
  const [isSleeping, setIsSleeping] = useState(false);
  const [leftTab, setLeftTab] = useState('chat');
  const [attachedFile, setAttachedFile] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [showToast, setShowToast] = useState(null);
  const fileInputRef = useRef(null);
  const conversationEndRef = useRef(null);

  const N8N_CHAT_URL = '/api-n8n/webhook/apex-core';

  const showToastMsg = (text, duration = 2500) => {
    setShowToast(text);
    setTimeout(() => setShowToast(null), duration);
  };

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 900);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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

  useEffect(() => {
    if (conversationEndRef.current) {
      conversationEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversation]);

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
    };
    document.addEventListener('touchstart', unlockAudio, { once: true });
    document.addEventListener('click', unlockAudio, { once: true });
    return () => {
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('click', unlockAudio);
    };
  }, []);

  const speakResponse = useCallback((text) => {
    if (!window.speechSynthesis || isSleeping) return;
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
        u.onend = () => setRobotState(isSleeping ? 'sleeping' : 'idle');
        u.onerror = () => setRobotState(isSleeping ? 'sleeping' : 'idle');
        window.speechSynthesis.speak(u);
      };
      if (window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = () => {
          trySpeak();
          window.speechSynthesis.onvoiceschanged = null;
        };
      } else trySpeak();
    }, 100);
  }, [isSleeping]);

  const toggleSleep = (forceState) => {
    const newState = typeof forceState === 'boolean' ? forceState : !isSleeping;
    setIsSleeping(newState);
    setRobotState(newState ? 'sleeping' : 'idle');
    if (newState) {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      showToastMsg('😴 Apex descansando');
    } else {
      setFlash(true);
      setTimeout(() => setFlash(false), 500);
      showToastMsg('👋 Apex despierta');
    }
  };

  const sendToApex = useCallback(async (text, file = null) => {
    if ((!text || !text.trim()) && !file) return;

    const lowerText = text.toLowerCase().trim();

    // Comandos con APEX
    if (/^(descansa|duerme|a dormir)\b/i.test(lowerText) || lowerText.includes('apex descansa') || lowerText.includes('apex duerme')) {
      setConversation(prev => [...prev, {
        role: 'user',
        text,
        time: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      }]);
      toggleSleep(true);
      return;
    }
    if (/^(despierta|activáte|activate)\b/i.test(lowerText) || lowerText.includes('apex despierta') || lowerText.includes('apex actívate')) {
      setConversation(prev => [...prev, {
        role: 'user',
        text,
        time: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      }]);
      toggleSleep(false);
      return;
    }

    if (isSleeping) {
      setConversation(prev => [...prev, {
        role: 'user',
        text: text + ' (Apex está dormida, escribe "despierta")',
        time: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      }]);
      return;
    }

    setLoading(true);
    setRobotState('thinking');

    const fileInfo = file ? { name: file.name, size: file.size, type: file.type } : null;
    const newUserMsg = {
      role: 'user',
      text: text || '',
      time: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      file: fileInfo,
    };
    setConversation(prev => [...prev, newUserMsg]);

    if (file) {
      setUploadedFiles(prev => [...prev, {
        name: file.name,
        size: file.size,
        type: file.type,
        time: newUserMsg.time,
      }]);
    }

    try {
      const body = {
        message: text || '',
        sessionId: 'user-001',
      };

      if (file) {
        const processedFile = await compressImage(file);
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(processedFile);
        });
        body.attachment = {
          name: processedFile.name,
          type: processedFile.type,
          size: processedFile.size,
          data: base64,
        };
      }

      const res = await fetch(N8N_CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

      if (!isMobile) setLeftPanelOpen(true);
      if (detected !== 'text' && !isMobile) setRightPanelOpen(true);

      speakResponse(reply);
    } catch (err) {
      console.error(err);
      setResponseMessage('Error al conectar con Apex');
      setRobotState(isSleeping ? 'sleeping' : 'idle');
    } finally {
      setLoading(false);
    }
  }, [speakResponse, isMobile, isSleeping]);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      showToastMsg(`Archivo muy grande (máx 5MB)`);
      e.target.value = '';
      return;
    }
    setAttachedFile(file);
  };

  const removeAttachment = () => {
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submitForm = (e) => {
    e.preventDefault();
    if (!inputText.trim() && !attachedFile) return;
    sendToApex(inputText, attachedFile);
    setInputText('');
    removeAttachment();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputText.trim() || attachedFile) {
        sendToApex(inputText, attachedFile);
        setInputText('');
        removeAttachment();
      }
    }
  };

  const statusLabel = {
    idle: '● EN ESPERA',
    thinking: '● PROCESANDO',
    talking: '● RESPONDIENDO',
    sleeping: '● DORMIDO',
  }[robotState] || '● EN ESPERA';

  const statusColor = STATE_COLORS[robotState] || STATE_COLORS.idle;

  const hasConversation = conversation.length > 0;
  const hasSpecialContent = contentType !== 'text' && responseMessage;

  const showRightPanel = !isMobile && hasSpecialContent && rightPanelOpen;

  const robotOffsetX = showRightPanel ? -0.9 : 0;
  const robotScale = showRightPanel ? 0.28 : 0.32;

  const inputPlaceholder = isSleeping
    ? '😴 Apex durmiendo — escribe "despierta"'
    : 'Escribe aquí...';

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
          <AuraRing
            color={statusColor}
            pulse={robotState !== 'idle' && robotState !== 'sleeping'}
            flash={flash}
            offsetX={robotOffsetX}
            dim={isSleeping}
          />

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
        <div className="hud-version">APEX v0.8</div>
      </div>

      <div className="hud hud-top-right">
        <div className="hud-status" style={{ color: statusColor, textShadow: `0 0 10px ${statusColor}` }}>
          {statusLabel}
        </div>
        <button
          className={`sleep-btn ${isSleeping ? 'sleeping' : ''}`}
          onClick={() => toggleSleep()}
          title={isSleeping ? 'Despertar' : 'Dormir'}
        >
          {isSleeping ? '☀️ DESPERTAR' : '🌙 DORMIR'}
        </button>
      </div>

      <div className="hud hud-bottom-left">
        <div className="hud-mode">
          {isSleeping ? '😴 DORMIDO' : '💬 MODO TEXTO'}
        </div>
      </div>

      {showToast && (
        <div className="toast-notification">{showToast}</div>
      )}

      {(hasConversation || uploadedFiles.length > 0) && !isMobile && (
        <button
          className="panel-toggle panel-toggle-left"
          onClick={() => setLeftPanelOpen(!leftPanelOpen)}
        >
          {leftPanelOpen ? '◀' : '▶'}
        </button>
      )}

      {hasSpecialContent && !isMobile && (
        <button
          className="panel-toggle panel-toggle-right"
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
        >
          {rightPanelOpen ? '▶' : '◀'}
        </button>
      )}

      {(hasConversation || uploadedFiles.length > 0) && (
        <div className={`panel panel-left ${leftPanelOpen ? 'open' : 'closed'}`}>
          <div className="panel-header">
            <div className="panel-tabs">
              <button
                className={`panel-tab ${leftTab === 'chat' ? 'active' : ''}`}
                onClick={() => setLeftTab('chat')}
                title="Conversación"
              >
                💬
              </button>
              <button
                className={`panel-tab ${leftTab === 'history' ? 'active' : ''}`}
                onClick={() => setLeftTab('history')}
                title="Historial"
              >
                📜
              </button>
              <button
                className={`panel-tab ${leftTab === 'files' ? 'active' : ''}`}
                onClick={() => setLeftTab('files')}
                title="Archivos"
              >
                📎
              </button>
            </div>
            <button className="panel-close" onClick={() => setLeftPanelOpen(false)}>×</button>
          </div>

          <div className="panel-content">
            {leftTab === 'chat' && (
              <>
                {conversation.length === 0 ? (
                  <div className="panel-empty">Sin conversación aún...</div>
                ) : (
                  <>
                    {conversation.map((msg, i) => (
                      <div key={i} className={`msg msg-${msg.role}`}>
                        <div className="msg-header">
                          {msg.role === 'user' ? 'TÚ' : 'APEX'} · {msg.time}
                        </div>
                        {msg.file && (
                          <div className="msg-file">📎 {msg.file.name}</div>
                        )}
                        {msg.text && !msg.text.startsWith('📎 ') && (
                          <div className="msg-text">{msg.text}</div>
                        )}
                      </div>
                    ))}
                    <div ref={conversationEndRef} />
                  </>
                )}
              </>
            )}

            {leftTab === 'history' && (
              <div className="panel-empty">
                📜 Historial de sesiones<br/>
                <span style={{ fontSize: '10px', opacity: 0.5 }}>Próximamente</span>
              </div>
            )}

            {leftTab === 'files' && (
              <>
                {uploadedFiles.length === 0 ? (
                  <div className="panel-empty">Sin archivos subidos</div>
                ) : (
                  uploadedFiles.map((f, i) => (
                    <div key={i} className="file-item">
                      <div className="file-icon">{f.type.startsWith('image') ? '🖼️' : f.type.includes('pdf') ? '📕' : f.type.includes('audio') ? '🎵' : '📄'}</div>
                      <div className="file-info">
                        <div className="file-name">{f.name}</div>
                        <div className="file-meta">{(f.size / 1024).toFixed(1)} KB · {f.time}</div>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      )}

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

      <div className="input-panel">
        {attachedFile && (
          <div className="attachment-preview">
            <div className="attachment-icon">
              {attachedFile.type.startsWith('image') ? '🖼️' : attachedFile.type.includes('pdf') ? '📕' : attachedFile.type.includes('audio') ? '🎵' : '📄'}
            </div>
            <div className="attachment-info">
              <div className="attachment-name">{attachedFile.name}</div>
              <div className="attachment-size">{(attachedFile.size / 1024).toFixed(1)} KB</div>
            </div>
            <button type="button" className="attachment-remove" onClick={removeAttachment}>×</button>
          </div>
        )}

        <form onSubmit={submitForm} className="input-form">
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileSelect}
            accept="image/*,application/pdf,text/plain,.doc,.docx,.csv,audio/*,video/*"
          />
          <button
            type="button"
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Adjuntar archivo"
          >
            📎
          </button>
          <input
            type="text"
            placeholder={inputPlaceholder}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
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

function AuraRing({ color, pulse = false, flash = false, offsetX = 0, dim = false }) {
  const meshRef = React.useRef();

  React.useEffect(() => {
    if (!meshRef.current) return;
    let frame;
    let t = 0;
    const animate = () => {
      t += 0.05;
      if (meshRef.current) {
        const scale = flash ? 1.15 : pulse ? 1 + Math.sin(t) * 0.03 : 1;
        const baseOpacity = dim ? 0.15 : 0.6;
        meshRef.current.scale.setScalar(scale);
        meshRef.current.material.opacity = flash ? 0.9 : pulse ? 0.45 + Math.sin(t) * 0.15 : baseOpacity;
      }
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, [pulse, flash, dim]);

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