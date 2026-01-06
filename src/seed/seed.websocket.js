import fs from 'fs/promises';
import { WebSocket } from 'ws';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const WS_URL =
  process.env.WS_URL || API_URL.replace(/^http/, 'ws') + '/ws';
const DELAY_MS = 250;

async function loadCommentaryFeed() {
  const fileUrl = new URL('../data/commentary.long.json', import.meta.url);
  const raw = await fs.readFile(fileUrl, 'utf8');
  return JSON.parse(raw);
}

async function createMatch() {
  const response = await fetch(`${API_URL}/matches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sport: 'football',
      homeTeam: 'FC Neon',
      awayTeam: 'Drizzle United',
      status: 'live',
      startTime: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create match: ${response.status}`);
  }

  const payload = await response.json();
  return payload.data;
}

async function createCommentary(matchId, entry) {
  const response = await fetch(`${API_URL}/matches/${matchId}/commentary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      minute: entry.minute,
      message: entry.message,
      metadata: entry.metadata ?? { source: 'seed.websocket' },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create commentary: ${response.status}`);
  }
}

async function seed() {
  const feed = await loadCommentaryFeed();
  const match = await createMatch();
  console.log('✅ Match created:', match);

  const ws = new WebSocket(`${WS_URL}?matchId=${match.id}`);

  ws.on('open', () => {
    console.log(`🔌 WebSocket connected: ${WS_URL}`);
  });

  ws.on('message', (data) => {
    try {
      const payload = JSON.parse(data.toString());
      if (payload.type === 'commentary') {
        console.log('📡 Broadcast:', payload.data.message);
      }
    } catch {
      console.log('📡 Broadcast:', data.toString());
    }
  });

  for (const entry of feed) {
    await createCommentary(match.id, entry);
    console.log('📣 Posted commentary:', entry.message);
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  ws.close();
}

seed().catch((err) => {
  console.error('❌ Seed error:', err);
  process.exit(1);
});
