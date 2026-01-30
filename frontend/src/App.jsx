import React from 'react';
import TopBar from './components/TopBar';
import Chat from './components/Chat';
import AvatarViewer from './components/AvatarViewer';

export default function App() {
  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <TopBar />
      <main className="flex-1 min-h-0 flex flex-col md:flex-row">
        <aside className="h-48 md:h-auto md:w-72 md:min-w-[240px] shrink-0 border-b md:border-b-0 md:border-r border-zinc-800 flex flex-col md:w-80">
          <AvatarViewer className="flex-1 min-h-0 w-full" />
        </aside>
        <section className="flex-1 min-w-0 min-h-0 flex flex-col">
          <Chat />
        </section>
      </main>
    </div>
  );
}
