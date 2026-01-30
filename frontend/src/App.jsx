import React from 'react';
import TopBar from './components/TopBar';
import Chat from './components/Chat';

export default function App() {
  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <TopBar />
      <main className="flex-1 min-h-0 flex flex-col">
        <Chat />
      </main>
    </div>
  );
}
