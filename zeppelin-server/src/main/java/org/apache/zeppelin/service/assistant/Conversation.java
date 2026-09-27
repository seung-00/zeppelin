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

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class Conversation {
  private String id;
  private String noteId;
  private String title;
  private String createdAt;
  private String updatedAt;
  private List<Message> messages;

  Conversation() {
    this.messages = new ArrayList<>();
  }

  public static Conversation create(String noteId, String title) {
    Conversation c = new Conversation();
    c.id = "conv_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    c.noteId = noteId;
    c.title = title != null ? title : "New Conversation";
    c.createdAt = Instant.now().toString();
    c.updatedAt = c.createdAt;
    return c;
  }

  public String getId() { return id; }
  public String getNoteId() { return noteId; }
  public String getTitle() { return title; }
  public String getCreatedAt() { return createdAt; }
  public String getUpdatedAt() { return updatedAt; }
  public List<Message> getMessages() { return messages; }

  public void addMessage(Message message) {
    messages.add(message);
    updatedAt = Instant.now().toString();
  }

  public void touch() {
    updatedAt = Instant.now().toString();
  }
}
