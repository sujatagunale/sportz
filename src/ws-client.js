import { WebSocket } from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:3000/ws';
const MATCH_ID = process.env.MATCH_ID || process.argv[2];
const url = MATCH_ID ? `${WS_URL}?matchId=${MATCH_ID}` : WS_URL;
const ws = new WebSocket(url);

ws.on('open', () => {
  console.log(`🔌 Connected to ${url}`);
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
