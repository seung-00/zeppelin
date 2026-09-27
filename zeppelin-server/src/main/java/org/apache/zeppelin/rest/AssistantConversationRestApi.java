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

package org.apache.zeppelin.rest;

import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Response;

import java.io.IOException;
import java.time.Instant;
import java.util.Optional;

import org.apache.zeppelin.annotation.ZeppelinApi;
import org.apache.zeppelin.rest.message.CreateConversationRequest;
import org.apache.zeppelin.server.JsonResponse;
import org.apache.zeppelin.service.AuthenticationService;
import org.apache.zeppelin.service.assistant.NotebookAssistantService;

@Path("/notes/{noteId}/conversations")
@Produces("application/json")
@Singleton
public class AssistantConversationRestApi extends AbstractRestApi {

  private final NotebookAssistantService assistantService;

  @Inject
  public AssistantConversationRestApi(
      AuthenticationService authenticationService,
      NotebookAssistantService assistantService
  ) {
    super(authenticationService);
    this.assistantService = assistantService;
  }

  @GET
  @ZeppelinApi
  public Response list(@PathParam("noteId") String noteId) throws IOException {
    return new JsonResponse<>(
        Response.Status.OK,
        "",
        assistantService.listConversations(noteId, getServiceContext())
    ).build();
  }

  @GET
  @Path("/{conversationId}")
  @ZeppelinApi
  public Response get(
      @PathParam("noteId") String noteId,
      @PathParam("conversationId") String conversationId
  ) throws IOException {
    return new JsonResponse<>(Response.Status.OK, "",
        assistantService.getConversation(noteId, conversationId, getServiceContext())).build();
  }

  @POST
  @ZeppelinApi
  public Response create(
      @PathParam("noteId") String noteId,
      String body
  ) throws IOException {
    String title = Optional.ofNullable(GSON.fromJson(body, CreateConversationRequest.class))
        .map(CreateConversationRequest::getTitle)
        .orElseGet(() -> noteId + " " + Instant.now());
    var conversation = assistantService.createConversation(noteId, title, getServiceContext());
    return new JsonResponse<>(Response.Status.CREATED, "", conversation).build();
  }

  @DELETE
  @Path("/{conversationId}")
  @ZeppelinApi
  public Response delete(
      @PathParam("noteId") String noteId,
      @PathParam("conversationId") String conversationId
  ) throws IOException {
    assistantService.deleteConversation(noteId, conversationId, getServiceContext());
    return Response.noContent().build();
  }
}
