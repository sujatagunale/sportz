import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { matches } from '../db/schema.js';
import {
  createMatchSchema,
  listMatchesQuerySchema,
  MATCH_STATUS,
  matchIdParamSchema,
  updateScoreSchema,
} from '../validation/matches.js';
import { getMatchStatus, syncMatchStatus } from '../utils/match-status.js';

const MAX_LIMIT = 100;

function formatZodError(error) {
  return error.flatten();
}

export const matchRouter = Router();

matchRouter.get('/', async (req, res) => {
  const parsed = listMatchesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'Invalid query', details: formatZodError(parsed.error) });
  }

  const limit = Math.min(parsed.data.limit ?? 50, MAX_LIMIT);

  try {
    const data = await db
      .select()
      .from(matches)
      .orderBy(desc(matches.createdAt))
      .limit(limit);

    for (const match of data) {
      await syncMatchStatus(match, async (nextStatus) => {
        await db
          .update(matches)
          .set({ status: nextStatus })
          .where(eq(matches.id, match.id));
      });
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list matches' });
  }
});

matchRouter.post('/', async (req, res) => {
  const parsed = createMatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'Invalid payload', details: formatZodError(parsed.error) });
  }

  try {
    const [event] = await db
      .insert(matches)
      .values({
        sport: parsed.data.sport,
        homeTeam: parsed.data.homeTeam,
        awayTeam: parsed.data.awayTeam,
        startTime: new Date(parsed.data.startTime),
        endTime: new Date(parsed.data.endTime),
        status: getMatchStatus(parsed.data.startTime, parsed.data.endTime),
        homeScore: parsed.data.homeScore ?? 0,
        awayScore: parsed.data.awayScore ?? 0,
      })
      .returning();

    res.status(201).json({ data: event });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create match' });
  }
});

matchRouter.patch('/:id/score', async (req, res) => {
  const paramsParsed = matchIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    return res
      .status(400)
      .json({ error: 'Invalid match id', details: formatZodError(paramsParsed.error) });
  }

  const bodyParsed = updateScoreSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res
      .status(400)
      .json({ error: 'Invalid payload', details: formatZodError(bodyParsed.error) });
  }

  const matchId = paramsParsed.data.id;

  try {
    const [existing] = await db
      .select({
        id: matches.id,
        status: matches.status,
        startTime: matches.startTime,
        endTime: matches.endTime,
      })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: 'Match not found' });
    }

    await syncMatchStatus(existing, async (nextStatus) => {
      await db
        .update(matches)
        .set({ status: nextStatus })
        .where(eq(matches.id, matchId));
    });

    if (existing.status !== MATCH_STATUS.LIVE) {
      return res.status(409).json({ error: 'Match is not live' });
    }

    const [updated] = await db
      .update(matches)
      .set({
        homeScore: bodyParsed.data.homeScore,
        awayScore: bodyParsed.data.awayScore,
      })
      .where(eq(matches.id, matchId))
      .returning();

    if (res.app.locals.broadcastScoreUpdate) {
      res.app.locals.broadcastScoreUpdate(matchId, {
        homeScore: updated.homeScore,
        awayScore: updated.awayScore,
      });
    }

    res.json({ data: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update score' });
  }
});
