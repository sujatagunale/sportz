import fs from "fs/promises";

const DELAY_MS = Number.parseInt(process.env.DELAY_MS || "250", 10);
const API_URL = process.env.API_URL;
if (!API_URL) {
  throw new Error("API_URL is required to seed via REST endpoints.");
}

const DEFAULT_DATA_FILE = new URL("../data/data.json", import.meta.url);

async function readJsonFile(fileUrl) {
  const raw = await fs.readFile(fileUrl, "utf8");
  return JSON.parse(raw);
}

async function loadSeedData() {
  const parsed = await readJsonFile(DEFAULT_DATA_FILE);

  if (Array.isArray(parsed)) {
    return { feed: parsed };
  }

  if (Array.isArray(parsed.commentary)) {
    return { feed: parsed.commentary };
  }

  if (Array.isArray(parsed.feed)) {
    return { feed: parsed.feed };
  }

  throw new Error(
    "Seed data must be an array or contain a commentary/feed array."
  );
}

async function fetchMatches(limit = 100) {
  const response = await fetch(`${API_URL}/matches?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch matches: ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload.data) ? payload.data : [];
}

async function insertCommentary(matchId, entry) {
  const response = await fetch(`${API_URL}/matches/${matchId}/commentary`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      minute: entry.minute ?? null,
      sequence: entry.sequence ?? null,
      period: entry.period ?? null,
      eventType: entry.eventType ?? null,
      actor: entry.actor ?? null,
      team: entry.team ?? null,
      message: entry.message ?? "Update",
      metadata: entry.metadata ?? null,
      tags: entry.tags ?? null,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create commentary: ${response.status}`);
  }
  const payload = await response.json();
  return payload.data;
}

function extractRuns(entry) {
  if (Number.isFinite(entry.runs)) {
    return entry.runs;
  }
  if (entry.metadata && Number.isFinite(entry.metadata.runs)) {
    return entry.metadata.runs;
  }
  if (entry.eventType === "four") {
    return 4;
  }
  if (entry.eventType === "six") {
    return 6;
  }
  if (entry.eventType === "run") {
    return 1;
  }
  return null;
}

function scoreDeltaFromEntry(entry, match) {
  if (entry.scoreDelta && typeof entry.scoreDelta === "object") {
    return {
      home: Number(entry.scoreDelta.home || 0),
      away: Number(entry.scoreDelta.away || 0),
    };
  }

  if (entry.eventType === "goal") {
    if (entry.team === match.homeTeam) {
      return { home: 1, away: 0 };
    }
    if (entry.team === match.awayTeam) {
      return { home: 0, away: 1 };
    }
  }

  const runs = extractRuns(entry);
  if (runs !== null) {
    if (entry.team === match.homeTeam) {
      return { home: runs, away: 0 };
    }
    if (entry.team === match.awayTeam) {
      return { home: 0, away: runs };
    }
  }

  return null;
}

function getMatchEntry(entry, matchMap) {
  if (!Number.isInteger(entry.matchId)) {
    return null;
  }
  return matchMap.get(entry.matchId) ?? null;
}

async function updateMatchScore(matchId, homeScore, awayScore) {
  const response = await fetch(`${API_URL}/matches/${matchId}/score`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ homeScore, awayScore }),
  });
  if (!response.ok) {
    throw new Error(`Failed to update score: ${response.status}`);
  }
}

async function seed() {
  console.log(`📡 Seeding via API: ${API_URL}`);

  const { feed } = await loadSeedData();
  const matchesList = await fetchMatches();
  if (matchesList.length === 0) {
    throw new Error("No matches found in the database.");
  }
  const matchMap = new Map(
    matchesList.map((match) => [
      match.id,
      {
        match,
        score: { home: match.homeScore ?? 0, away: match.awayScore ?? 0 },
      },
    ])
  );

  for (let i = 0; i < feed.length; i += 1) {
    const entry = feed[i];
    const target = getMatchEntry(entry, matchMap);
    if (!target) {
      console.warn("⚠️  Skipping entry without valid matchId:", entry.message);
      continue;
    }
    const match = target.match;

    const row = await insertCommentary(match.id, entry);
    console.log(`📣 [Match ${match.id}] ${row.message}`);

    const delta = scoreDeltaFromEntry(entry, match);
    if (delta) {
      target.score.home += delta.home;
      target.score.away += delta.away;
      await updateMatchScore(match.id, target.score.home, target.score.away);
      console.log(
        `📊 [Match ${match.id}] Score updated: ${target.score.home}-${target.score.away}`
      );
    }

    if (DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }
}

seed().catch((err) => {
  console.error("❌ Seed error:", err);
  process.exit(1);
});
