import React from 'react';
import { Mic, MicOff, Power, PowerOff } from 'lucide-react';
import { useAssistant } from '../context/AssistantContext';

export default function TopBar() {
  const {
    connectionStatus,
    statusMessage,
    isListening,
    isMuted,
    startAudio,
    stopAudio,
    toggleMute,
  } = useAssistant();

  return (
    <header className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800">
      <div className="flex items-center gap-3">
        <span
          className={`w-2 h-2 rounded-full ${
            connectionStatus === 'connected' ? 'bg-emerald-500' : 'bg-zinc-500'
          }`}
        />
        <span className="text-sm text-zinc-400">
          {connectionStatus === 'connected' ? 'Подключено' : 'Нет связи'}
        </span>
        {statusMessage && (
          <span className="text-xs text-zinc-500 truncate max-w-[200px]">{statusMessage}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {!isListening ? (
          <button
            onClick={startAudio}
            className="p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
            title="Запустить KANA"
          >
            <Power className="w-5 h-5" />
          </button>
        ) : (
          <>
            <button
              onClick={toggleMute}
              className={`p-2 rounded-lg transition-colors ${
                isMuted ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-400' : 'bg-amber-600 hover:bg-amber-500 text-white'
              }`}
              title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            <button
              onClick={stopAudio}
              className="p-2 rounded-lg bg-red-600/80 hover:bg-red-500 text-white transition-colors"
              title="Остановить KANA"
            >
              <PowerOff className="w-5 h-5" />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
