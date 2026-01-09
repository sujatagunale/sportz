import fs from 'fs/promises';
import { db, pool } from '../db/db.js';
import { matches, commentary } from '../db/schema.js';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const DELAY_MS = 250;
const MATCH_COUNT = Number.parseInt(process.env.MATCH_COUNT || '2', 10);

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
      eventType: entry.eventType,
      period: entry.period,
      sequence: entry.sequence,
      actor: entry.actor,
      team: entry.team,
      tags: entry.tags,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create commentary: ${response.status}`);
  }
}

async function seed() {
  await db.delete(commentary);
  await db.delete(matches);
  console.log('🧹 Cleared existing matches and commentary');

  const feed = await loadCommentaryFeed();
  const count = Number.isNaN(MATCH_COUNT) || MATCH_COUNT < 1 ? 1 : MATCH_COUNT;
  const matchList = [];
  for (let i = 0; i < count; i += 1) {
    const match = await createMatch();
    matchList.push(match);
    console.log('✅ Match created:', match);
  }

  for (let i = 0; i < feed.length; i += 1) {
    const entry = feed[i];
    const target = matchList[i % matchList.length];
    await createCommentary(target.id, entry);
    console.log(`📣 [Match ${target.id}] Posted commentary:`, entry.message);
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
}

seed().catch((err) => {
  console.error('❌ Seed error:', err);
  process.exit(1);
});

process.on('beforeExit', async () => {
  await pool.end();
  console.log('🔌 Database connection closed');
});
