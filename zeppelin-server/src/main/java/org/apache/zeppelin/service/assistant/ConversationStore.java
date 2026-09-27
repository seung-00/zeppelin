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

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.apache.zeppelin.notebook.Note;
import org.apache.zeppelin.notebook.Paragraph;
import org.apache.zeppelin.user.AuthenticationInfo;

final class ConversationStore {

  /**
   * Config key on the hidden marker paragraph that carries the assistant conversation list.
   */
  static final String PARAGRAPH_CONFIG_KEY = "notebookAssistant";

  private final Paragraph paragraph;
  private final List<Conversation> conversations;

  private ConversationStore(Paragraph paragraph, List<Conversation> conversations) {
    this.paragraph = paragraph;
    this.conversations = conversations;
  }

  static ConversationStore attach(Note note, AuthenticationInfo subject) {
    Paragraph marker = findMarker(note).orElseGet(() -> {
      Paragraph p = note.addNewParagraph(subject);
      Map<String, Object> config = new HashMap<>();
      config.put("editorHide", true);
      config.put("tableHide", true);
      config.put("enabled", false);
      config.put(PARAGRAPH_CONFIG_KEY, true);
      p.setConfig(config);
      return p;
    });
    String data = marker.getText();
    List<Conversation> list = (data == null || data.isBlank())
        ? new ArrayList<>()
        : new ArrayList<>(ConversationJsonCodec.deserialize(data));
    return new ConversationStore(marker, list);
  }

  static Optional<Paragraph> findMarker(Note note) {
    return note.getParagraphs().stream()
        .filter(p -> Boolean.TRUE.equals(p.getConfig().get(PARAGRAPH_CONFIG_KEY)))
        .findFirst();
  }

  List<Conversation> findAll() {
    return Collections.unmodifiableList(conversations);
  }

  Optional<Conversation> find(String conversationId) {
    return conversations.stream().filter(c -> c.getId().equals(conversationId)).findFirst();
  }

  void add(Conversation conversation) {
    conversations.add(conversation);
  }

  boolean remove(String conversationId) {
    return conversations.removeIf(c -> c.getId().equals(conversationId));
  }

  boolean contains(String conversationId) {
    return find(conversationId).isPresent();
  }

  /** Replace the conversation whose id matches {@code conversation}. Caller must ensure it exists. */
  void replace(Conversation conversation) {
    for (int i = 0; i < conversations.size(); i++) {
      if (conversations.get(i).getId().equals(conversation.getId())) {
        conversations.set(i, conversation);
        return;
      }
    }
    throw new IllegalStateException("Conversation not found: " + conversation.getId());
  }

  void flush() {
    paragraph.setText(ConversationJsonCodec.serialize(conversations));
  }
}
