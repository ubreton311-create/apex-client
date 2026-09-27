import React, { useState, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { ApexModel } from './ApexModel';
import { useVoiceAssistant } from './useVoiceAssistant';
import './App.css';

export default function App() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [inputText, setInputText] = useState('');
  const [responseMessage, setResponseMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Di "Nova" para despertarme');

  const N8N_CHAT_URL = '/api-n8n/webhook/apex-core';

  // ============ ENVIAR TEXTO A APEX ============
  const sendToApex = async (text) => {
    if (!text || !text.trim()) return;
    setLoading(true);
    setStatus('Apex pensando...');
    try {
      const res = await fetch(N8N_CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: 'user-001' }),
      });
      const data = await res.json();
      const reply = data.reply || data.output || data.text || 'Sin respuesta';
      setResponseMessage(reply);
      setStatus('Di "Nova" para continuar');
      speakResponse(reply);
    } catch (err) {
      console.error(err);
      setStatus('Error al conectar con Apex');
    } finally {
      setLoading(false);
    }
  };

  // ============ SÍNTESIS DE VOZ ============
  const speakResponse = (text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-MX';
    utterance.rate = 1.0;
    utterance.pitch = 0.9;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  // ============ VOICE ASSISTANT (Wake word) ============
  const { isAwake, isRecording, listening } = useVoiceAssistant({
    onTranscription: sendToApex,
  });

  // Actualizar estado visual
  React.useEffect(() => {
    if (isRecording) setStatus('✉️ Enviando a Apex...');
    else if (isAwake) setStatus('🔴 Te escucho...');
    else if (listening) setStatus('Di "Nova" para despertarme');
  }, [isAwake, isRecording, listening]);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#111827' }}>
      <Canvas camera={{ position: [0, 1.5, 4.5], fov: 45 }} style={{ width: '100%', height: '100%' }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 5]} intensity={1.5} />
        <pointLight position={[-5, 2, -2]} intensity={0.5} color="#60a5fa" />
        <Suspense fallback={null}>
          <ApexModel talking={isSpeaking} />
          <ContactShadows position={[0, -1.1, 0]} opacity={0.6} scale={10} blur={1.5} />
        </Suspense>
        <OrbitControls enablePan={false} minDistance={2} maxDistance={7} maxPolarAngle={Math.PI / 2} />
      </Canvas>

      {/* Indicador de estado superior */}
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 20px',
        background: isRecording ? 'rgba(239, 68, 68, 0.9)' : isAwake ? 'rgba(250, 204, 21, 0.9)' : 'rgba(59, 130, 246, 0.9)',
        color: '#fff',
        borderRadius: '20px',
        fontSize: '14px',
        fontWeight: 600,
        transition: 'all 0.3s',
        zIndex: 10,
      }}>
        {status}
      </div>

      {/* Panel inferior - SOLO INPUT DE TEXTO */}
      <div style={{
        position: 'absolute',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '90%',
        maxWidth: '520px',
        background: 'rgba(17, 24, 39, 0.85)',
        backdropFilter: 'blur(10px)',
        padding: '16px',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        zIndex: 10,
      }}>
        {responseMessage && (
          <div style={{ fontSize: '14px', color: '#93c5fd', maxHeight: '80px', overflowY: 'auto' }}>
            <strong>Apex:</strong> {responseMessage}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (inputText.trim()) {
              sendToApex(inputText);
              setInputText('');
            }
          }}
          style={{ display: 'flex', gap: '8px' }}
        >
          <input
            type="text"
            placeholder='Escribe o di "Nova" y habla...'
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={loading}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #374151',
              background: '#1f2937',
              color: '#fff',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '10px 18px',
              borderRadius: '8px',
              border: 'none',
              background: loading ? '#4b5563' : '#2563eb',
              color: '#fff',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '...' : 'Enviar'}
          </button>
        </form>
      </div>
    </div>
  );
}