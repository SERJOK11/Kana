import React, { useRef, useEffect } from 'react';
import { useAssistant } from '../context/AssistantContext';

export default function Chat() {
  const { messages, sendText, error, clearError } = useAssistant();
  const [inputValue, setInputValue] = React.useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text) return;
    sendText(text);
    setInputValue('');
  };

  return (
    <div className="flex flex-col h-full">
      {error && (
        <div className="flex items-center justify-between px-4 py-2 bg-red-900/30 border-b border-red-800 text-red-200 text-sm">
          <span>{error}</span>
          <button onClick={clearError} className="text-red-400 hover:text-red-300">
            ×
          </button>
        </div>
      )}
      <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
        {messages.length === 0 && (
          <p className="text-zinc-500 text-sm">Сообщения появятся здесь. Запустите KANA и говорите или введите текст.</p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              msg.sender === 'User'
                ? 'ml-auto bg-emerald-800/50 text-zinc-100'
                : 'bg-zinc-800 text-zinc-200'
            }`}
          >
            <span className="text-xs text-zinc-500 block mb-0.5">{msg.sender}</span>
            {msg.text}
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="p-4 border-t border-zinc-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Введите сообщение..."
            className="flex-1 px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="submit"
            disabled={!inputValue.trim()}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
          >
            Отправить
          </button>
        </div>
      </form>
    </div>
  );
}
