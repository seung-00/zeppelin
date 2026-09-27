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

import org.jvnet.hk2.annotations.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.function.Function;
import jakarta.inject.Inject;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.ServiceUnavailableException;
import org.apache.zeppelin.conf.ZeppelinConfiguration;
import org.apache.zeppelin.notebook.AuthorizationService;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.rest.exception.NoteNotFoundException;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.service.ServiceContext;
import org.apache.zeppelin.user.AuthenticationInfo;

@Service
public class NotebookAssistantService {

  private static final Logger LOGGER = LoggerFactory.getLogger(NotebookAssistantService.class);
  private static final Gson GSON = new Gson();

  private static final String INSTRUCTIONS =
      "You are an AI assistant integrated into Apache Zeppelin, a web-based notebook.\n"
          + "You are talking within the context of a single notebook.\n"
          + "Answer the user's questions concisely and clearly.";

  private final AuthorizationService authorizationService;

  private final Map<String, Object> noteLocks = new ConcurrentHashMap<>();

  private final ZeppelinConfiguration zConf;
  private final Notebook notebook;
  private final ChatModel modelClient;
  private final ToolExecutor toolExecutor;

  @Inject
  public NotebookAssistantService(
      ZeppelinConfiguration zConf,
      Notebook notebook,
      ChatModel modelClient,
      NotebookService notebookService,
      AuthorizationService authorizationService
  ) {
    this.authorizationService = authorizationService;
    this.zConf = zConf;
    this.notebook = notebook;
    this.modelClient = modelClient;
    this.toolExecutor = new ToolExecutor(
        List.of(
            new ListParagraphsTool(notebookService)
        )
    );
  }

  private Object lockFor(String noteId) {
    return noteLocks.computeIfAbsent(noteId, k -> new Object());
  }

  private void ensureAvailable() {
    if (
        !zConf.isNotebookAssistantEnabled() ||
            zConf.getNotebookAssistantApiKey() == null ||
            zConf.getNotebookAssistantApiKey().isBlank()
    ) {
      throw new ServiceUnavailableException("Notebook Assistant is not configured");
    }
  }

  public List<Conversation> listConversations(
      String noteId,
      ServiceContext ctx
  ) throws IOException {
    ensureAvailable();
    checkPermission(noteId, ctx, false);
    return readStore(noteId, ctx.getAutheInfo(), ConversationStore::findAll);
  }

  public Conversation createConversation(
      String noteId,
      String title,
      ServiceContext ctx
  ) throws IOException {
    ensureAvailable();
    checkPermission(noteId, ctx, true);
    var conversation = Conversation.create(noteId, title);
    synchronized (lockFor(noteId)) {
      mutateStore(noteId, ctx.getAutheInfo(), store -> store.add(conversation));
    }
    return conversation;
  }

  public Conversation getConversation(
      String noteId,
      String conversationId,
      ServiceContext ctx
  ) throws IOException {
    ensureAvailable();
    checkPermission(noteId, ctx, false);
    return readStore(noteId, ctx.getAutheInfo(), store -> store.find(conversationId))
        .orElseThrow(NotFoundException::new);
  }

  public void deleteConversation(
      String noteId,
      String conversationId,
      ServiceContext ctx
  ) throws IOException {
    ensureAvailable();
    checkPermission(noteId, ctx, true);
    synchronized (lockFor(noteId)) {
      mutateStore(noteId, ctx.getAutheInfo(), store -> {
        if (!store.remove(conversationId)) {
          throw new NotFoundException("Conversation not found: " + conversationId);
        }
      });
    }
  }

  public Messages listMessages(
      String noteId,
      String conversationId,
      String cursor,
      int limit,
      ServiceContext ctx
  ) throws IOException {
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

  private <T> T readStore(
      String noteId,
      AuthenticationInfo subject,
      Function<ConversationStore, T> mapper
  ) throws IOException {
    return notebook.processNote(noteId, note -> {
      if (note == null) {
        throw new NoteNotFoundException(noteId);
      }
      return mapper.apply(ConversationStore.attach(note, subject));
    });
  }

  private void mutateStore(
      String noteId,
      AuthenticationInfo subject,
      Consumer<ConversationStore> consumer
  ) throws IOException {
    notebook.processNote(noteId, note -> {
      if (note == null) {
        throw new NoteNotFoundException(noteId);
      }
      ConversationStore store = ConversationStore.attach(note, subject);
      consumer.accept(store);
      store.flush();
      notebook.saveNote(note, subject);
      return null;
    });
  }

  private void checkPermission(
      String noteId,
      ServiceContext ctx,
      boolean write
  ) {
    boolean allowed = write
        ? authorizationService.isWriter(noteId, ctx.getUserAndRoles())
        : authorizationService.isReader(noteId, ctx.getUserAndRoles());
    if (!allowed) {
      throw new ForbiddenException("Insufficient notebook privileges");
    }
  }

  public void sendMessage(
      String noteId,
      String conversationId,
      String userContent,
      ServiceContext ctx,
      AssistantEventListener sink
  ) {
    var runId = "run_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    try {
      ensureAvailable();
      checkPermission(noteId, ctx, true);

      var conversation = getConversation(noteId, conversationId, ctx);
      conversation.addMessage(Message.user(Message.id(), userContent));
      persistConversation(noteId, conversation, ctx.getAutheInfo());

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
          new AssistantEventPayload.RunFailed(
              runId,
              new AssistantEventPayload.Error("internal_error", String.valueOf(e.getMessage()))
          )
      );
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
        conversation.addMessage(assistantMsg);

        for (ToolCall tc : assistantMsg.getToolCalls()) {
          sink.onEvent(
              AssistantEventType.TOOL_CALL_STARTED,
              new AssistantEventPayload.ToolCallStarted(tc.getId(), tc.getName(), tc.getArguments())
          );
          ToolResult result = toolExecutor.callTool(noteId, tc.getName(), tc.getArguments(), ctx);
          tc.setResult(result);
          conversation.addMessage(Message.tool(Message.id(), tc.getId(), GSON.toJson(result)));
          persistConversation(noteId, conversation, ctx.getAutheInfo());
          sink.onEvent(
              AssistantEventType.TOOL_CALL_DONE,
              new AssistantEventPayload.ToolCallDone(tc.getId(), result)
          );
        }
      } else {
        String assistantText = textBuffer.toString();
        conversation.addMessage(Message.assistant(assistantId, assistantText));
        persistConversation(noteId, conversation, ctx.getAutheInfo());
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
      AuthenticationInfo subject
  ) throws IOException {
    synchronized (lockFor(noteId)) {
      mutateStore(noteId, subject, store -> {
        if (!store.contains(conversation.getId())) {
          throw new NotFoundException("Conversation not found: " + conversation.getId());
        }
        store.replace(conversation);
      });
    }
  }
}
