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
import static org.mockito.Mockito.*;

import java.util.Set;
import org.apache.zeppelin.conf.ZeppelinConfiguration;
import org.apache.zeppelin.rest.AssistantMessageRestApi;
import org.apache.zeppelin.service.AuthenticationService;
import org.apache.zeppelin.service.ConfigurationService;
import org.apache.zeppelin.service.SimpleServiceCallback;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AssistantMessageRestApiTest {
  private NotebookAssistantService service;
  private AssistantMessageRestApi api;

  @BeforeEach
  void setUp() {
    var auth = mock(AuthenticationService.class);
    when(auth.getPrincipal()).thenReturn("user");
    when(auth.getAssociatedRoles()).thenReturn(Set.of());
    service = mock(NotebookAssistantService.class);
    api = new AssistantMessageRestApi(auth, service);
  }

  @Test
  void configurationResponsesExcludeKey() throws Exception {
    var actual = ZeppelinConfiguration.load();
    String key = ZeppelinConfiguration.ConfVars.ZEPPELIN_NOTEBOOK_ASSISTANT_OPENAI_API_KEY.getVarName();
    assertEquals("", ZeppelinConfiguration.ConfVars.ZEPPELIN_NOTEBOOK_ASSISTANT_OPENAI_API_KEY.getStringValue());
    actual.setProperty(key, "test-key");
    var configuration = new ConfigurationService(actual);
    assertFalse(configuration.getAllProperties(null, new SimpleServiceCallback<>()).containsKey(key));
    assertFalse(configuration.getPropertiesWithPrefix("zeppelin.notebook.assistant", null,
        new SimpleServiceCallback<>()).containsKey(key));
  }
}
