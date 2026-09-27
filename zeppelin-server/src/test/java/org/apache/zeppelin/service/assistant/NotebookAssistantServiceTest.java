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

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.google.gson.JsonParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.NotFoundException;
import org.apache.zeppelin.conf.ZeppelinConfiguration;
import org.apache.zeppelin.interpreter.InterpreterFactory;
import org.apache.zeppelin.notebook.AuthorizationService;
import org.apache.zeppelin.notebook.Note;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.notebook.Notebook.NoteProcessor;
import org.apache.zeppelin.notebook.Paragraph;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.service.ServiceContext;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class NotebookAssistantServiceTest {
  private Notebook notebook;
  private Note note;
  private AuthorizationService authorization;
  private ChatModel chatModel;
  private NotebookAssistantService service;
  private Conversation conversation;
  private final ServiceContext ctx = new ServiceContext(AuthenticationInfo.ANONYMOUS, Set.of("user"));

  @BeforeEach
  void setUp() throws Exception {
    var conf = mock(ZeppelinConfiguration.class);
    when(conf.isNotebookAssistantEnabled()).thenReturn(true);
    when(conf.getNotebookAssistantApiKey()).thenReturn("test-key");
    notebook = mock(Notebook.class);
    note = new Note();
    note.setInterpreterFactory(mock(InterpreterFactory.class));
    when(notebook.processNote(anyString(), any())).thenAnswer(invocation -> {
      NoteProcessor<?> processor = invocation.getArgument(1);
      return processor.process(note);
    });
    authorization = mock(AuthorizationService.class);
    when(authorization.isReader(anyString(), anySet())).thenReturn(true);
    when(authorization.isWriter(anyString(), anySet())).thenReturn(true);
    chatModel = mock(ChatModel.class);
    service = new NotebookAssistantService(conf, notebook,
        chatModel, mock(NotebookService.class), authorization);
    conversation = service.createConversation("note", "test", ctx);
  }

  @Test
  void rejectsReadersAndWritersBeforeAccessingStorage() {
    when(authorization.isReader(anyString(), anySet())).thenReturn(false);
    when(authorization.isWriter(anyString(), anySet())).thenReturn(false);
    assertThrows(ForbiddenException.class, () -> service.listConversations("note", ctx));
    assertThrows(ForbiddenException.class, () -> service.createConversation("note", "title", ctx));
    assertThrows(ForbiddenException.class, () -> service.deleteConversation("note", "id", ctx));
  }

  @Test
  void conversationStorageRoundTrips() throws Exception {
    service.createConversation("note", "second", ctx);
    List<Conversation> loaded = service.listConversations("note", ctx);
    assertEquals(2, loaded.size());
    assertEquals("test", loaded.get(0).getTitle());
    assertEquals("second", loaded.get(1).getTitle());
    assertEquals(1, note.getParagraphCount());
  }

  @Test
  void malformedStorageSurfacesToCaller() throws Exception {
    Paragraph marker = note.getParagraphs().stream()
        .filter(p -> Boolean.TRUE.equals(p.getConfig().get("notebookAssistant")))
        .findFirst().orElseThrow();
    marker.setText("{broken");
    assertThrows(JsonParseException.class, () -> service.listConversations("note", ctx));
  }

  @Test
  void listMessagesReturnsLatestFirst() throws Exception {
    Conversation conversation = service.createConversation("note", "paging", ctx);
    String id = conversation.getId();
    // Add messages through the note marker directly
    Conversation stored = service.getConversation("note", id, ctx);
    stored.addMessage(Message.user(Message.id(), "m1"));
    stored.addMessage(Message.user(Message.id(), "m2"));
    // persist via ConversationStore by saving the note paragraph directly
    Paragraph marker = note.getParagraphs().stream()
        .filter(p -> Boolean.TRUE.equals(p.getConfig().get(ConversationStore.PARAGRAPH_CONFIG_KEY)))
        .findFirst().orElseThrow();
    marker.setText(ConversationJsonCodec.serialize(List.of(stored)));

    Messages page = service.listMessages("note", id, null, 10, ctx);

    assertEquals("m2", ((Message.User) page.messages.get(0)).getContent());
    assertEquals("m1", ((Message.User) page.messages.get(1)).getContent());
    assertNull(page.nextCursor);
  }

  @Test
  void listMessagesPaginatesWithCursor() throws Exception {
    Conversation conversation = service.createConversation("note", "paging", ctx);
    String id = conversation.getId();
    Conversation stored = service.getConversation("note", id, ctx);
    for (String c : new String[]{"m1", "m2", "m3", "m4"}) {
      stored.addMessage(Message.user(Message.id(), c));
    }
    Paragraph marker = note.getParagraphs().stream()
        .filter(p -> Boolean.TRUE.equals(p.getConfig().get(ConversationStore.PARAGRAPH_CONFIG_KEY)))
        .findFirst().orElseThrow();
    marker.setText(ConversationJsonCodec.serialize(List.of(stored)));

    Messages page1 = service.listMessages("note", id, null, 2, ctx);
    assertEquals(List.of("m4", "m3"), page1.messages.stream()
        .map(m -> ((Message.User) m).getContent()).collect(Collectors.toList()));
    assertNotNull(page1.nextCursor);

    Messages page2 = service.listMessages("note", id, page1.nextCursor, 2, ctx);
    assertEquals(List.of("m2", "m1"), page2.messages.stream()
        .map(m -> ((Message.User) m).getContent()).collect(Collectors.toList()));
    assertNull(page2.nextCursor);
  }

  @Test
  void listMessagesThrowsForUnknownCursor() throws Exception {
    assertThrows(NotFoundException.class,
        () -> service.listMessages("note", conversation.getId(), "msg_unknown", 10, ctx));
  }

  @Test
  void sendMessageStreamsEventsToListener() {
    doAnswer(invocation -> {
      Consumer<AssistantEvent> consumer = invocation.getArgument(3);
      consumer.accept(new AssistantEvent.TextDelta("Hello"));
      return null;
    }).when(chatModel).stream(any(), any(), any(), any());

    List<AssistantEventType> events = new ArrayList<>();
    service.sendMessage("note", conversation.getId(), "hi", ctx,
        (type, payload) -> events.add(type));

    assertEquals(List.of(
        AssistantEventType.RUN_STARTED,
        AssistantEventType.MESSAGE_DELTA,
        AssistantEventType.MESSAGE_DONE,
        AssistantEventType.RUN_COMPLETED), events);
  }
}
