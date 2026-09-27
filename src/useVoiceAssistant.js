import { useEffect, useRef, useState } from 'react';

export function useVoiceAssistant({ onTranscription }) {
  const [isAwake, setIsAwake] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [listening, setListening] = useState(false);

  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const wakeRef = useRef(false);
  const fullBufferRef = useRef('');
  const lastSpokenTimeRef = useRef(Date.now());
  const restartCountRef = useRef(0);
  const audioCtxRef = useRef(null);

  // ============ BEEPS (FIX MÓVIL) ============
  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const playBeep = (freq, duration, volume = 0.15) => {
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.value = volume;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration / 1000);
      // ⚠️ NO cerrar el contexto (reutilizar)
    } catch (err) {
      console.error('Beep error:', err);
    }
  };

  const beepWake = () => playBeep(880, 150);
  const beepSleep = () => playBeep(440, 250);

  // ============ UTILIDADES ============
  const dedupe = (text) => {
    if (!text) return '';
    let clean = text.replace(/\b(nova|noba|no va|no\s+va)\b/gi, '').trim();

    for (let i = 0; i < 5; i++) {
      clean = clean.replace(/\b((?:\w+\s+){0,5}\w+)(?:\s+\1\b)+/gi, '$1');
    }

    clean = clean.replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1');
    clean = clean.replace(/\s+/g, ' ').trim();

    if (clean.length > 300) clean = clean.slice(0, 300);

    return clean;
  };

  // ============ FINALIZAR PREGUNTA ============
  const finalizeQuestion = (text) => {
    const clean = dedupe(text);

    if (!clean || clean.length < 2) {
      console.log('⚠️ Pregunta vacía, reiniciando');
      wakeRef.current = false;
      fullBufferRef.current = '';
      setIsAwake(false);
      setListening(true);
      return;
    }

    console.log('✅ Pregunta final (limpia):', clean);
    beepSleep();
    setIsRecording(true);
    wakeRef.current = false;
    fullBufferRef.current = '';
    setIsAwake(false);

    onTranscription(clean);

    setTimeout(() => {
      setIsRecording(false);
      setListening(true);
    }, 500);
  };

  // ============ START/RESTART RECOGNITION ============
  const startRecognition = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.start();
    } catch (e) {
      // Ya está corriendo
    }
  };

  // ============ RECOGNITION ============
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('Navegador no soporta reconocimiento de voz.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-MX';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      restartCountRef.current = 0;
      console.log('✅ Recognition iniciado correctamente');
    };

    recognition.onresult = (event) => {
      let interimText = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += transcript + ' ';
        } else {
          interimText += transcript;
        }
      }

      const currentText = (finalText + interimText).toLowerCase().trim();
      if (!currentText) return;

      lastSpokenTimeRef.current = Date.now();

      // ========== MODO 1: ESPERANDO "NOVA" ==========
      if (!wakeRef.current) {
        fullBufferRef.current = currentText;
        console.log('👂 Buffer actual:', fullBufferRef.current);

        if (
          currentText.includes('nova') ||
          currentText.includes('noba') ||
          currentText.includes('no va') ||
          /\bno\s+va\b/.test(currentText)
        ) {
          console.log('✅ Wake word detectada: NOVA');
          beepWake();
          wakeRef.current = true;
          setIsAwake(true);
          setListening(false);

          const parts = currentText.split(/nova|noba|no va/i);
          const afterNova = parts[parts.length - 1]?.trim() || '';
          fullBufferRef.current = afterNova && afterNova.length > 3 ? afterNova + ' ' : '';

          if (afterNova.length > 3) {
            console.log('📝 Capturado tras Nova:', afterNova);
          }
        }
        return;
      }

      // ========== MODO 2: GRABANDO PREGUNTA ==========
      if (finalText) {
        const clean = finalText.replace(/nova|noba|no va/gi, '').trim();
        if (clean && clean.length > 2) {
          const bufferLower = fullBufferRef.current.toLowerCase();
          if (!bufferLower.includes(clean.toLowerCase())) {
            fullBufferRef.current += clean + ' ';
            console.log('🔴 Pregunta en curso:', fullBufferRef.current);
          }
        }
      }

      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        if (Date.now() - lastSpokenTimeRef.current >= 1800) {
          console.log('⏱️ Silencio detectado, finalizando');
          finalizeQuestion(fullBufferRef.current);
        }
      }, 2000);
    };

    recognition.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.error('Recognition error:', e.error);
      }
    };

    recognition.onend = () => {
      console.log('🔇 Recognition ended, reiniciando...');

      if (wakeRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          finalizeQuestion(fullBufferRef.current);
        }, 1500);
      }

      restartCountRef.current += 1;
      const delay = restartCountRef.current > 5 ? 1000 : 200;
      setTimeout(() => startRecognition(), delay);
    };

    recognitionRef.current = recognition;

    setTimeout(() => {
      try {
        recognition.start();
        setListening(true);
        console.log('👂 Escuchando...');
      } catch (e) {}
    }, 500);

    return () => {
      try { recognition.stop(); } catch (e) {}
      clearTimeout(silenceTimerRef.current);
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch (e) {}
      }
    };
    // eslint-disable-next-line
  }, []);

  return {
    isAwake,
    isRecording,
    listening,
  };
}