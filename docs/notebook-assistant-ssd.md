<!--
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0
-->

# Notebook Assistant — System Sequence Design

## Overview

Per-notebook AI chat. Each notebook may host multiple conversations; conversation
data is persisted separately from notebook data. Each conversation has exactly
one notebook and one authenticated owner; each notebook and user can have many
conversations. This document describes the target policy; pending backend changes
are listed under Implementation Status.
The LLM is OpenAI, accessed through the **Responses API** so reasoning models can
call function tools. Conversation CRUD and message history are served over REST;
sending a message and streaming the assistant's reply run over the existing
**WebSocket** (`/ws`), delivered only to the conversation owner.

---

## Architecture

```
Browser (Angular)
    │  REST (CRUD + message history)   +   WebSocket (streaming send)
    ▼
Zeppelin Server (Java)
    ├── AssistantConversationRestApi  (REST: conversation CRUD)
    ├── AssistantMessageRestApi       (REST: message list / pagination)
    ├── NotebookServer  (WS: ASSISTANT_SEND_MESSAGE → owner-only ASSISTANT_EVENT)
    │
    └── NotebookAssistantService      (run loop, per-note locking)
          ├── ConversationStore       (separate conversation persistence)
          ├── ConversationJsonCodec   (conversation JSON format)
          ├── ToolExecutor            (tool registry: name → Tool)
          │     └── ListParagraphsTool
          └── ChatModel               (provider-neutral streaming seam)
                └── OpenAiChatModel    (OpenAI Responses API adapter)
    │
    │  OpenAI API (HTTPS, Responses API)
    ▼
OpenAI
    │
    └── function tool: list_paragraphs
    │
    ▼
Notebook data (.zpln file)
    └── paragraphs — user code/analysis

Conversation storage (separate from notebook data)
    └── conversations with noteId, ownerId, messages
```

The only OpenAI-coupled file is `OpenAiChatModel`. Everything else talks to the
provider-neutral `ChatModel` interface (`stream(instructions, history, tools, consumer)`),
so swapping providers means adding one adapter, not touching the service.

---

## Data Model

### Conversation payload

Conversations are stored outside the notebook payload and reference it by
`noteId`. They are not included in notebook exports or clones. The JSON below
illustrates conversation data, not a hidden paragraph or a required physical
storage layout. All field names are camelCase.

```json
{
  "conversations": [
    {
      "id": "conv_01JXXX",
      "noteId": "2F2YS7PCE",
      "ownerId": "alice",
      "title": "2F2YS7PCE 2026-09-22T10:00:00Z",
      "createdAt": "2026-09-22T10:00:00Z",
      "updatedAt": "2026-09-22T10:05:00Z",
      "messages": [
        {
          "id": "msg_01JXXX",
          "role": "user",
          "content": "Show me the paragraphs",
          "createdAt": "2026-09-22T10:00:00Z"
        },
        {
          "id": "msg_02JXXX",
          "role": "assistant",
          "content": "",
          "toolCalls": [
            {
              "id": "call_abc123",
              "name": "list_paragraphs",
              "arguments": {},
              "result": { "value": [ { "id": "20150212-145404", "title": "Load", "index": 0 } ] }
            }
          ],
          "createdAt": "2026-09-22T10:00:05Z"
        },
        {
          "id": "msg_03JXXX",
          "role": "tool",
          "toolCallId": "call_abc123",
          "content": "{\"value\":[...]}",
          "createdAt": "2026-09-22T10:00:05Z"
        },
        {
          "id": "msg_04JXXX",
          "role": "assistant",
          "content": "There is one paragraph: \"Load\".",
          "createdAt": "2026-09-22T10:00:06Z"
        }
      ]
    }
  ]
}
```

`ToolResult` is `{ "value": ... }` on success or `{ "error": "..." }` on failure
(`error == null` means success). There is no `status` field.

### Ownership and access policy

- Any authenticated user with notebook read access can create a conversation;
  notebook write permission is not required. Anonymous creation is rejected.
- The server sets the required `ownerId` from the authenticated identity, never
  from a client-supplied owner or a role. Ownership does not change.
- All users with notebook read access can list all conversation summaries.
  Each summary contains only `id`, `noteId`, `ownerId`, `title`, `createdAt`, and
  `updatedAt`; messages, tool results, and message previews are excluded.
- Only the owner can retrieve content/history, send messages, delete a
  conversation, or change its title when title editing is supported. These
  operations also require current notebook read access and a matching `noteId`.
- Tools execute under the requesting user's existing notebook permissions.
  Owning a conversation does not grant notebook write or run permission.
- REST and WebSocket enforce these checks on the server. Run events, including
  tool results and failures, are not broadcast to other notebook viewers.
- The UI offers an easy new-conversation action, identifies the owner in the
  shared list, and prevents opening or editing another user's conversation.
  Titles are shared metadata; their visibility should be clear to users.
- Notebook deletion cleanup and migration of legacy conversations without an
  owner are outside the current scope. New conversations always require an owner.

---

## API Surface

### REST — Conversations

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/notes/{noteId}/conversations` | Create a conversation as the authenticated owner; notebook read access suffices (title optional; defaults to `noteId + " " + now`) |
| `GET` | `/api/notes/{noteId}/conversations` | List metadata summaries for all conversations in the notebook; requires notebook read access |
| `GET` | `/api/notes/{noteId}/conversations/{conversationId}` | Get a conversation with messages; owner and notebook read access required |
| `DELETE` | `/api/notes/{noteId}/conversations/{conversationId}` | Delete a conversation; owner and notebook read access required |

### REST — Messages

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/notes/{noteId}/conversations/{conversationId}/messages?cursor=&limit=` | List messages, latest-first, cursor pagination; owner and notebook read access required |

Sending a message is **not** a REST call — see WebSocket below.

### WebSocket (`/ws`)

Inbound (client → server):

| OP | Payload | Description |
|----|---------|-------------|
| `ASSISTANT_SEND_MESSAGE` | `{ noteId, conversationId, content }` | Send a user message and start a run; authenticated owner and notebook read access required |

Outbound (server → client): a single OP carries all run events, discriminated by `type`.

```json
{
  "op": "ASSISTANT_EVENT",
  "data": {
    "conversationId": "conv_01JXXX",
    "type": "message.delta",
    "payload": { "messageId": "msg_02JXXX", "delta": "Para" }
  }
}
```

`ASSISTANT_EVENT` is delivered only to the conversation owner through an
owner-authorized connection. It must not use the notebook-wide broadcast channel.
Rejected sends return a failure only to the requesting connection, without
conversation content. Clients route events by `data.conversationId`.

---

## Event Schema (`type` + `payload`)

| `type` | `payload` |
|--------|-----------|
| `run.started` | `{ runId, createdAt }` |
| `message.delta` | `{ messageId, delta }` |
| `message.done` | `{ messageId, content }` |
| `tool_call.started` | `{ toolCallId, name, arguments }` |
| `tool_call.done` | `{ toolCallId, result }` — `result` is a `ToolResult` |
| `run.completed` | `{ runId, usage: { inputTokens, outputTokens } }` |
| `run.failed` | `{ runId, error: { code, message } }` |

A run always ends with exactly one of `run.completed` or `run.failed`. Because
errors are delivered as `run.failed` events (there is no HTTP status over WS),
availability and permission failures are caught inside `sendMessage` and emitted
the same way.

---

## Sequence Diagrams

### 1. Create conversation (REST)

Read-modify-write is serialized by a per-note in-memory lock (`noteLocks`) held
by the service. Persistence goes through the separate `ConversationStore` and
does not modify or save notebook paragraphs.

```mermaid
sequenceDiagram
    participant U as User
    participant C as Client
    participant S as Zeppelin Server
    participant D as Conversation Store

    U->>C: Start a new conversation
    C->>S: POST conversations
    S->>S: check authentication and notebook read access
    S->>S: assign ownerId from authenticated user
    S->>S: acquire per-note lock
    S->>D: add conversation and persist
    S->>S: release per-note lock
    S-->>C: created conversation JSON
    C-->>U: Show conversation view
```

### 2. Send message (WebSocket, with tool call)

`NotebookServer.sendAssistantMessage` submits the run to a dedicated
`assistantExecutor` (separate from the paragraph-run pool, so the WS receive
thread is never blocked and assistant load cannot starve paragraph execution)
and hands the service an `AssistantEventListener` that delivers each event only
to the owner as an `ASSISTANT_EVENT` message.

```mermaid
sequenceDiagram
    participant U as User
    participant C as Owner Client
    participant S as Zeppelin Server
    participant O as OpenAI Responses API
    participant N as Note
    participant D as Conversation Store

    U->>C: Type a message
    C->>S: WS ASSISTANT_SEND_MESSAGE noteId, conversationId, content
    S->>S: submit run to assistantExecutor
    S->>S: check authentication, notebook read access, ownership
    S->>D: append user message and persist
    S-->>C: owner-only ASSISTANT_EVENT type run.started

    Note over S,O: Build input - instructions, history, tool specs
    S->>O: responses.createStreaming with tools

    O-->>S: stream - function call list_paragraphs
    S-->>C: owner-only type tool_call.started
    S->>N: ToolExecutor.callTool with requesting user permissions
    S->>D: append assistant plus tool result and persist
    S-->>C: owner-only type tool_call.done

    Note over S,O: loop with tool result appended
    O-->>S: stream - output text deltas
    S-->>C: owner-only type message.delta repeated

    O-->>S: stream - response.completed with usage
    S->>D: append assistant message and persist
    S-->>C: owner-only type message.done
    S-->>C: owner-only type run.completed
```

The loop runs up to 10 iterations; if the model keeps requesting tools past that,
the service raises `IllegalStateException` and emits `run.failed`.

### 3. Get conversation (REST)

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Zeppelin Server
    participant D as Conversation Store

    C->>S: GET conversation by id
    S->>S: check authentication and notebook read access
    S->>D: find conversation for noteId
    S->>S: check ownerId against authenticated user
    S-->>C: conversation JSON with messages
```

---

## Tool Implementation

### Design

Tools run **in-process** — no external MCP SDK. Each tool implements the `Tool`
interface (`name`, `description`, `parameters`, `call`), and `ToolExecutor` indexes
them by name and exposes their specs to the model. The `parameters()` map is a
JSON-Schema object handed to OpenAI as a `FunctionTool`; the same tool objects
work across providers because only `OpenAiChatModel` translates specs into the
provider's tool format.

```
NotebookAssistantService.runLoop  (tool-loop orchestration, emits events via sink)
    │
    ├── ChatModel.stream          (provider-neutral; OpenAiChatModel = Responses API)
    │
    └── ToolExecutor.callTool     (name → Tool.call) → ToolResult
             │
             ▼
        Tool (e.g. ListParagraphsTool) → NotebookService (Zeppelin core)
```

`ToolExecutor.callTool` never throws: a missing tool or a thrown exception is
captured as `new ToolResult(null, errorMessage)`.

### `Tool` interface

```java
public interface Tool {
  String name();
  String description();
  Map<String, Object> parameters();   // JSON-Schema object
  Object call(String noteId, Map<String, Object> args, ServiceContext ctx) throws IOException;
}
```

---

## Tools (LLM → Zeppelin)

Only one tool is currently registered. Descriptions are read by the model, so
they stay in English.

### `list_paragraphs`

Return the list of visible paragraphs in the notebook under the requesting
user's notebook read permission.

```json
{
  "name": "list_paragraphs",
  "description": "List the visible paragraphs of the notebook.",
  "parameters": { "type": "object", "properties": {} }
}
```

Result (`ToolResult.value`):
```json
[
  { "id": "20150212-145404", "title": "Load data", "index": 0,
    "interpreter": "python", "text": "%python\ndf = pd.read_csv(...)" },
  { "id": "20150212-145500", "title": "Visualize", "index": 1,
    "interpreter": "sql",    "text": "%sql\nSELECT ..." }
]
```

Conversation data is stored separately and is never part of the paragraph result.

---

## System Prompt (instructions)

```
You are an AI assistant integrated into Apache Zeppelin, a web-based notebook.
You are talking within the context of a single notebook.
Answer the user's questions concisely and clearly.
```

---

## Configuration

Add the following to `zeppelin-site.xml` (Zeppelin config keys use dot separators):

```xml
<!-- OpenAI API key -->
<property>
  <name>zeppelin.notebook.assistant.openai.api.key</name>
  <value></value>
</property>

<!-- Model to use (a reasoning model requiring the Responses API is fine) -->
<property>
  <name>zeppelin.notebook.assistant.openai.model</name>
  <value>gpt-...</value>
</property>

<!-- Enable the Notebook Assistant feature -->
<property>
  <name>zeppelin.notebook.assistant.enable</name>
  <value>false</value>
</property>
```

The API key is excluded from `ConfigurationService` responses so it never reaches
the frontend.

---

## Error Cases

| Condition | Result |
|-----------|--------|
| Feature disabled / API key not configured | `run.failed` (during a run); REST CRUD → 503 |
| Note not found | `run.failed`; REST → 404 |
| Conversation not found | `run.failed`; REST → 404 |
| Anonymous user, missing notebook read access, or non-owner content/mutation request | `run.failed` to requester only; REST → 403 |
| Tool lacks required notebook write/run permission | Tool error; must not perform the operation |
| OpenAI / tool / save error mid-run | `run.failed` (code `internal_error`) |
| Tool loop exceeds 10 iterations | `run.failed` |

REST CRUD endpoints still map exceptions to HTTP status (JAX-RS
`WebApplicationExceptionMapper`). Over WS there is no status code, so every
failure is surfaced as a `run.failed` event carrying `{ code, message }`.

---

## Implementation Status

| Component | Status |
|-----------|--------|
| Conversation CRUD (list/create/get/delete) — REST | Existing; metadata-only list and owner enforcement pending |
| `GET .../messages` (cursor pagination) — REST | Existing; owner enforcement pending |
| Separate conversation storage (`ConversationStore` + `ConversationJsonCodec`) | Pending; replace existing hidden-paragraph storage |
| Required server-assigned `ownerId`; authenticated creation with notebook read access | Pending |
| Per-note lock (`noteLocks`) | Done |
| `Tool` / `ToolExecutor` / `ListParagraphsTool` | Done |
| `ChatModel` seam + `OpenAiChatModel` (Responses API, streaming) | Done |
| `sendMessage` run loop + tool dispatch | Done |
| WebSocket streaming (`ASSISTANT_SEND_MESSAGE` / `ASSISTANT_EVENT`, owner only) | Existing streaming; replace notebook-wide broadcast and enforce ownership |
| Angular UI + WS OP enum sync | Out of scope (delivered separately) |

## Out of Scope

- Conversation cleanup when a notebook is deleted
- Migration of legacy conversations without owner information
- Conversation title editing (may be added later)
- Additional paragraph tools (get/add/update/delete, run) — only `list_paragraphs` today
- Bidirectional run control over WS (stop / interrupt / steer)
- Concurrency within a single conversation (concurrent runs on the same
  conversation can interleave history, including sends from multiple owner tabs)
- LLM providers other than OpenAI (the `ChatModel` seam is ready, but only the
  OpenAI adapter exists)
