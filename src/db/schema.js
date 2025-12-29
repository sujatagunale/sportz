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
  message: text('message').notNull(),
  metadata: jsonb('metadata'), // ball number, player stats, VAR, etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
