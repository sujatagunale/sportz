import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';

/**
 * Matches table
 * Stores high-level sports match metadata
 */
export const matches = pgTable('matches', {
  id: serial('id').primaryKey(),
  sport: text('sport').notNull(), // cricket, football, basketball
  homeTeam: text('home_team').notNull(),
  awayTeam: text('away_team').notNull(),
  status: text('status').notNull(), // live, finished, scheduled
  startTime: timestamp('start_time').notNull(),
  homeScore: integer('home_score').default(0).notNull(),
  awayScore: integer('away_score').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Commentary table
 * Stores live play-by-play or moment-based commentary
 */
export const commentary = pgTable('commentary', {
  id: serial('id').primaryKey(),
  matchId: integer('match_id')
    .references(() => matches.id)
    .notNull(),
  minute: integer('minute'), // optional for non-timed sports
  sequence: integer('sequence'), // per-match ordering (optional)
  period: text('period'), // half, quarter, over, inning, etc.
  eventType: text('event_type'), // goal, wicket, foul, timeout, etc.
  actor: text('actor'), // player or entity name
  team: text('team'), // team or side name
  message: text('message').notNull(),
  metadata: jsonb('metadata'), // ball number, player stats, VAR, etc.
  tags: jsonb('tags'), // optional list of tags or labels
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
