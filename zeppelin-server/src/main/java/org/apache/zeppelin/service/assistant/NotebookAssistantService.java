/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.apache.zeppelin.service.assistant;

import com.google.gson.Gson;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.concurrent.ConcurrentHashMap;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.ClientErrorException;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.ServiceUnavailableException;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Response;
import org.apache.zeppelin.notebook.AuthorizationService;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.rest.exception.NoteNotFoundException;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.service.ServiceContext;
import org.apache.zeppelin.user.AuthenticationInfo;

public class NotebookAssistantService {

  private static final Logger LOGGER = LoggerFactory.getLogger(NotebookAssistantService.class);
  private static final Gson GSON = new Gson();

  private static final String INSTRUCTIONS =
      "You are an AI assistant integrated into Apache Zeppelin, a web-based notebook.\n"
          + "You are talking within the context of a single notebook.\n"
          + "Answer the user's questions concisely and clearly.";

  private final AuthorizationService authorizationService;

  private final Set<String> busyConversations = ConcurrentHashMap.newKeySet();

  private final boolean available;
  private final Notebook notebook;
  private final ChatModel modelClient;
  private final ConversationRepository conversationRepository;
  private final ToolExecutor toolExecutor;

  public NotebookAssistantService(
      boolean available,
      Notebook notebook,
      ChatModel modelClient,
      NotebookService notebookService,
      AuthorizationService authorizationService,
      ConversationRepository conversationRepository
  ) {
    this.authorizationService = authorizationService;
    this.available = available;
    this.notebook = notebook;
    this.modelClient = modelClient;
    this.conversationRepository = conversationRepository;
    this.toolExecutor = new ToolExecutor(
        List.of(
            new ListParagraphsTool(notebookService)
        )
    );
  }

  public List<Conversation> listConversations(
      String noteId,
      ServiceContext ctx
  ) throws IOException {
    if (!available) throw new ServiceUnavailableException();
    if (!authorizationService.isReader(noteId, ctx.getUserAndRoles())) {
      throw new ForbiddenException();
    }

    return notebook.processNote(noteId, note -> {
      if (note == null) throw new NoteNotFoundException(noteId);
      return conversationRepository.findAll(noteId);
    });
  }

  public Conversation createConversation(
      String noteId,
      String title,
      ServiceContext ctx
  ) throws IOException {
    if (!available) throw new ServiceUnavailableException();
    if (!authorizationService.isReader(noteId, ctx.getUserAndRoles())) {
      throw new ForbiddenException();
    }
    AuthenticationInfo authInfo = ctx.getAutheInfo();
    if (AuthenticationInfo.isAnonymous(authInfo)) throw new ForbiddenException();

    return notebook.processNote(noteId, note -> {
      if (note == null) throw new NoteNotFoundException(noteId);
      var conversation = Conversation.create(noteId, title, authInfo.getUser());
      conversationRepository.create(conversation);
      return conversation;
    });
  }

  public Conversation getConversation(
      String noteId,
      String conversationId,
      ServiceContext ctx
  ) throws IOException {
    if (!available) throw new ServiceUnavailableException();
    if (!authorizationService.isReader(noteId, ctx.getUserAndRoles())) {
      throw new ForbiddenException();
    }
    return notebook.processNote(noteId, note -> {
      if (note == null) throw new NoteNotFoundException(noteId);
      return conversationRepository.find(noteId, conversationId).orElseThrow();
    });
  }

  public Conversation updateTitle(
      String noteId,
      String conversationId,
      String title,
      ServiceContext ctx
  ) throws IOException {
    if (!available) throw new ServiceUnavailableException();
    if (!busyConversations.add(conversationId)) {
      throw new ClientErrorException("", Response.Status.CONFLICT);
    }
    try {
      Conversation conversation = getConversation(noteId, conversationId, ctx);
      if (!conversation.isOwner(ctx.getAutheInfo().getUser())) throw new ForbiddenException();
      return notebook.processNote(noteId, note -> {
        if (note == null) throw new NoteNotFoundException(noteId);
        conversationRepository.update(conversation, c -> c.setTitle(title));
        return conversation;
      });
    } finally {
      busyConversations.remove(conversationId);
    }
  }

  public void deleteConversation(
      String noteId,
      String conversationId,
      ServiceContext ctx
  ) throws IOException {
    if (!available) throw new ServiceUnavailableException();
    if (!busyConversations.add(conversationId)) {
      throw new ClientErrorException("", Response.Status.CONFLICT);
    }
    try {
      Conversation conversation = getConversation(noteId, conversationId, ctx);
      if (!conversation.isOwner(ctx.getAutheInfo().getUser())) throw new ForbiddenException();
      notebook.processNote(noteId, note -> {
        if (note == null) throw new NoteNotFoundException(noteId);
        conversationRepository.delete(noteId, conversationId);
        return null;
      });
    } finally {
      busyConversations.remove(conversationId);
    }
  }

  public Messages listMessages(
      String noteId,
      String conversationId,
      String cursor,
      int limit,
      ServiceContext ctx
  ) throws IOException {
    if (limit <= 0) throw new BadRequestException("limit must be positive");
    List<Message> all = getConversation(noteId, conversationId, ctx).getMessages();

    int cursorIdx = -1;
    if (cursor != null) {
      for (int i = 0; i < all.size(); i++) {
        if (all.get(i).getId().equals(cursor)) {
          cursorIdx = i;
          break;
        }
      }
      if (cursorIdx == -1) {
        throw new NotFoundException("Message not found: " + cursor);
      }
    }

    int endExclusive = (cursor == null) ? all.size() : cursorIdx;
    int start = Math.max(0, endExclusive - limit);
    List<Message> page = new ArrayList<>(all.subList(start, endExclusive));
    Collections.reverse(page);
    String next = (start > 0) ? all.get(start).getId() : null;
    return new Messages(page, next);
  }

  /**
   * Classifies a run failure into a {@code run.failed} error code. The WS flow has no HTTP
   * status, so the service's own {@link WebApplicationException}s (403/404/409/503) are mapped
   * to a code and keep their message, which is safe and user-facing. Any other failure
   * (OpenAI, tool, I/O, save, loop limit) is reported as {@code internal_error} with a generic
   * message so internal exception detail never reaches the client; the stack is logged above.
   */
  private static AssistantEventPayload.Error toError(Exception e) {
    if (e instanceof WebApplicationException) {
      int status = ((WebApplicationException) e).getResponse().getStatus();
      String code;
      switch (status) {
        case 403:
          code = "forbidden";
          break;
        case 404:
          code = "not_found";
          break;
        case 409:
          code = "conflict";
          break;
        case 503:
          code = "unavailable";
          break;
        default:
          code = "invalid_request";
          break;
      }
      return new AssistantEventPayload.Error(code, e.getMessage());
    }
    return new AssistantEventPayload.Error("internal_error", "Internal error during assistant run");
  }

  public void sendMessage(
      String noteId,
      String conversationId,
      String userContent,
      ServiceContext ctx,
      AssistantEventListener sink
  ) {
    var runId = "run_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    boolean acquired = false;
    try {
      if (!available) throw new ServiceUnavailableException();
      if (userContent == null || userContent.isBlank()) {
        // The model adapter drops a null/blank message, so storing it and running would make
        // the saved history disagree with what the model actually received. Reject up front.
        throw new BadRequestException("message content is required");
      }

      if (!busyConversations.add(conversationId)) {
        throw new ClientErrorException("", Response.Status.CONFLICT);
      }
      acquired = true;
      Conversation conversation = getConversation(noteId, conversationId, ctx);
      if (!conversation.isOwner(ctx.getAutheInfo().getUser())) throw new ForbiddenException();

      persistConversation(noteId, conversation,
          c -> c.addMessage(Message.user(Message.id(), userContent)));

      sink.onEvent(
          AssistantEventType.RUN_STARTED,
          new AssistantEventPayload.RunStarted(runId, Instant.now().toString())
      );

      Map<String, Integer> tokens = new HashMap<>();
      tokens.put("input", 0);
      tokens.put("output", 0);

      runLoop(noteId, conversation, ctx, sink, tokens);

      sink.onEvent(
          AssistantEventType.RUN_COMPLETED,
          new AssistantEventPayload.RunCompleted(
              runId,
              new AssistantEventPayload.Usage(tokens.get("input"), tokens.get("output"))
          )
      );
    } catch (Exception e) {
      LOGGER.error("Error during Notebook Assistant run", e);
      sink.onEvent(
          AssistantEventType.RUN_FAILED,
          new AssistantEventPayload.RunFailed(runId, toError(e))
      );
    } finally {
      if (acquired) busyConversations.remove(conversationId);
    }
  }

  private void runLoop(
      String noteId,
      Conversation conversation,
      ServiceContext ctx,
      AssistantEventListener sink,
      Map<String, Integer> tokens
  ) throws IOException {
    for (int iteration = 0; iteration < 10; iteration++) {
      String assistantId = Message.id();
      var textBuffer = new StringBuilder();
      List<ToolCall> toolCalls = new ArrayList<>();

      modelClient.stream(
          INSTRUCTIONS,
          conversation.getMessages(),
          toolExecutor.specs(),
          event -> {
            if (event instanceof AssistantEvent.TextDelta) {
              String delta = ((AssistantEvent.TextDelta) event).delta;
              textBuffer.append(delta);
              sink.onEvent(
                  AssistantEventType.MESSAGE_DELTA,
                  new AssistantEventPayload.MessageDelta(assistantId, delta)
              );
            } else if (event instanceof AssistantEvent.ToolCall) {
              AssistantEvent.ToolCall tc = (AssistantEvent.ToolCall) event;
              @SuppressWarnings("unchecked")
              Map<String, Object> argsMap = tc.arguments == null || tc.arguments.isBlank()
                  ? new HashMap<>() : GSON.fromJson(tc.arguments, Map.class);
              toolCalls.add(new ToolCall(tc.id, tc.name, argsMap));
            } else if (event instanceof AssistantEvent.Usage) {
              AssistantEvent.Usage u = (AssistantEvent.Usage) event;
              tokens.put("input", tokens.get("input") + u.inputTokens);
              tokens.put("output", tokens.get("output") + u.outputTokens);
            }
          }
      );

      if (!toolCalls.isEmpty()) {
        Message.Assistant assistantMsg = Message.assistant(assistantId, textBuffer.toString());
        for (ToolCall tc : toolCalls) {
          assistantMsg.addToolCall(tc);
        }
        List<Message> turn = new ArrayList<>();
        turn.add(assistantMsg);

        // Close the streamed message so per-message clients can finalize it, even when the
        // same turn also requests tools.
        if (textBuffer.length() > 0) {
          sink.onEvent(
              AssistantEventType.MESSAGE_DONE,
              new AssistantEventPayload.MessageDone(assistantId, textBuffer.toString())
          );
        }

        for (ToolCall tc : assistantMsg.getToolCalls()) {
          sink.onEvent(
              AssistantEventType.TOOL_CALL_STARTED,
              new AssistantEventPayload.ToolCallStarted(tc.getId(), tc.getName(), tc.getArguments())
          );
          ToolResult result = toolExecutor.callTool(noteId, tc.getName(), tc.getArguments(), ctx);
          tc.setResult(result);
          turn.add(Message.tool(Message.id(), tc.getId(), GSON.toJson(result)));
          sink.onEvent(
              AssistantEventType.TOOL_CALL_DONE,
              new AssistantEventPayload.ToolCallDone(tc.getId(), result)
          );
        }
        // Persist the assistant message and all its tool results in one write, so a failed
        // save never leaves a stored turn with more tool calls than results.
        persistConversation(noteId, conversation, c -> turn.forEach(c::addMessage));
      } else {
        String assistantText = textBuffer.toString();
        persistConversation(noteId, conversation,
            c -> c.addMessage(Message.assistant(assistantId, assistantText)));
        sink.onEvent(
            AssistantEventType.MESSAGE_DONE,
            new AssistantEventPayload.MessageDone(assistantId, assistantText)
        );
        return;
      }
    }
    throw new IllegalStateException("Tool iteration limit exceeded");
  }

  private void persistConversation(
      String noteId,
      Conversation conversation,
      Consumer<Conversation> change
  ) throws IOException {
    notebook.processNote(noteId, note -> {
      if (note == null) throw new NoteNotFoundException(noteId);
      conversationRepository.update(conversation, change);
      return null;
    });
  }

}
