# Assistant Message API

Two channels:

- **Read history** → REST `GET` (paginated)
- **Send a message + stream the reply** → WebSocket (not REST)

See `docs/assistant-conversation-api.md` for the `Message` schema.

---

## Read: list messages

```
GET /api/notes/{noteId}/conversations/{conversationId}/messages?cursor={cursor}&limit={limit}
```

Wrapped in `JsonResponse` (`{ status, message, body }`). `body`:

```json
{
  "messages": [ /* Message[], latest first */ ],
  "nextCursor": "msg_abc123"
}
```

- `limit` — default `10`.
- `cursor` — pass the previous response's `nextCursor` for the next page. Omit for the first page.
- `nextCursor` is `null` when there are no more messages.
- Unknown `cursor` → **404 Not Found**.

---

## Send: WebSocket

Sending runs over the notebook WebSocket, same socket as the rest of the note.

### Client → server

```json
{
  "op": "ASSISTANT_SEND_MESSAGE",
  "data": {
    "noteId": "2F2YS7PCE",
    "conversationId": "conv_abc1234567890def",
    "content": "How many paragraphs are in this notebook?"
  }
}
```

### Server → client (streamed)

The reply streams back as multiple `ASSISTANT_EVENT` messages, broadcast to the note:

```json
{
  "op": "ASSISTANT_EVENT",
  "data": {
    "conversationId": "conv_abc1234567890def",
    "type": "message.delta",
    "payload": { /* varies by type, see below */ }
  }
}
```

Dispatch on `data.type`:

| `type` | payload fields |
|---|---|
| `run.started` | `runId`, `createdAt` |
| `message.delta` | `messageId`, `delta` (append to build the text) |
| `message.done` | `messageId`, `content` (full text) |
| `tool_call.started` | `toolCallId`, `name`, `arguments` |
| `tool_call.done` | `toolCallId`, `result` (`{ value, error }`) |
| `run.completed` | `runId`, `usage` (`{ inputTokens, outputTokens }`) |
| `run.failed` | `runId`, `error` (`{ code, message }`) |

Typical order: `run.started` → (`tool_call.started` → `tool_call.done`)* → `message.delta`* → `message.done` → `run.completed`. On error, `run.failed` instead of `run.completed`.

> Events are broadcast to all connections on the note — filter by `conversationId`.
