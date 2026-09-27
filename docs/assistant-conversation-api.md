# Assistant Conversation API

Base path: `/api/notes/{noteId}/conversations`

All responses are wrapped in `JsonResponse` (`{ status, message, body }`).
The examples below show only the `body` part.

---

## 1. List

```
GET /api/notes/{noteId}/conversations
```

**200 OK**

```json
[
  {
    "id": "conv_abc1234567890def",
    "noteId": "2F2YS7PCE",
    "title": "Test conversation",
    "createdAt": "2026-09-26T10:00:00Z",
    "updatedAt": "2026-09-26T10:05:00Z",
    "messages": []
  }
]
```

> `messages` is included even in list responses. Ignore it on the frontend if not needed.

---

## 2. Get

```
GET /api/notes/{noteId}/conversations/{conversationId}
```

**200 OK** — see the `Conversation` schema below.

---

## 3. Create

```
POST /api/notes/{noteId}/conversations
Content-Type: application/json

{ "title": "Test conversation" }
```

- `title` is optional. When omitted, it defaults to `noteId + " " + <timestamp>`.

**201 Created** — returns the created `Conversation`.

---

## 4. Delete

```
DELETE /api/notes/{noteId}/conversations/{conversationId}
```

**204 No Content**

---

## Schema

### Conversation

| Field | Type | Description |
|---|---|---|
| `id` | string | `conv_` prefix |
| `noteId` | string | Owning note ID |
| `title` | string | Conversation title |
| `createdAt` | string (ISO-8601) | Created timestamp |
| `updatedAt` | string (ISO-8601) | Last-updated timestamp |
| `messages` | Message[] | Message list (see below) |

### Message (shape varies by role)

Common:
- `id` (string, `msg_` prefix)
- `role` (`"user"` \| `"assistant"` \| `"tool"` \| `"system"`)
- `createdAt` (string)

Role-specific fields:

```jsonc
// user
{ "id": "...", "role": "user", "content": "hi", "createdAt": "..." }

// assistant
{
  "id": "...", "role": "assistant", "createdAt": "...",
  "content": "Hello.",
  "toolCalls": [ /* optional */ ]
}

// tool
{
  "id": "...", "role": "tool", "createdAt": "...",
  "toolCallId": "call_xxx",
  "content": "tool execution result"
}
```

Reading message history is a REST `GET`
`.../conversations/{conversationId}/messages` (cursor pagination). Sending a
message and streaming the reply runs over the WebSocket
(`ASSISTANT_SEND_MESSAGE` / `ASSISTANT_EVENT`) — see
`docs/notebook-assistant-ssd.md`.
