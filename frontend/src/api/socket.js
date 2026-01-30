import { io } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:8000';

export const socket = io(SOCKET_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

export default socket;
