import React from 'react';
import ReactDOM from 'react-dom/client';
import { AssistantProvider } from './context/AssistantContext';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AssistantProvider>
      <App />
    </AssistantProvider>
  </React.StrictMode>
);
