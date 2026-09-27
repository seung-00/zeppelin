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

import java.util.List;
import java.util.Map;
import java.util.Set;
import org.apache.zeppelin.conf.ZeppelinConfiguration;
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

class ToolExecutorTest {
  private Note note;
  private AuthorizationService authorization;
  private ToolExecutor executor;
  private final ServiceContext ctx = new ServiceContext(AuthenticationInfo.ANONYMOUS, Set.of("user"));

  @BeforeEach
  void setUp() throws Exception {
    note = new Note();
    note.setInterpreterFactory(mock(org.apache.zeppelin.interpreter.InterpreterFactory.class));
    Notebook notebook = mock(Notebook.class);
    when(notebook.processNote(anyString(), any())).thenAnswer(i ->
        ((NoteProcessor<?>) i.getArgument(1)).process(note));
    when(notebook.processNote(anyString(), anyBoolean(), any())).thenAnswer(i ->
        ((NoteProcessor<?>) i.getArgument(2)).process(note));
    authorization = mock(AuthorizationService.class);
    when(authorization.isReader(anyString(), anySet())).thenReturn(true);
    when(authorization.isWriter(anyString(), anySet())).thenReturn(true);
    NotebookService notebookService = new NotebookService(notebook, authorization,
        mock(ZeppelinConfiguration.class), null);
    executor = new ToolExecutor(List.of(new ListParagraphsTool(notebookService)));
  }

  @Test
  void specsExposeRegisteredTools() {
    List<ToolSpec> specs = executor.specs();
    assertEquals(1, specs.size());
    assertEquals("list_paragraphs", specs.get(0).name);
  }

  @Test
  void unknownToolReturnsError() {
    ToolResult result = executor.callTool("note", "unknown_tool", Map.of(), ctx);
    assertNotNull(result.error);
  }

  @Test
  void listParagraphsExcludesAssistantMarker() {
    Paragraph visible = note.addNewParagraph(AuthenticationInfo.ANONYMOUS);
    visible.setText("%md hello");
    Paragraph marker = note.addNewParagraph(AuthenticationInfo.ANONYMOUS);
    marker.setConfig(Map.of("notebookAssistant", true));

    ToolResult result = executor.callTool("note", "list_paragraphs", Map.of(), ctx);

    assertNull(result.error);
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> paragraphs = (List<Map<String, Object>>) result.value;
    assertEquals(1, paragraphs.size());
    assertEquals(visible.getId(), paragraphs.get(0).get("id"));
  }

  @Test
  void listParagraphsFailsWithoutReadPermission() {
    when(authorization.isReader(anyString(), anySet())).thenReturn(false);
    ToolResult result = executor.callTool("note", "list_paragraphs", Map.of(), ctx);
    assertNotNull(result.error);
  }
}
