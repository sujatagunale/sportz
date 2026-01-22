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
  "endTime": "2025-02-01T13:45:00.000Z",
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
- `status` values: `scheduled`, `live`, `finished`.
- `createdAt` timestamps are ISO date strings.
- `metadata` is arbitrary JSON.
- `tags` is an optional array of strings.

## REST API

### Root

`GET /`

Response:

```text
Sports Commentary API
```

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
- Match `status` is synced against `startTime`/`endTime` during this request.

### Create Match

`POST /matches`

Body:

```json
{
  "sport": "football",
  "homeTeam": "FC Neon",
  "awayTeam": "Drizzle United",
  "startTime": "2025-02-01T12:00:00.000Z",
  "endTime": "2025-02-01T13:45:00.000Z",
  "homeScore": 0,
  "awayScore": 0
}
```

Response:

```json
{ "data": {/* Match */} }
```

Validation:

- `status` is computed from `startTime` and `endTime`.
- `endTime` must be a valid ISO date string after `startTime`.
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

Errors:

- `404` if match is not found.
- `409` if match status is not `live`.

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

Errors:

- `404` if match is not found.
- `409` if match status is not `live`.

Side effect:

- If a WebSocket client is subscribed to the match, it receives a `score_update` event.

### End Match

`PATCH /matches/:id/end`

Response:

```json
{ "data": {/* Match */} }
```

Notes:

- Sets `status` to `finished` and `endTime` to the current server time.

Errors:

- `404` if match is not found.

## WebSocket API

### Connect

`ws://localhost:3000/ws`

Auto-subscribe on connect:

`ws://localhost:3000/ws?matchId=123`

Auto-subscribe to the global live stream (all matches):

`ws://localhost:3000/ws?all=1`

Upon connection, server sends:

```json
{ "type": "welcome" }
```

Notes:

- Max incoming payload size: 1 MB.
- Server closes the socket with code `1013` if the send buffer exceeds 1,000,000 bytes (backpressure).
- Server sends periodic ping frames; clients should respond with pong frames (handled automatically by most WS clients).

### Client → Server Messages

Subscribe to a match:

```json
{ "type": "subscribe", "matchId": 123 }
```

Subscribe to the global live stream:

```json
{ "type": "subscribeAll" }
```

Unsubscribe from a match:

```json
{ "type": "unsubscribe", "matchId": 123 }
```

Unsubscribe from the global live stream:

```json
{ "type": "unsubscribeAll" }
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
{ "type": "subscribed_all" }
```

```json
{ "type": "unsubscribed_all" }
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
- `too_many_subscriptions`
- `match_lookup_failed`
- `match_not_found`

## Common Integration Flow

Frontend sequence:

1. `GET /matches` to show the match list.
2. Open a WebSocket connection and subscribe to one or more match ids.
3. Render commentary updates on `commentary` events.
4. Update score UI on `score_update` events.
5. Optionally load historical commentary via `GET /matches/:id/commentary`.
