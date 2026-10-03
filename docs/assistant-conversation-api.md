<!--
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0
-->

# Assistant Conversation API

Base path: `/api/notes/{noteId}/conversations`

All responses are wrapped in `JsonResponse` (`{ status, message, body }`).
The examples below show only the `body` part.

---

## 1. List

```
GET /api/notes/{noteId}/conversations
```

Requires notebook read access. **200 OK** — metadata-only summaries; `messages` are
**not** included (use Get or the messages endpoint to read content).

```json
[
  {
    "id": "conv_abc1234567890def",
    "noteId": "2F2YS7PCE",
    "ownerId": "alice",
    "title": "Test conversation",
    "createdAt": "2026-09-26T10:00:00Z",
    "updatedAt": "2026-09-26T10:05:00Z"
  }
]
```

---

## 2. Get

```
GET /api/notes/{noteId}/conversations/{conversationId}
```

Requires notebook read access (not restricted to the owner). **200 OK** — see the
`ConversationResponse` schema below.

---

## 3. Create

```
POST /api/notes/{noteId}/conversations
Content-Type: application/json

{ "title": "Test conversation" }
```

- `title` is optional. When omitted, it defaults to the creation time (`yy-MM-dd HH:mm`).
- Requires notebook read access and an authenticated user; anonymous requests are
  rejected (403). The server assigns `ownerId` from the authenticated identity.

**201 Created** — returns a `ConversationMetadata` without messages.

---

## 4. Update title

```
PATCH /api/notes/{noteId}/conversations/{conversationId}
Content-Type: application/json

{ "title": "Renamed" }
```

- Owner only (403 otherwise). `title` is required (400 if missing/blank).
- Returns 409 while a run is in progress on the conversation.

**200 OK** — returns the updated `ConversationMetadata` without messages.

---

## 5. Delete

```
DELETE /api/notes/{noteId}/conversations/{conversationId}
```

- Owner only (403 otherwise). Returns 409 while a run is in progress.

**204 No Content**

---

## Schema

### ConversationMetadata

| Field | Type | Description |
|---|---|---|
| `id` | string | `conv_` prefix |
| `noteId` | string | Owning note ID |
| `ownerId` | string | Authenticated user who created it (server-assigned) |
| `title` | string | Conversation title |
| `createdAt` | string (ISO-8601) | Created timestamp |
| `updatedAt` | string (ISO-8601) | Last-updated timestamp |

### ConversationResponse

Includes all `ConversationMetadata` fields plus `messages` (`Message[]`, see below).
Only the Get endpoint returns this detailed response.

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
