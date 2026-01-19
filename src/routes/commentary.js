import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/db.js";
import { matches, commentary } from "../db/schema.js";
import { MATCH_STATUS, matchIdParamSchema } from "../validation/matches.js";
import { syncMatchStatus } from "../utils/match-status.js";
import {
  createCommentarySchema,
  listCommentaryQuerySchema,
} from "../validation/commentary.js";

const MAX_LIMIT = 100;

function formatZodError(error) {
  return error.flatten();
}

export const commentaryRouter = Router({ mergeParams: true });

commentaryRouter.get("/", async (req, res) => {
  const paramsParsed = matchIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    return res
      .status(400)
      .json({
        error: "Invalid match id",
        details: formatZodError(paramsParsed.error),
      });
  }

  const queryParsed = listCommentaryQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    return res
      .status(400)
      .json({
        error: "Invalid query",
        details: formatZodError(queryParsed.error),
      });
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
    res.status(500).json({ error: "Failed to list commentary" });
  }
});

commentaryRouter.post("/", async (req, res) => {
  const paramsParsed = matchIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    return res
      .status(400)
      .json({
        error: "Invalid match id",
        details: formatZodError(paramsParsed.error),
      });
  }

  const bodyParsed = createCommentarySchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res
      .status(400)
      .json({
        error: "Invalid payload",
        details: formatZodError(bodyParsed.error),
      });
  }

  const matchId = paramsParsed.data.id;

  try {
    const [event] = await db
      .select({
        id: matches.id,
        status: matches.status,
        startTime: matches.startTime,
        endTime: matches.endTime,
      })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);

    if (!event) {
      return res.status(404).json({ error: "Match not found" });
    }

    await syncMatchStatus(event, async (nextStatus) => {
      await db
        .update(matches)
        .set({ status: nextStatus })
        .where(eq(matches.id, matchId));
    });

    if (event.status !== MATCH_STATUS.LIVE) {
      return res.status(409).json({ error: "Match is not live" });
    }

    const [comment] = await db
      .insert(commentary)
      .values({
        matchId,
        minute: bodyParsed.data.minute ?? null,
        sequence: bodyParsed.data.sequence ?? null,
        period: bodyParsed.data.period ?? null,
        eventType: bodyParsed.data.eventType ?? null,
        actor: bodyParsed.data.actor ?? null,
        team: bodyParsed.data.team ?? null,
        message: bodyParsed.data.message,
        metadata: bodyParsed.data.metadata ?? null,
        tags: bodyParsed.data.tags ?? null,
      })
      .returning();

    if (res.app.locals.broadcastCommentary) {
      res.app.locals.broadcastCommentary(matchId, comment);
    }

    res.status(201).json({ data: comment });
  } catch (err) {
    res.status(500).json({ error: "Failed to create commentary" });
  }
});
