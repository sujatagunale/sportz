# Sportz — Live Match Commentary API + WebSockets

Small Express + Postgres demo for live match commentary with a WebSocket
broadcast channel. Focus is on WS patterns (heartbeats, backpressure, message
validation, subscriptions).

## Features

- REST API for matches + commentary
- WebSocket subscriptions per match
- Input validation with Zod
- Drizzle ORM + Postgres
- Seed scripts for quick demo

## Requirements

- Node.js 18+
- Postgres database

## Setup

```bash
npm install
```

Create a `.env` file:

```
DATABASE_URL=postgres://user:pass@localhost:5432/sportz
```

Generate and run migrations:

```bash
npm run db:generate
npm run db:migrate
```

Start the server:

```bash
npm run dev
```

Server runs at:

- HTTP: `http://localhost:3000`
- WS: `ws://localhost:3000/ws`

## Scripts

- `npm run dev` — start server with watch mode
- `npm run seed` — seed DB with a basic match + commentary entry
- `npm run seed:websocket` — create a match and stream commentary over WS
- `npm run ws:client` — simple WS client for testing

## REST API

### List matches

`GET /matches?limit=50`

### Create match

`POST /matches`

```json
{
  "sport": "football",
  "homeTeam": "FC Neon",
  "awayTeam": "Drizzle United",
  "status": "live",
  "startTime": "2025-02-01T12:00:00.000Z"
}
```

### List commentary for a match

`GET /matches/:id/commentary?limit=100`

### Create commentary for a match

`POST /matches/:id/commentary`

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

## WebSocket Protocol

Connect:

`ws://localhost:3000/ws`

Optional auto-subscribe on connect:

`ws://localhost:3000/ws?matchId=123`

### Client → Server

```json
{ "type": "subscribe", "matchId": 123 }
```

```json
{ "type": "unsubscribe", "matchId": 123 }
```

```json
{ "type": "setSubscriptions", "matchIds": [1, 2, 3] }
```

```json
{ "type": "ping" }
```

### Server → Client

```json
{ "type": "welcome" }
```

```json
{ "type": "subscribed", "matchId": 123 }
```

```json
{ "type": "unsubscribed", "matchId": 123 }
```

```json
{ "type": "subscriptions", "matchIds": [1, 2, 3] }
```

```json
{ "type": "commentary", "data": { "id": 1, "matchId": 123, "message": "..." } }
```

```json
{ "type": "pong" }
```

```json
{
  "type": "error",
  "code": "match_not_found",
  "message": "Match 999 not found",
  "matchIds": [999]
}
```

### Limits

- Max subscriptions per socket: 50
- Rate limit: 20 burst, 10 messages/sec
- Max message payload: 1 MB
- Backpressure: closes if buffered > 1 MB

## Notes

- Auth is intentionally omitted to keep focus on WS mechanics.
- For multi-instance scaling, use pub/sub (Redis/NATS/Kafka) so broadcasts
  reach all WS servers.
