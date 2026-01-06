import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { matches, commentary } from '../db/schema.js';
import {
  createMatchSchema,
  listMatchesQuerySchema,
  matchIdParamSchema,
} from '../validation/matches.js';
import {
  createCommentarySchema,
  listCommentaryQuerySchema,
} from '../validation/commentary.js';

const MAX_LIMIT = 100;

function formatZodError(error) {
  return error.flatten();
}

export function createMatchRouter({ broadcastCommentary }) {
  const router = Router();

  router.get('/', async (req, res) => {
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

      res.json({ data });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list matches' });
    }
  });

  router.post('/', async (req, res) => {
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
          status: parsed.data.status,
          startTime: new Date(parsed.data.startTime),
        })
        .returning();

      res.status(201).json({ data: event });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create match' });
    }
  });

  router.get('/:id/commentary', async (req, res) => {
    const paramsParsed = matchIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid match id', details: formatZodError(paramsParsed.error) });
    }

    const queryParsed = listCommentaryQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid query', details: formatZodError(queryParsed.error) });
    }

    const matchId = paramsParsed.data.id;
    const limit = Math.min(queryParsed.data.limit ?? 100, MAX_LIMIT);

    try {
      const data = await db
        .select()
        .from(commentary)
        .where(eq(commentary.matchId, matchId))
        .orderBy(desc(commentary.createdAt))
        .limit(limit);

      res.json({ data });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list commentary' });
    }
  });

  router.post('/:id/commentary', async (req, res) => {
    const paramsParsed = matchIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid match id', details: formatZodError(paramsParsed.error) });
    }

    const bodyParsed = createCommentarySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid payload', details: formatZodError(bodyParsed.error) });
    }

    const matchId = paramsParsed.data.id;

    try {
      const [event] = await db
        .select({ id: matches.id })
        .from(matches)
        .where(eq(matches.id, matchId))
        .limit(1);

      if (!event) {
        return res.status(404).json({ error: 'Match not found' });
      }

      const [comment] = await db
        .insert(commentary)
        .values({
          matchId,
          minute: bodyParsed.data.minute ?? null,
          message: bodyParsed.data.message,
          metadata: bodyParsed.data.metadata ?? null,
        })
        .returning();

      if (broadcastCommentary) {
        broadcastCommentary(matchId, comment);
      }

      res.status(201).json({ data: comment });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create commentary' });
    }
  });

  return router;
}
