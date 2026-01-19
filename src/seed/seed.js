import "dotenv/config";
import fs from "fs/promises";

const DELAY_MS = Number.parseInt(process.env.DELAY_MS || "250", 10);
const DEFAULT_MATCH_DURATION_MINUTES = Number.parseInt(
  process.env.SEED_MATCH_DURATION_MINUTES || "120",
  10
);
const FORCE_LIVE =
  process.env.SEED_FORCE_LIVE !== "0" && process.env.SEED_FORCE_LIVE !== "false";
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
    return { feed: parsed, matches: [] };
  }

  if (Array.isArray(parsed.commentary)) {
    return { feed: parsed.commentary, matches: parsed.matches ?? [] };
  }

  if (Array.isArray(parsed.feed)) {
    return { feed: parsed.feed, matches: parsed.matches ?? [] };
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

function parseDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLiveMatch(match) {
  const start = parseDate(match.startTime);
  const end = parseDate(match.endTime);
  if (!start || !end) {
    return false;
  }
  const now = new Date();
  return now >= start && now < end;
}

function buildMatchTimes(seedMatch) {
  const now = new Date();
  const durationMs = DEFAULT_MATCH_DURATION_MINUTES * 60 * 1000;

  let start = parseDate(seedMatch.startTime);
  let end = parseDate(seedMatch.endTime);

  if (!start && !end) {
    start = new Date(now.getTime() - 5 * 60 * 1000);
    end = new Date(start.getTime() + durationMs);
  } else {
    if (start && !end) {
      end = new Date(start.getTime() + durationMs);
    }
    if (!start && end) {
      start = new Date(end.getTime() - durationMs);
    }
  }

  if (FORCE_LIVE && start && end) {
    if (!(now >= start && now < end)) {
      start = new Date(now.getTime() - 5 * 60 * 1000);
      end = new Date(start.getTime() + durationMs);
    }
  }

  if (!start || !end) {
    throw new Error("Seed match must include valid startTime and endTime.");
  }

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

async function createMatch(seedMatch) {
  const { startTime, endTime } = buildMatchTimes(seedMatch);

  const response = await fetch(`${API_URL}/matches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sport: seedMatch.sport,
      homeTeam: seedMatch.homeTeam,
      awayTeam: seedMatch.awayTeam,
      startTime,
      endTime,
      homeScore: seedMatch.homeScore ?? 0,
      awayScore: seedMatch.awayScore ?? 0,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create match: ${response.status}`);
  }
  const payload = await response.json();
  return payload.data;
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

function fakeScoreDelta(matchState) {
  const nextSide = matchState.fakeNext === "home" ? "away" : "home";
  matchState.fakeNext = nextSide;
  const points = 1;
  return nextSide === "home"
    ? { home: points, away: 0 }
    : { home: 0, away: points };
}

function inningsRank(period) {
  if (!period) {
    return 0;
  }
  const lower = String(period).toLowerCase();
  const match = lower.match(/(\d+)(st|nd|rd|th)/);
  if (match) {
    return Number(match[1]) || 0;
  }
  if (lower.includes("first")) {
    return 1;
  }
  if (lower.includes("second")) {
    return 2;
  }
  if (lower.includes("third")) {
    return 3;
  }
  if (lower.includes("fourth")) {
    return 4;
  }
  return 0;
}

function normalizeCricketFeed(entries) {
  return [...entries].sort((a, b) => {
    const inningsDiff = inningsRank(a.period) - inningsRank(b.period);
    if (inningsDiff !== 0) {
      return inningsDiff;
    }
    const seqA = Number.isFinite(a.sequence) ? a.sequence : Number.MAX_SAFE_INTEGER;
    const seqB = Number.isFinite(b.sequence) ? b.sequence : Number.MAX_SAFE_INTEGER;
    if (seqA !== seqB) {
      return seqA - seqB;
    }
    const minA = Number.isFinite(a.minute) ? a.minute : Number.MAX_SAFE_INTEGER;
    const minB = Number.isFinite(b.minute) ? b.minute : Number.MAX_SAFE_INTEGER;
    return minA - minB;
  });
}

function buildRandomizedFeed(feed, matchMap) {
  const buckets = new Map();
  for (const entry of feed) {
    const key = Number.isInteger(entry.matchId) ? entry.matchId : null;
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(entry);
  }

  for (const [matchId, entries] of buckets) {
    if (!Number.isInteger(matchId)) {
      continue;
    }
    const target = matchMap.get(matchId);
    const sport = target?.match?.sport?.toLowerCase();
    if (sport === "cricket") {
      buckets.set(matchId, normalizeCricketFeed(entries));
    }
  }

  const matchIds = Array.from(buckets.keys());
  const randomized = [];
  let lastMatchId = null;

  while (randomized.length < feed.length) {
    const candidates = matchIds.filter(
      (id) => (buckets.get(id) || []).length > 0
    );
    if (candidates.length === 0) {
      break;
    }

    let selectable = candidates;
    if (lastMatchId !== null && candidates.length > 1) {
      const withoutLast = candidates.filter((id) => id !== lastMatchId);
      if (withoutLast.length > 0) {
        selectable = withoutLast;
      }
    }

    const choice =
      selectable[Math.floor(Math.random() * selectable.length)];
    const nextEntry = buckets.get(choice).shift();
    randomized.push(nextEntry);
    lastMatchId = choice;
  }

  return randomized;
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

  const { feed, matches: seedMatches } = await loadSeedData();
  const matchesList = await fetchMatches();

  const matchMap = new Map();
  const matchKeyMap = new Map();
  for (const match of matchesList) {
    if (FORCE_LIVE && !isLiveMatch(match)) {
      continue;
    }
    const key = `${match.sport}|${match.homeTeam}|${match.awayTeam}`;
    if (!matchKeyMap.has(key)) {
      matchKeyMap.set(key, match);
    }
    matchMap.set(match.id, {
      match,
      score: { home: match.homeScore ?? 0, away: match.awayScore ?? 0 },
      fakeNext: Math.random() < 0.5 ? "home" : "away",
    });
  }

  if (Array.isArray(seedMatches) && seedMatches.length > 0) {
    for (const seedMatch of seedMatches) {
      const key = `${seedMatch.sport}|${seedMatch.homeTeam}|${seedMatch.awayTeam}`;
      let match = matchKeyMap.get(key);
      if (!match || (FORCE_LIVE && !isLiveMatch(match))) {
        match = await createMatch(seedMatch);
        matchKeyMap.set(key, match);
      }
      if (Number.isInteger(seedMatch.id)) {
        matchMap.set(seedMatch.id, {
          match,
          score: { home: match.homeScore ?? 0, away: match.awayScore ?? 0 },
          fakeNext: Math.random() < 0.5 ? "home" : "away",
        });
      }
      matchMap.set(match.id, {
        match,
        score: { home: match.homeScore ?? 0, away: match.awayScore ?? 0 },
        fakeNext: Math.random() < 0.5 ? "home" : "away",
      });
    }
  }

  if (matchMap.size === 0) {
    throw new Error("No matches found or created in the database.");
  }

  const randomizedFeed = buildRandomizedFeed(feed, matchMap);

  for (let i = 0; i < randomizedFeed.length; i += 1) {
    const entry = randomizedFeed[i];
    const target = getMatchEntry(entry, matchMap);
    if (!target) {
      console.warn(
        "⚠️  Skipping entry: matchId missing or not found:",
        entry.message
      );
      continue;
    }
    const match = target.match;

    const row = await insertCommentary(match.id, entry);
    console.log(`📣 [Match ${match.id}] ${row.message}`);

    const delta = scoreDeltaFromEntry(entry, match) ?? fakeScoreDelta(target);
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
