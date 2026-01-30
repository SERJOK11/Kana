import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { socket } from '../api/socket';

const AssistantContext = createContext(null);

export function AssistantProvider({ children }) {
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [statusMessage, setStatusMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [error, setError] = useState(null);
  const updateTimeoutRef = useRef(null);

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
    socket.on('audio_data', () => { /* optional: drive visualizer */ });
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

  const startAudio = useCallback(() => {
    setError(null);
    socket.emit('start_audio', { muted: isMuted });
  }, [isMuted]);

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

  const value = {
    connectionStatus,
    statusMessage,
    messages,
    isListening,
    isMuted,
    error,
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
