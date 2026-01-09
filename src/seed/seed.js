import { eq } from 'drizzle-orm';
import { db, pool } from '../db/db.js';
import { matches, commentary } from '../db/schema.js';

async function main() {
  try {
    console.log('🏟️ Running sports commentary CRUD demo...');

    await db.delete(commentary);
    await db.delete(matches);
    console.log('🧹 Cleared existing matches and commentary');

    // CREATE MATCH
    const [match] = await db
      .insert(matches)
      .values({
        sport: 'cricket',
        homeTeam: 'India',
        awayTeam: 'Australia',
        status: 'live',
        startTime: new Date(),
      })
      .returning();

    console.log('✅ Match created:', match);

    // CREATE COMMENTARY
    const [comment] = await db
      .insert(commentary)
      .values({
        matchId: match.id,
        minute: 12,
        sequence: 1,
        period: '1st innings',
        eventType: 'boundary',
        actor: 'Virat Kohli',
        team: 'India',
        message: 'FOUR! Beautiful cover drive.',
        metadata: { batsman: 'Virat Kohli', bowler: 'Starc' },
        tags: ['shot', 'boundary'],
      })
      .returning();

    console.log('✅ Commentary added:', comment);

    // READ COMMENTARY
    const comments = await db
      .select()
      .from(commentary)
      .where(eq(commentary.matchId, match.id));

    console.log('📖 Commentary feed:', comments);

    console.log('✅ Seed complete. Commentary retained for inspection.');
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  } finally {
    await pool.end();
    console.log('🔌 Database connection closed');
  }
}

main();
