import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { socket } from '../api/socket';

const AssistantContext = createContext(null);

const DANCE_KEYWORDS = ['танцуй', 'танец', 'потанцуй', 'станцуй', 'dance', 'танцевать', 'пляши'];

const STORAGE_KEY_INPUT = 'kana_audio_input_device';
const STORAGE_KEY_OUTPUT = 'kana_audio_output_device';
const STORAGE_KEY_NOISE = 'kana_noise_suppression';

function getStoredAudioSettings() {
  try {
    const inputRaw = localStorage.getItem(STORAGE_KEY_INPUT);
    const outputRaw = localStorage.getItem(STORAGE_KEY_OUTPUT);
    const input = inputRaw ? JSON.parse(inputRaw) : null;
    const output = outputRaw ? JSON.parse(outputRaw) : null;
    return {
      inputDevice: input && typeof input === 'object' ? { index: input.index, name: input.name } : { index: null, name: '' },
      outputDevice: output && typeof output === 'object' ? { index: output.index, name: output.name } : { index: null, name: '' },
      noiseSuppression: localStorage.getItem(STORAGE_KEY_NOISE) !== 'false',
    };
  } catch {
    return { inputDevice: { index: null, name: '' }, outputDevice: { index: null, name: '' }, noiseSuppression: true };
  }
}

export function AssistantProvider({ children }) {
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [statusMessage, setStatusMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [error, setError] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [audioSettings, setAudioSettings] = useState(getStoredAudioSettings);
  const [sentenceEnded, setSentenceEnded] = useState(false);
  const [danceRequested, setDanceRequested] = useState(false);
  const updateTimeoutRef = useRef(null);
  const audioLevelRef = useRef(0);
  const wasAssistantSpeakingRef = useRef(false);
  const SPEAKING_THRESHOLD = 0.02;
  const SMOOTHING = 0.35;

  useEffect(() => {
    socket.on('connect', () => setConnectionStatus('connected'));
    socket.on('disconnect', () => setConnectionStatus('disconnected'));
    socket.on('status', (data) => {
      setStatusMessage(data?.msg || '');
      if (data?.msg === 'KANA Started') setIsListening(true);
      if (data?.msg === 'KANA Stopped') setIsListening(false);
    });
    socket.on('transcription', (data) => {
      if (!data?.sender || !data?.text) return;
      
      // Очищаем предыдущий таймер
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      
      // Detect dance keywords in user messages
      if (data.sender === 'User') {
        const lower = data.text.toLowerCase();
        if (DANCE_KEYWORDS.some((k) => lower.includes(k))) {
          setDanceRequested(true);
        }
      }
      
      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1];
        
        // Если последнее сообщение от того же отправителя, обновляем его
        if (lastMessage && lastMessage.sender === data.sender) {
          return [...prev.slice(0, -1), { 
            sender: data.sender, 
            text: lastMessage.text + data.text 
          }];
        }
        
        // Иначе добавляем новое сообщение
        return [...prev, { sender: data.sender, text: data.text }];
      });
      
      // Устанавливаем таймер для финализации сообщения (если нет новых обновлений 500мс)
      updateTimeoutRef.current = setTimeout(() => {
        // Можно добавить логику для финализации, если нужно
        updateTimeoutRef.current = null;
      }, 1000);
    });
    socket.on('audio_data', (payload) => {
      const raw = payload?.data;
      if (!raw || !Array.isArray(raw) || raw.length < 2) return;
      const bytes = new Uint8Array(raw);
      const samples = new Int16Array(bytes.buffer);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        const n = samples[i] / 32768;
        sum += n * n;
      }
      const rms = Math.sqrt(sum / samples.length);
      const normalized = Math.min(1, rms * 4);
      const smoothed = audioLevelRef.current * (1 - SMOOTHING) + normalized * SMOOTHING;
      audioLevelRef.current = smoothed;
      setAudioLevel(smoothed);
      
      const isSpeakingNow = smoothed > SPEAKING_THRESHOLD;
      setIsAssistantSpeaking(isSpeakingNow);
      
      // Detect sentence end: speaking stopped
      if (wasAssistantSpeakingRef.current && !isSpeakingNow) {
        setSentenceEnded(true);
      }
      wasAssistantSpeakingRef.current = isSpeakingNow;
    });
    socket.on('error', (data) => setError(data?.msg || 'Error'));

    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      socket.off('connect');
      socket.off('disconnect');
      socket.off('status');
      socket.off('transcription');
      socket.off('audio_data');
      socket.off('error');
    };
  }, []);

  const startAudio = useCallback((deviceOverrides) => {
    setError(null);
    const input = deviceOverrides?.inputDevice ?? audioSettings.inputDevice;
    const output = deviceOverrides?.outputDevice ?? audioSettings.outputDevice;
    const payload = { muted: isMuted };
    if (input?.index != null) {
      payload.device_index = input.index;
    } else if (input?.name) {
      payload.device_name = input.name;
    }
    if (output?.index != null) {
      payload.output_device_index = output.index;
    } else if (output?.name) {
      payload.output_device_name = output.name;
    }
    socket.emit('start_audio', payload);
  }, [isMuted, audioSettings]);

  const stopAudio = useCallback(() => {
    socket.emit('stop_audio');
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((m) => !m);
    if (isListening) {
      socket.emit(isMuted ? 'resume_audio' : 'pause_audio');
    }
  }, [isListening, isMuted]);

  const sendText = useCallback((text) => {
    if (!text?.trim()) return;
    setMessages((prev) => [...prev, { sender: 'User', text: text.trim() }]);
    socket.emit('user_input', { text: text.trim() });
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const clearSentenceEnded = useCallback(() => setSentenceEnded(false), []);
  const clearDanceRequested = useCallback(() => setDanceRequested(false), []);

  const value = {
    connectionStatus,
    statusMessage,
    messages,
    isListening,
    isMuted,
    error,
    audioLevel,
    isAssistantSpeaking,
    audioSettings,
    setAudioSettings,
    sentenceEnded,
    clearSentenceEnded,
    danceRequested,
    clearDanceRequested,
    startAudio,
    stopAudio,
    toggleMute,
    sendText,
    clearError,
  };

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant() {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error('useAssistant must be used within AssistantProvider');
  return ctx;
}
