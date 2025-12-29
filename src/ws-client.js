import { WebSocket } from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:3000/ws';
const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log(`🔌 Connected to ${WS_URL}`);
});

ws.on('message', (data) => {
  try {
    const payload = JSON.parse(data.toString());
    console.log('WS message:', payload);
  } catch {
    console.log('WS message:', data.toString());
  }
});

ws.on('close', () => {
  console.log('🔌 Connection closed');
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err);
});
