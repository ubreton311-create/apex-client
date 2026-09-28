import { useEffect, useRef, useState } from 'react';

export function useVoiceAssistant({ onTranscription, onWakeWord, enabled = true, directMode = false }) {
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
  const enabledRef = useRef(enabled);
  const directModeRef = useRef(directMode);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    directModeRef.current = directMode;
    // Si activamos modo directo, resetear wake
    if (directMode) {
      wakeRef.current = true;
      setIsAwake(true);
      setListening(false);
    } else {
      wakeRef.current = false;
      setIsAwake(false);
      setListening(true);
    }
  }, [directMode]);

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
    } catch (err) {
      console.error('Beep error:', err);
    }
  };

  const beepWake = () => playBeep(880, 150);
  const beepSleep = () => playBeep(440, 250);

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

  const finalizeQuestion = (text) => {
    const clean = dedupe(text);

    if (!clean || clean.length < 3) {
      console.log('⚠️ Pregunta muy corta, ignorando:', clean);
      wakeRef.current = directModeRef.current;
      fullBufferRef.current = '';
      setIsAwake(directModeRef.current);
      setListening(!directModeRef.current);
      return;
    }

    console.log('✅ Pregunta final:', clean);
    beepSleep();
    setIsRecording(true);
    wakeRef.current = directModeRef.current;
    fullBufferRef.current = '';
    setIsAwake(directModeRef.current);

    onTranscription(clean);

    setTimeout(() => {
      setIsRecording(false);
      setListening(!directModeRef.current);
    }, 500);
  };

  const startRecognition = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.start();
    } catch (e) {}
  };

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('❌ Navegador no soporta reconocimiento de voz.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-MX';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      restartCountRef.current = 0;
      console.log('✅ Recognition iniciado');
    };

    recognition.onresult = (event) => {
      if (!enabledRef.current) return;

      let interimText = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript + ' ';
        else interimText += transcript;
      }

      const currentText = (finalText + interimText).toLowerCase().trim();
      if (!currentText) return;

      console.log('🎤 Escuchado:', currentText);

      lastSpokenTimeRef.current = Date.now();

      // MODO DIRECTO: siempre procesa
      if (directModeRef.current) {
        if (finalText) {
          const clean = finalText.trim();
          if (clean && clean.length > 2) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => {
              if (Date.now() - lastSpokenTimeRef.current >= 1500) {
                finalizeQuestion(clean);
              }
            }, 1800);
          }
        }
        return;
      }

      // MODO NOVA: espera wake word
      if (!wakeRef.current) {
        fullBufferRef.current = currentText;

        if (
          currentText.includes('nova') ||
          currentText.includes('noba') ||
          currentText.includes('no va') ||
          /\bno\s+va\b/.test(currentText)
        ) {
          console.log('✅ Wake word detectada');
          beepWake();
          wakeRef.current = true;
          setIsAwake(true);
          setListening(false);

          if (onWakeWord) onWakeWord();

          const parts = currentText.split(/nova|noba|no va/i);
          const afterNova = parts[parts.length - 1]?.trim() || '';
          fullBufferRef.current = afterNova && afterNova.length > 3 ? afterNova + ' ' : '';
        }
        return;
      }

      if (finalText) {
        const clean = finalText.replace(/nova|noba|no va/gi, '').trim();
        if (clean && clean.length > 2) {
          const bufferLower = fullBufferRef.current.toLowerCase();
          if (!bufferLower.includes(clean.toLowerCase())) {
            fullBufferRef.current += clean + ' ';
          }
        }
      }

      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        if (Date.now() - lastSpokenTimeRef.current >= 1800) {
          finalizeQuestion(fullBufferRef.current);
        }
      }, 2000);
    };

    recognition.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.error('❌ Recognition error:', e.error);
      }
    };

    recognition.onend = () => {
      if (wakeRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          if (fullBufferRef.current.trim()) {
            finalizeQuestion(fullBufferRef.current);
          }
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
  }, []);

  return {
    isAwake,
    isRecording,
    listening,
  };
}