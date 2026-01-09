import { WebSocket } from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:3000/ws';
const API_URL = process.env.API_URL || WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '');
const MATCH_ID = process.env.MATCH_ID || process.argv[2];
const url = MATCH_ID ? `${WS_URL}?matchId=${MATCH_ID}` : WS_URL;
const ws = new WebSocket(url);
let refreshInterval = null;
let subscribedIds = new Set();
let warnedEmpty = false;

ws.on('open', () => {
  console.log(`🔌 Connected to ${url}`);
  if (!MATCH_ID) {
    void subscribeToAllMatches();
    refreshInterval = setInterval(subscribeToAllMatches, 5000);
  }
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
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err);
});

async function subscribeToAllMatches() {
  try {
    const response = await fetch(`${API_URL}/matches?limit=100`);
    if (!response.ok) {
      console.error('❌ Failed to fetch matches:', response.status);
      return;
    }
    const payload = await response.json();
    const matchIds = (payload.data || []).map((match) => match.id);
    if (matchIds.length === 0) {
      if (!warnedEmpty) {
        console.log('ℹ️ No matches found to subscribe to');
        warnedEmpty = true;
      }
      return;
    }
    warnedEmpty = false;

    const nextSet = new Set(matchIds);
    if (setsEqual(nextSet, subscribedIds)) {
      return;
    }

    ws.send(JSON.stringify({ type: 'setSubscriptions', matchIds }));
    subscribedIds = nextSet;
    console.log('✅ Subscribed to matches:', matchIds.join(', '));
  } catch (err) {
    console.error('❌ Failed to subscribe to matches:', err);
  }
}

function setsEqual(a, b) {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}
