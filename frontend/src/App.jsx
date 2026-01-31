import React, { useState, useRef } from 'react';
import TopBar from './components/TopBar';
import Chat from './components/Chat';
import AvatarViewer from './components/AvatarViewer';

export default function App() {
  const [chatVisible, setChatVisible] = useState(true);
  const fileInputRef = useRef(null);
  const [avatarFile, setAvatarFile] = useState(null);

  const toggleChat = () => setChatVisible((v) => !v);

  const handleAvatarUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target?.files?.[0];
    if (file) {
      setAvatarFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <TopBar
        chatVisible={chatVisible}
        onToggleChat={toggleChat}
        onUploadAvatar={handleAvatarUpload}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".vrm"
        className="hidden"
        onChange={handleFileChange}
      />
      <main className="flex-1 min-h-0 flex flex-col md:flex-row">
        <aside
          className={`shrink-0 border-b md:border-b-0 md:border-r border-zinc-800 flex flex-col transition-all duration-200 ${
            chatVisible
              ? 'h-48 md:h-auto md:w-72 md:min-w-[240px] md:max-w-[320px]'
              : 'flex-1 min-h-0 w-full'
          }`}
        >
          <AvatarViewer className="flex-1 min-h-0 w-full" avatarFile={avatarFile} />
        </aside>
        {chatVisible && (
          <section className="flex-1 min-w-0 min-h-0 flex flex-col">
            <Chat />
          </section>
        )}
      </main>
    </div>
  );
}
