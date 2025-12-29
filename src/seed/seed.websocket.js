import { WebSocket } from 'ws';
import { db, pool } from '../db/db.js';
import { matches, commentary } from '../db/schema.js';

const WS_URL = process.env.WS_URL || 'ws://localhost:3000/ws';
const DELAY_MS = 1200;

const commentaryFeed = [
  { minute: 1, message: 'Kickoff! The crowd is electric.' },
  { minute: 4, message: 'Quick counter-attack, shot on target!' },
  { minute: 9, message: 'Brilliant tackle in midfield.' },
  { minute: 13, message: 'Free kick from a dangerous area.' },
  { minute: 18, message: 'GOAL! A thunderous strike.' },
];

async function seed() {
  const [match] = await db
    .insert(matches)
    .values({
      sport: 'football',
      homeTeam: 'FC Neon',
      awayTeam: 'Drizzle United',
      status: 'live',
      startTime: new Date(),
    })
    .returning();

  console.log('✅ Match created:', match);

  const ws = new WebSocket(WS_URL);

  ws.on('open', async () => {
    console.log(`🔌 WebSocket connected: ${WS_URL}`);

    for (const item of commentaryFeed) {
      const [comment] = await db
        .insert(commentary)
        .values({
          matchId: match.id,
          minute: item.minute,
          message: item.message,
          metadata: { source: 'seed.websocket' },
        })
        .returning();

      ws.send(JSON.stringify({ type: 'commentary', data: comment }));
      console.log('📣 Sent commentary:', comment.message);

      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }

    ws.close();
  });

  ws.on('close', async () => {
    await pool.end();
    console.log('🔌 Database connection closed');
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err);
  });
}

seed().catch(async (err) => {
  console.error('❌ Seed error:', err);
  await pool.end();
  process.exit(1);
});
