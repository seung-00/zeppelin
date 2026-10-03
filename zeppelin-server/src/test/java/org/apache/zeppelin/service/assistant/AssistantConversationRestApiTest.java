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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.Set;
import org.apache.zeppelin.rest.AssistantConversationRestApi;
import org.apache.zeppelin.service.AuthenticationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AssistantConversationRestApiTest {
  private AssistantConversationRestApi api;
  private NotebookAssistantService service;

  @BeforeEach
  void setUp() {
    AuthenticationService authentication = mock(AuthenticationService.class);
    when(authentication.getPrincipal()).thenReturn("alice");
    when(authentication.getAssociatedRoles()).thenReturn(Set.of());
    service = mock(NotebookAssistantService.class);
    api = new AssistantConversationRestApi(authentication, service);
  }

  @Test
  void malformedJsonBodyIsBadRequestNotServerError() {
    // Parsing happens before any service/auth call, so a 400 is raised up front.
    assertThrows(BadRequestException.class, () -> api.create("note", "{"));
    assertThrows(BadRequestException.class, () -> api.updateTitle("note", "conv", "{"));
  }

  @Test
  void onlyDetailResponseIncludesMessages() throws Exception {
    Conversation conversation = Conversation.create("note", "test", "alice");
    conversation.addMessage(Message.user("msg_1", "hello"));
    String id = conversation.getId();
    when(service.listConversations(eq("note"), any())).thenReturn(List.of(conversation));
    when(service.createConversation(eq("note"), eq("test"), any())).thenReturn(conversation);
    when(service.updateTitle(eq("note"), eq(id), eq("renamed"), any())).thenAnswer(call -> {
      conversation.setTitle("renamed");
      return conversation;
    });
    when(service.getConversation(eq("note"), eq(id), any())).thenReturn(conversation);

    try (Response list = api.list("note");
         Response create = api.create("note", "{\"title\":\"test\"}");
         Response update = api.updateTitle("note", id, "{\"title\":\"renamed\"}");
         Response detail = api.get("note", id)) {
      JsonObject summary = JsonParser.parseString((String) list.getEntity()).getAsJsonObject()
          .getAsJsonArray("body").get(0).getAsJsonObject();
      assertEquals(Set.of("id", "noteId", "ownerId", "title", "createdAt", "updatedAt"),
          summary.keySet());
      assertEquals(id, summary.get("id").getAsString());
      JsonObject created = JsonParser.parseString((String) create.getEntity()).getAsJsonObject()
          .getAsJsonObject("body");
      JsonObject updated = JsonParser.parseString((String) update.getEntity()).getAsJsonObject()
          .getAsJsonObject("body");
      assertEquals(201, create.getStatus());
      assertEquals(200, update.getStatus());
      assertEquals(summary.keySet(), created.keySet());
      assertEquals(summary.keySet(), updated.keySet());
      assertFalse(created.has("messages"));
      assertFalse(updated.has("messages"));
      assertEquals("renamed", updated.get("title").getAsString());
      JsonObject detailed = JsonParser.parseString((String) detail.getEntity()).getAsJsonObject()
          .getAsJsonObject("body");
      assertEquals(id, detailed.get("id").getAsString());
      assertEquals("hello", detailed.getAsJsonArray("messages").get(0).getAsJsonObject()
          .get("content").getAsString());
    }
  }
}
