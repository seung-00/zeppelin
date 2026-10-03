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

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.ClientErrorException;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.ServiceUnavailableException;
import org.apache.zeppelin.interpreter.InterpreterFactory;
import org.apache.zeppelin.notebook.AuthorizationService;
import org.apache.zeppelin.notebook.Note;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.notebook.Notebook.NoteProcessor;
import org.apache.zeppelin.rest.exception.NoteNotFoundException;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.service.ServiceContext;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.glassfish.hk2.api.ServiceLocator;
import org.glassfish.hk2.utilities.ServiceLocatorUtilities;
import org.glassfish.hk2.utilities.binding.AbstractBinder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class NotebookAssistantServiceTest {
  private Notebook notebook;
  private Note note;
  private AuthorizationService authorization;
  private ChatModel chatModel;
  private NotebookAssistantService service;
  private Conversation conversation;
  private File assistantDir;
  private ConversationRepository repository;
  private FileConversationRepository fileRepository;

  // Owner of the conversation created in setUp.
  private final ServiceContext ctx =
      new ServiceContext(new AuthenticationInfo("alice"), Set.of("user"));
  // A different authenticated user with notebook read access.
  private final ServiceContext otherCtx =
      new ServiceContext(new AuthenticationInfo("bob"), Set.of("user"));
  private final ServiceContext anonCtx =
      new ServiceContext(AuthenticationInfo.ANONYMOUS, Set.of("user"));

  @BeforeEach
  void setUp(@TempDir File tempDir) throws Exception {
    assistantDir = tempDir;
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
    fileRepository = new FileConversationRepository(assistantDir);
    repository = mock(ConversationRepository.class,
        org.mockito.AdditionalAnswers.delegatesTo(fileRepository));
    service = new NotebookAssistantService(true, notebook,
        chatModel, mock(NotebookService.class), authorization, repository);
    conversation = service.createConversation("note", "test", ctx);
  }

  /** Directly rewrite conversation files to inject state the service cannot. */
  private void writeStore(List<Conversation> conversations) throws Exception {
    for (Conversation conversation : conversations) {
      Files.writeString(conversationFile(conversation).toPath(),
          ConversationJsonCodec.serialize(conversation));
    }
  }

  private File conversationFile(Conversation conversation) {
    return new File(new File(assistantDir, conversation.getNoteId()), conversation.getId() + ".json");
  }

  @Test
  void registeredInstanceKeepsAvailabilityIndependentOfBooleanBindings() {
    NotebookAssistantService unavailable = new NotebookAssistantService(
        false, notebook, chatModel, mock(NotebookService.class), authorization, repository);
    ServiceLocator locator = ServiceLocatorUtilities.bind(new AbstractBinder() {
      @Override
      protected void configure() {
        bind(true).to(boolean.class);
        bind(unavailable).to(NotebookAssistantService.class);
      }
    });
    try {
      assertSame(unavailable, locator.getService(NotebookAssistantService.class));
      assertSame(unavailable, locator.getService(NotebookAssistantService.class));
      clearInvocations(notebook, repository, chatModel, authorization);
      ServiceUnavailableException error = assertThrows(ServiceUnavailableException.class,
          () -> unavailable.createConversation("note", "title", ctx));
      assertEquals(503, error.getResponse().getStatus());
      verifyNoInteractions(notebook, repository, chatModel, authorization);
    } finally {
      locator.shutdown();
    }
  }

  @Test
  void rejectsNonReadersBeforeAccessingStorage() {
    when(authorization.isReader(anyString(), anySet())).thenReturn(false);
    assertThrows(ForbiddenException.class, () -> service.listConversations("note", ctx));
    assertThrows(ForbiddenException.class, () -> service.createConversation("note", "title", ctx));
    assertThrows(ForbiddenException.class,
        () -> service.deleteConversation("note", conversation.getId(), ctx));
  }

  @Test
  void anonymousCannotCreate() {
    assertThrows(ForbiddenException.class,
        () -> service.createConversation("note", "title", anonCtx));
  }

  @Test
  void createPersistsBeforeLeavingNoteScope() throws Exception {
    File directory = new File(assistantDir, "scoped-note");
    doAnswer(invocation -> {
      assertFalse(directory.exists());
      NoteProcessor<?> processor = invocation.getArgument(1);
      Object result = processor.process(note);
      assertTrue(conversationFile((Conversation) result).exists());
      return result;
    }).when(notebook).processNote(eq("scoped-note"), any());
    service.createConversation("scoped-note", "test", ctx);
  }

  @Test
  void missingNoteDoesNotCreateConversationFile() throws Exception {
    doAnswer(invocation -> {
      NoteProcessor<?> processor = invocation.getArgument(1);
      return processor.process(null);
    }).when(notebook).processNote(eq("missing"), any());
    assertThrows(NoteNotFoundException.class,
        () -> service.createConversation("missing", "test", ctx));
    assertFalse(new File(assistantDir, "missing").exists());
  }

  @Test
  void conversationStorageRoundTrips() throws Exception {
    service.createConversation("note", "second", ctx);
    List<Conversation> loaded = service.listConversations("note", ctx);
    assertEquals(2, loaded.size());
    assertEquals("alice", loaded.get(0).getOwnerId());
    assertEquals("test", loaded.get(0).getTitle());
    assertEquals("second", loaded.get(1).getTitle());
    assertEquals(2, new File(assistantDir, "note").listFiles().length);
    assertFalse(new File(assistantDir, "note.json").exists());
  }

  @Test
  void listingPropagatesFileReadFailuresAsIOException() throws Exception {
    File unreadable = new File(new File(assistantDir, "note"), "unreadable.json");
    assertTrue(unreadable.mkdir());
    assertThrows(java.io.IOException.class, () -> repository.findAll("note"));
  }

  @Test
  void serviceReadsFromInjectedRepository() throws Exception {
    ConversationRepository alternate = mock(ConversationRepository.class);
    when(alternate.findAll("note")).thenReturn(List.of(conversation));
    when(alternate.find("note", conversation.getId()))
        .thenReturn(java.util.Optional.of(conversation));
    NotebookAssistantService alternateService = new NotebookAssistantService(
        true, notebook, chatModel, mock(NotebookService.class), authorization, alternate);
    assertEquals(List.of(conversation), alternateService.listConversations("note", ctx));
    assertSame(conversation, alternateService.getConversation("note", conversation.getId(), ctx));
    verify(alternate).findAll("note");
    verify(alternate).find("note", conversation.getId());
  }

  @Test
  void duplicateConversationCreationDoesNotOverwriteStoredData() throws Exception {
    File file = conversationFile(conversation);
    String original = Files.readString(file.toPath());
    conversation.setTitle("discarded");
    assertThrows(IllegalStateException.class, () -> repository.create(conversation));
    assertEquals(original, Files.readString(file.toPath()));
  }

  @Test
  void repositoryUpdatesEntitiesWithoutRecreatingDeletedConversations() throws Exception {
    String id = conversation.getId();
    String createdAt = conversation.getCreatedAt();
    repository.update(conversation, c -> c.setTitle("renamed"));
    assertEquals("renamed", conversation.getTitle());
    repository.update(conversation, c -> c.addMessage(Message.user("msg_1", "hello")));
    Conversation stored = repository.find("note", id).orElseThrow();
    assertEquals("renamed", stored.getTitle());
    assertEquals("alice", stored.getOwnerId());
    assertEquals(createdAt, stored.getCreatedAt());
    assertEquals(1, stored.getMessages().size());
    assertThrows(IllegalStateException.class, () -> repository.update(conversation, c -> {
      c.setTitle("discarded");
      throw new IllegalStateException("Change failed");
    }));
    assertEquals("renamed", repository.find("note", id).orElseThrow().getTitle());
    repository.delete("note", id);
    assertTrue(repository.find("note", id).isEmpty());
    assertThrows(java.io.IOException.class, () -> repository.delete("note", id));
    assertThrows(java.io.IOException.class,
        () -> repository.update(conversation, c -> fail("Deleted entity must not be changed")));
    assertTrue(repository.findAll("note").isEmpty());
  }

  @Test
  void concurrentUpdatesToDifferentConversationsPreserveBothChanges() throws Exception {
    Conversation second = service.createConversation("note", "second", ctx);
    ExecutorService executor = Executors.newFixedThreadPool(2);
    var barrier = new java.util.concurrent.CyclicBarrier(2);
    try {
      List<Callable<Conversation>> updates = List.of(
          () -> {
            barrier.await(5, TimeUnit.SECONDS);
            return service.updateTitle("note", conversation.getId(), "renamed", ctx);
          },
          () -> {
            barrier.await(5, TimeUnit.SECONDS);
            return service.updateTitle("note", second.getId(), "renamed second", ctx);
          });
      for (var result : executor.invokeAll(updates, 5, TimeUnit.SECONDS)) {
        assertNotNull(result.get());
      }
      assertEquals(List.of("renamed", "renamed second"),
          service.listConversations("note", ctx).stream()
              .map(Conversation::getTitle).collect(Collectors.toList()));
      verify(repository).find("note", conversation.getId());
      verify(repository).find("note", second.getId());
    } finally {
      executor.shutdownNow();
    }
  }

  @Test
  void concurrentCreatesPreserveAllConversations() throws Exception {
    ExecutorService executor = Executors.newFixedThreadPool(8);
    try {
      List<Callable<Conversation>> tasks = new ArrayList<>();
      for (int i = 0; i < 32; i++) {
        String title = "conversation-" + i;
        tasks.add(() -> service.createConversation("note", title, ctx));
      }
      for (var result : executor.invokeAll(tasks, 10, TimeUnit.SECONDS)) {
        assertNotNull(result.get());
      }
      List<Conversation> stored = service.listConversations("note", ctx);
      assertEquals(33, stored.size());
      assertEquals(33, stored.stream().map(Conversation::getId).distinct().count());
    } finally {
      executor.shutdownNow();
    }
  }

  @Test
  void busyConversationRejectsWritesWithoutBlockingCreation() throws Exception {
    CountDownLatch updating = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    doAnswer(invocation -> {
      updating.countDown();
      assertTrue(release.await(5, TimeUnit.SECONDS));
      fileRepository.update(invocation.getArgument(0), invocation.getArgument(1));
      return null;
    }).when(repository).update(any(), any());
    ExecutorService executor = Executors.newSingleThreadExecutor();
    try {
      var first = executor.submit(() -> {
        service.updateTitle("note", conversation.getId(), "renamed", ctx);
        return service.createConversation("note", "first", ctx);
      });
      assertTrue(updating.await(5, TimeUnit.SECONDS));
      service.createConversation("note", "independent", ctx);
      ClientErrorException error = assertThrows(ClientErrorException.class,
          () -> service.deleteConversation("note", conversation.getId(), ctx));
      assertEquals(409, error.getResponse().getStatus());
      assertEquals("", error.getMessage());
      assertThrows(ClientErrorException.class,
          () -> service.updateTitle("note", conversation.getId(), "discarded", ctx));
      release.countDown();
      first.get(5, TimeUnit.SECONDS);
      service.createConversation("note", "after-busy", ctx);
      assertEquals(List.of("renamed", "independent", "first", "after-busy"),
          service.listConversations("note", ctx).stream()
              .map(Conversation::getTitle).collect(Collectors.toList()));
    } finally {
      release.countDown();
      executor.shutdownNow();
    }
  }

  @Test
  void storageFailuresReleaseSlotForAnotherThread() throws Exception {
    File file = conversationFile(conversation);
    Files.writeString(file.toPath(), "{");
    assertThrows(com.google.gson.JsonSyntaxException.class,
        () -> service.updateTitle("note", conversation.getId(), "invalid", ctx));
    writeStore(List.of(conversation));
    String original = Files.readString(file.toPath());
    doThrow(new IllegalStateException("Update failed")).when(repository).update(any(), any());
    assertThrows(IllegalStateException.class,
        () -> service.updateTitle("note", conversation.getId(), "discarded", ctx));
    assertEquals(original, Files.readString(file.toPath()));
    doAnswer(invocation -> {
      fileRepository.update(invocation.getArgument(0), invocation.getArgument(1));
      return null;
    })
        .when(repository).update(any(), any());
    ExecutorService executor = Executors.newSingleThreadExecutor();
    try {
      executor.submit(() -> service.updateTitle("note", conversation.getId(), "after-failure", ctx))
          .get(5, TimeUnit.SECONDS);
      assertEquals("after-failure", service.getConversation("note", conversation.getId(), ctx).getTitle());
    } finally {
      executor.shutdownNow();
    }
  }

  @Test
  void readsAreSharedButMutationsAreOwnerOnly() throws Exception {
    assertTrue(conversation.isOwner("alice"));
    assertFalse(conversation.isOwner("bob"));
    assertFalse(conversation.isOwner(null));
    // A different reader can list and read content.
    assertEquals(1, service.listConversations("note", otherCtx).size());
    assertNotNull(service.getConversation("note", conversation.getId(), otherCtx));
    assertNotNull(service.listMessages("note", conversation.getId(), null, 10, otherCtx));
    // But cannot mutate.
    assertThrows(ForbiddenException.class,
        () -> service.deleteConversation("note", conversation.getId(), otherCtx));
    assertThrows(ForbiddenException.class,
        () -> service.updateTitle("note", conversation.getId(), "x", otherCtx));
    List<AssistantEventType> events = new ArrayList<>();
    service.sendMessage("note", conversation.getId(), "hi", otherCtx,
        (type, payload) -> events.add(type));
    assertEquals(List.of(AssistantEventType.RUN_FAILED), events);
  }

  @Test
  void listMessagesPaginatesWithCursor() throws Exception {
    Conversation stored = service.getConversation("note", conversation.getId(), ctx);
    for (String c : new String[]{"m1", "m2", "m3", "m4"}) {
      stored.addMessage(Message.user(Message.id(), c));
    }
    writeStore(List.of(stored));

    Messages page1 = service.listMessages("note", conversation.getId(), null, 2, ctx);
    assertEquals(List.of("m4", "m3"), page1.messages.stream()
        .map(m -> ((Message.User) m).getContent()).collect(Collectors.toList()));
    assertNotNull(page1.nextCursor);

    Messages page2 = service.listMessages("note", conversation.getId(), page1.nextCursor, 2, ctx);
    assertEquals(List.of("m2", "m1"), page2.messages.stream()
        .map(m -> ((Message.User) m).getContent()).collect(Collectors.toList()));
    assertNull(page2.nextCursor);
  }

  @Test
  void listMessagesRejectsNonPositiveLimit() {
    String id = conversation.getId();
    assertThrows(BadRequestException.class, () -> service.listMessages("note", id, null, 0, ctx));
    assertThrows(BadRequestException.class, () -> service.listMessages("note", id, null, -1, ctx));
  }

  @Test
  void sendMessageStreamsEventsToListener() throws Exception {
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
    Conversation stored = fileRepository.find("note", conversation.getId()).orElseThrow();
    assertEquals(2, stored.getMessages().size());
    assertEquals("hi", ((Message.User) stored.getMessages().get(0)).getContent());
    assertEquals("Hello", ((Message.Assistant) stored.getMessages().get(1)).getContent());
    verify(repository).find("note", conversation.getId());
  }

  @Test
  void nonOwnerRunFailsWithForbiddenCode() {
    List<AssistantEventPayload> payloads = new ArrayList<>();
    service.sendMessage("note", conversation.getId(), "hi", otherCtx,
        (type, payload) -> payloads.add(payload));
    AssistantEventPayload.RunFailed failed = (AssistantEventPayload.RunFailed) payloads.get(0);
    assertEquals("forbidden", failed.error.code);
  }

  @Test
  void internalErrorHidesExceptionMessageFromClient() throws Exception {
    doThrow(new RuntimeException("secret internal detail: api key abc123"))
        .when(chatModel).stream(any(), any(), any(), any());

    List<AssistantEventPayload> payloads = new ArrayList<>();
    service.sendMessage("note", conversation.getId(), "hi", ctx,
        (type, payload) -> payloads.add(payload));

    AssistantEventPayload.RunFailed failed = (AssistantEventPayload.RunFailed)
        payloads.get(payloads.size() - 1);
    assertEquals("internal_error", failed.error.code);
    assertFalse(failed.error.message.contains("secret"));
    assertEquals("after-failure",
        service.updateTitle("note", conversation.getId(), "after-failure", ctx).getTitle());
  }

  @Test
  void rejectsBlankMessageContent() {
    List<AssistantEventType> events = new ArrayList<>();
    service.sendMessage("note", conversation.getId(), null, ctx,
        (type, payload) -> events.add(type));
    assertEquals(List.of(AssistantEventType.RUN_FAILED), events);
    verify(chatModel, never()).stream(any(), any(), any(), any());
  }

  @Test
  void emitsMessageDoneForStreamedTextInToolTurn() throws Exception {
    AtomicInteger calls = new AtomicInteger();
    doAnswer(invocation -> {
      Consumer<AssistantEvent> consumer = invocation.getArgument(3);
      if (calls.getAndIncrement() == 0) {
        consumer.accept(new AssistantEvent.TextDelta("thinking"));
        consumer.accept(new AssistantEvent.ToolCall("call_1", "list_paragraphs", "{}"));
      } else {
        consumer.accept(new AssistantEvent.TextDelta("final"));
      }
      return null;
    }).when(chatModel).stream(any(), any(), any(), any());

    List<AssistantEventPayload.MessageDone> dones = new ArrayList<>();
    service.sendMessage("note", conversation.getId(), "hi", ctx, (type, payload) -> {
      if (type == AssistantEventType.MESSAGE_DONE) {
        dones.add((AssistantEventPayload.MessageDone) payload);
      }
    });

    // One message.done for the text that preceded the tool call, one for the final reply.
    assertEquals(2, dones.size());
    assertEquals("thinking", dones.get(0).content);
    assertEquals("final", dones.get(1).content);
    List<Message> stored = fileRepository.find("note", conversation.getId())
        .orElseThrow().getMessages();
    assertEquals(4, stored.size());
    Message.Assistant toolTurn = (Message.Assistant) stored.get(1);
    assertNotNull(toolTurn.getToolCalls().get(0).getResult());
    assertEquals("call_1", ((Message.Tool) stored.get(2)).getToolCallId());
    assertEquals("final", ((Message.Assistant) stored.get(3)).getContent());
    verify(repository).find("note", conversation.getId());
  }

  @Test
  void rejectsConcurrentRunOnSameConversation() {
    List<AssistantEventType> nested = new ArrayList<>();
    // While one run is streaming, a second run on the same conversation must be rejected.
    doAnswer(invocation -> {
      service.sendMessage("note", conversation.getId(), "again", ctx,
          (type, payload) -> nested.add(type));
      return null;
    }).when(chatModel).stream(any(), any(), any(), any());

    service.sendMessage("note", conversation.getId(), "hi", ctx, (type, payload) -> { });

    assertEquals(List.of(AssistantEventType.RUN_FAILED), nested);
  }

  @Test
  void rejectsDeleteWhileRunInProgress() {
    doAnswer(invocation -> {
      assertThrows(ClientErrorException.class,
          () -> service.deleteConversation("note", conversation.getId(), ctx));
      return null;
    }).when(chatModel).stream(any(), any(), any(), any());

    service.sendMessage("note", conversation.getId(), "hi", ctx, (type, payload) -> { });
  }

  @Test
  void runningConversationRejectsChangesFromOtherThreadsAndReleasesState() throws Exception {
    CountDownLatch streaming = new CountDownLatch(1);
    CountDownLatch finish = new CountDownLatch(1);
    ExecutorService executor = Executors.newSingleThreadExecutor();
    doAnswer(invocation -> {
      streaming.countDown();
      assertTrue(finish.await(5, TimeUnit.SECONDS));
      return null;
    }).when(chatModel).stream(any(), any(), any(), any());
    try {
      var run = executor.submit(() -> service.sendMessage(
          "note", conversation.getId(), "hi", ctx, (type, payload) -> { }));
      assertTrue(streaming.await(5, TimeUnit.SECONDS));
      ClientErrorException conflict = assertThrows(ClientErrorException.class,
          () -> service.updateTitle("note", conversation.getId(), "renamed", ctx));
      assertEquals(409, conflict.getResponse().getStatus());
      assertEquals("", conflict.getMessage());
      assertThrows(ClientErrorException.class,
          () -> service.deleteConversation("note", conversation.getId(), ctx));
      List<AssistantEventPayload> events = new ArrayList<>();
      service.sendMessage("note", conversation.getId(), "again", ctx,
          (type, payload) -> events.add(payload));
      AssistantEventPayload.Error error = ((AssistantEventPayload.RunFailed) events.get(0)).error;
      assertEquals("conflict", error.code);
      assertEquals("", error.message);
      finish.countDown();
      run.get(5, TimeUnit.SECONDS);
      assertEquals("renamed",
          service.updateTitle("note", conversation.getId(), "renamed", ctx).getTitle());
      service.deleteConversation("note", conversation.getId(), ctx);
      assertTrue(service.listConversations("note", ctx).isEmpty());
    } finally {
      finish.countDown();
      executor.shutdownNow();
    }
  }
}
