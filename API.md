# Sports Commentary API (AI Agent Guide)

This document describes the REST and WebSocket APIs exposed by this service so an AI agent or frontend can integrate match lists, live commentary, and score updates.

## Base URLs

- HTTP: `http://localhost:3000` (or `http://<HOST>:<PORT>`)
- WebSocket: `ws://localhost:3000/ws`

Ports and host are configured via environment variables:

- `PORT` (default `3000`)
- `HOST` (default `0.0.0.0`)

## Content Type

All REST requests and responses are JSON. Use:

- Request header: `Content-Type: application/json`

## Data Models

Match object:

```json
{
  "id": 1,
  "sport": "football",
  "homeTeam": "Arsenal FC",
  "awayTeam": "Liverpool FC",
  "status": "live",
  "startTime": "2025-02-01T12:00:00.000Z",
  "homeScore": 1,
  "awayScore": 0,
  "createdAt": "2025-02-01T12:00:00.000Z"
}
```

Commentary object:

```json
{
  "id": 10,
  "matchId": 1,
  "minute": 42,
  "sequence": 120,
  "period": "2nd half",
  "eventType": "goal",
  "actor": "Alex Morgan",
  "team": "Arsenal FC",
  "message": "GOAL! Powerful finish from the edge of the box.",
  "metadata": { "assist": "Sam Kerr" },
  "tags": ["goal", "shot"],
  "createdAt": "2025-02-01T12:34:56.000Z"
}
```

Notes:

- `homeScore` and `awayScore` are non-negative integers.
- `createdAt` timestamps are ISO date strings.
- `metadata` is arbitrary JSON.
- `tags` is an optional array of strings.

## REST API

### List Matches

`GET /matches?limit=50`

Query params:

- `limit` (optional, 1-100)

Response:

```json
{ "data": [/* Match[] */] }
```

Notes:

- Ordered by `createdAt` descending (newest first).

### Create Match

`POST /matches`

Body:

```json
{
  "sport": "football",
  "homeTeam": "FC Neon",
  "awayTeam": "Drizzle United",
  "status": "live",
  "startTime": "2025-02-01T12:00:00.000Z",
  "homeScore": 0,
  "awayScore": 0
}
```

Response:

```json
{ "data": {/* Match */} }
```

Validation:

- `sport`, `homeTeam`, `awayTeam`, `status` are non-empty strings.
- `startTime` must be a valid ISO date string.
- `homeScore`, `awayScore` are optional non-negative integers.

### List Commentary for a Match

`GET /matches/:id/commentary?limit=100`

Path params:

- `id` (match id, positive integer)

Query params:

- `limit` (optional, 1-100)

Response:

```json
{ "data": [/* Commentary[] */] }
```

Notes:

- Ordered by `createdAt` descending (newest first).

### Create Commentary for a Match

`POST /matches/:id/commentary`

Body:

```json
{
  "minute": 42,
  "sequence": 120,
  "period": "2nd half",
  "eventType": "goal",
  "actor": "Alex Morgan",
  "team": "FC Neon",
  "message": "GOAL! Powerful finish from the edge of the box.",
  "metadata": { "assist": "Sam Kerr" },
  "tags": ["goal", "shot"]
}
```

Response:

```json
{ "data": {/* Commentary */} }
```

Validation:

- `message` is required and must be a non-empty string.
- All other fields are optional.

Side effect:

- If a WebSocket client is subscribed to the match, it receives a `commentary` event.

### Update Score for a Match

`PATCH /matches/:id/score`

Body:

```json
{
  "homeScore": 2,
  "awayScore": 1
}
```

Response:

```json
{ "data": {/* Match */} }
```

Validation:

- `homeScore` and `awayScore` are required non-negative integers.

Side effect:

- If a WebSocket client is subscribed to the match, it receives a `score_update` event.

## WebSocket API

### Connect

`ws://localhost:3000/ws`

Auto-subscribe on connect:

`ws://localhost:3000/ws?matchId=123`

Upon connection, server sends:

```json
{ "type": "welcome" }
```

### Client → Server Messages

Subscribe to a match:

```json
{ "type": "subscribe", "matchId": 123 }
```

Unsubscribe from a match:

```json
{ "type": "unsubscribe", "matchId": 123 }
```

Set full subscription list:

```json
{ "type": "setSubscriptions", "matchIds": [1, 2, 3] }
```

Ping:

```json
{ "type": "ping" }
```

Limits:

- Max subscriptions per socket: 50

### Server → Client Messages

Acknowledgements:

```json
{ "type": "subscribed", "matchId": 123 }
```

```json
{ "type": "unsubscribed", "matchId": 123 }
```

```json
{ "type": "subscriptions", "matchIds": [1, 2, 3] }
```

Commentary broadcast:

```json
{ "type": "commentary", "data": {/* Commentary */} }
```

Score update broadcast:

```json
{
  "type": "score_update",
  "matchId": 123,
  "data": { "homeScore": 2, "awayScore": 1 }
}
```

Pong:

```json
{ "type": "pong" }
```

Errors:

```json
{
  "type": "error",
  "code": "match_not_found",
  "message": "Match 123 not found"
}
```

Possible error codes:

- `invalid_json`
- `invalid_message`
- `rate_limited`
- `too_many_subscriptions`
- `match_lookup_failed`
- `match_not_found`

### Rate Limiting

WebSocket messages are rate-limited per socket:

- Capacity: 20 tokens
- Refill: 10 tokens/sec

Exceeding limits returns an `error` with `code: "rate_limited"`.

## Common Integration Flow

Frontend sequence:

1. `GET /matches` to show the match list.
2. Open a WebSocket connection and subscribe to one or more match ids.
3. Render commentary updates on `commentary` events.
4. Update score UI on `score_update` events.
5. Optionally load historical commentary via `GET /matches/:id/commentary`.
