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
package org.apache.zeppelin.socket;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;

import io.micrometer.core.instrument.Metrics;
import io.micrometer.core.instrument.Tags;

import java.io.IOException;
import java.lang.reflect.Type;
import java.net.SocketTimeoutException;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;
import jakarta.inject.Inject;
import jakarta.inject.Provider;
import jakarta.websocket.CloseReason;
import jakarta.websocket.EndpointConfig;
import jakarta.websocket.OnClose;
import jakarta.websocket.OnError;
import jakarta.websocket.OnMessage;
import jakarta.websocket.OnOpen;
import jakarta.websocket.Session;
import jakarta.websocket.server.ServerEndpoint;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.exception.ExceptionUtils;
import org.apache.thrift.TException;
import org.apache.zeppelin.common.Message;
import org.apache.zeppelin.common.Message.OP;
import org.apache.zeppelin.conf.ZeppelinConfiguration;
import org.apache.zeppelin.display.AngularObject;
import org.apache.zeppelin.display.AngularObjectRegistry;
import org.apache.zeppelin.display.AngularObjectRegistryListener;
import org.apache.zeppelin.display.GUI;
import org.apache.zeppelin.display.Input;
import org.apache.zeppelin.helium.ApplicationEventListener;
import org.apache.zeppelin.helium.HeliumPackage;
import org.apache.zeppelin.interpreter.InterpreterGroup;
import org.apache.zeppelin.interpreter.InterpreterResult;
import org.apache.zeppelin.interpreter.InterpreterSetting;
import org.apache.zeppelin.interpreter.remote.RemoteAngularObjectRegistry;
import org.apache.zeppelin.interpreter.remote.RemoteInterpreterProcessListener;
import org.apache.zeppelin.interpreter.thrift.InterpreterCompletion;
import org.apache.zeppelin.interpreter.thrift.ParagraphInfo;
import org.apache.zeppelin.interpreter.thrift.ServiceException;
import org.apache.zeppelin.jupyter.JupyterUtil;
import org.apache.zeppelin.notebook.AuthorizationService;
import org.apache.zeppelin.notebook.Note;
import org.apache.zeppelin.notebook.NoteEventListener;
import org.apache.zeppelin.notebook.NoteInfo;
import org.apache.zeppelin.notebook.NoteParser;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.notebook.NotebookImportDeserializer;
import org.apache.zeppelin.notebook.Paragraph;
import org.apache.zeppelin.notebook.ParagraphJobListener;
import org.apache.zeppelin.notebook.repo.NotebookRepoWithVersionControl.Revision;
import org.apache.zeppelin.rest.exception.ForbiddenException;
import org.apache.zeppelin.scheduler.Job;
import org.apache.zeppelin.scheduler.Job.Status;
import org.apache.zeppelin.service.ConfigurationService;
import org.apache.zeppelin.service.JobManagerService;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.service.ServiceContext;
import org.apache.zeppelin.service.SimpleServiceCallback;
import org.apache.zeppelin.ticket.TicketContainer;
import org.apache.zeppelin.types.InterpreterSettingsList;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.apache.zeppelin.util.IdHashes;
import org.apache.zeppelin.utils.CorsUtils;
import org.apache.zeppelin.utils.ServerUtils;
import org.eclipse.jetty.util.annotation.ManagedAttribute;
import org.eclipse.jetty.util.annotation.ManagedObject;
import org.eclipse.jetty.util.annotation.ManagedOperation;
import org.glassfish.hk2.api.ServiceLocator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import static org.apache.zeppelin.common.Message.MSG_ID_NOT_DEFINED;
import static org.apache.zeppelin.conf.ZeppelinConfiguration.ConfVars.ZEPPELIN_ALLOWED_ORIGINS;

/**
 * Zeppelin websocket service. This class used setter injection because all servlet should have
 * no-parameter constructor
 */
@ManagedObject
@ServerEndpoint(value = "/ws")
public class NotebookServer implements AngularObjectRegistryListener,
    RemoteInterpreterProcessListener,
    ApplicationEventListener,
    ParagraphJobListener,
    NoteEventListener {

  /**
   * Job manager service type.
   */
  protected enum JobManagerServiceType {
    JOB_MANAGER_PAGE("JOB_MANAGER_PAGE");
    private final String serviceTypeKey;

    JobManagerServiceType(String serviceType) {
      this.serviceTypeKey = serviceType;
    }

    String getKey() {
      return this.serviceTypeKey;
    }
  }

  private static final Logger LOGGER = LoggerFactory.getLogger(NotebookServer.class);
  private static final Gson gson = new GsonBuilder()
      .setDateFormat("yyyy-MM-dd'T'HH:mm:ssZ")
      .registerTypeAdapter(Date.class, new NotebookImportDeserializer())
      .setPrettyPrinting()
      .registerTypeAdapterFactory(Input.TypeAdapterFactory).create();
  private static final AtomicReference<NotebookServer> self = new AtomicReference<>();

  private final ExecutorService executorService = Executors.newFixedThreadPool(10);

  // TODO(jl): This will be removed by handling session directly
  private final Map<String, NotebookSocket> sessionIdNotebookSocketMap = Metrics.gaugeMapSize("zeppelin_session_id_notebook_sockets", Tags.empty(), new ConcurrentHashMap<>());
  private ConnectionManager connectionManager;
  private ZeppelinConfiguration zConf;
  private Provider<Notebook> notebookProvider;
  private Provider<NoteParser> noteParser;
  private Provider<NotebookService> notebookServiceProvider;
  private AuthorizationService authorizationService;
  private Provider<ConfigurationService> configurationServiceProvider;
  private Provider<JobManagerService> jobManagerServiceProvider;

  public NotebookServer() {
    NotebookServer.self.set(this);
    LOGGER.info("NotebookServer instantiated: {}", this);
  }

  @Inject
  public void setZeppelinConfiguration(ZeppelinConfiguration zConf) {
    this.zConf = zConf;
  }

  @Inject
  public void setNoteParser(Provider<NoteParser> noteParser) {
    this.noteParser = noteParser;
    LOGGER.info("Injected NoteParser");
  }

  @Inject
  public void setServiceLocator(ServiceLocator serviceLocator) {
    LOGGER.info("Injected ServiceLocator: {}", serviceLocator);
  }

  // To avoid circular dependencies, it uses provider-injection
  @Inject
  public void setNotebook(Provider<Notebook> notebookProvider) {
    this.notebookProvider = notebookProvider;
    LOGGER.info("Injected NotebookProvider");
  }

  @Inject
  public void setNotebookService(
      Provider<NotebookService> notebookServiceProvider) {
    this.notebookServiceProvider = notebookServiceProvider;
    LOGGER.info("Injected NotebookServiceProvider");
  }

  @Inject
  public void setAuthorizationService(AuthorizationService authorizationService) {
    this.authorizationService = authorizationService;
    LOGGER.info("Injected NotebookAuthorizationService");
  }

  @Inject
  public void setConnectionManager(ConnectionManager connectionManager) {
    this.connectionManager = connectionManager;
  }

  public ConnectionManager getConnectionManager() {
    return this.connectionManager;
  }


  @Inject
  public void setConfigurationService(
      Provider<ConfigurationService> configurationServiceProvider) {
    this.configurationServiceProvider = configurationServiceProvider;
  }

  @Inject
  public void setJobManagerService(
      Provider<JobManagerService> jobManagerServiceProvider) {
    this.jobManagerServiceProvider = jobManagerServiceProvider;
  }

  public Notebook getNotebook() {
    return notebookProvider.get();
  }

  public NotebookService getNotebookService() {
    return notebookServiceProvider.get();
  }

  public ConfigurationService getConfigurationService() {
    return configurationServiceProvider.get();
  }

  public synchronized JobManagerService getJobManagerService() {
    return jobManagerServiceProvider.get();
  }

  public boolean checkOrigin(String origin) {
    try {
      return CorsUtils.isValidOrigin(origin, zConf);
    } catch (UnknownHostException | URISyntaxException e) {
      LOGGER.error(e.toString(), e);
    }
    return false;
  }

  @OnOpen
  public void onOpen(Session session, EndpointConfig endpointConfig) throws IOException {

    LOGGER.info("Open connection to {} with Session: {}, config: {}", ServerUtils.getRemoteAddress(session), session, endpointConfig.getUserProperties().keySet());

    Map<String, Object> headers = endpointConfig.getUserProperties();
    String origin = String.valueOf(headers.get(CorsUtils.HEADER_ORIGIN));
    if (checkOrigin(origin)) {
      NotebookSocket notebookSocket = sessionIdNotebookSocketMap
          .computeIfAbsent(session.getId(), unused -> new NotebookSocket(session, headers));
      onOpen(notebookSocket);
    } else {
      LOGGER.error("Websocket request is not allowed by {} settings. Origin: {}", ZEPPELIN_ALLOWED_ORIGINS,
          origin);
      session.close();
    }
  }

  public void onOpen(NotebookSocket conn) {
    connectionManager.addConnection(conn);
  }

  @OnMessage
  public void onMessage(Session session, String msg) {
    NotebookSocket conn = sessionIdNotebookSocketMap.get(session.getId());
    onMessage(conn, msg);
  }

  public void onMessage(NotebookSocket conn, String msg) {
    try {
      Message receivedMessage = deserializeMessage(msg);
      if (receivedMessage.op != OP.PING) {
        LOGGER.debug("RECEIVE: " + receivedMessage.op +
            ", RECEIVE PRINCIPAL: " + receivedMessage.principal +
            ", RECEIVE TICKET: " + receivedMessage.ticket +
            ", RECEIVE ROLES: " + receivedMessage.roles +
            ", RECEIVE DATA: " + receivedMessage.data);
      }
      if (LOGGER.isTraceEnabled()) {
        LOGGER.trace("RECEIVE MSG = " + receivedMessage);
      }

      TicketContainer.Entry ticketEntry = TicketContainer.instance.getTicketEntry(receivedMessage.principal);
      if (ticketEntry == null || StringUtils.isEmpty(ticketEntry.getTicket())) {
        LOGGER.debug("{} message: invalid ticket {}", receivedMessage.op, receivedMessage.ticket);
        return;
      } else if (!ticketEntry.getTicket().equals(receivedMessage.ticket)) {
        /* not to pollute logs, log instead of exception */
        LOGGER.debug("{} message: invalid ticket {} != {}", receivedMessage.op, receivedMessage.ticket,
            ticketEntry.getTicket());
        if (!receivedMessage.op.equals(OP.PING)) {
          conn.send(serializeMessage(new Message(OP.SESSION_LOGOUT).put("info",
              "Your ticket is invalid possibly due to server restart. Please login again.")));
        }

        return;
      }

      boolean allowAnonymous = zConf.isAnonymousAllowed();
      if (!allowAnonymous && receivedMessage.principal.equals("anonymous")) {
        LOGGER.warn("Anonymous access not allowed.");
        return;
      }

      if (Message.isDisabledForRunningNotes(receivedMessage.op)) {
        boolean noteRunning = getNotebook().processNote((String) receivedMessage.get("noteId"),
          note -> note != null && note.isRunning());
        if (noteRunning) {
          throw new Exception("Note is now running sequentially. Can not be performed: " + receivedMessage.op);
        }
      }

      if (StringUtils.isEmpty(conn.getUser())) {
        connectionManager.addUserConnection(receivedMessage.principal, conn);
      }
      ServiceContext context = getServiceContext(ticketEntry);
      // Lets be elegant here
      switch (receivedMessage.op) {
        case LIST_NOTES:
          listNotesInfo(conn, context);
          break;
        case RELOAD_NOTES_FROM_REPO:
          broadcastReloadedNoteList(context);
          break;
        case GET_HOME_NOTE:
          getHomeNote(conn, context);
          break;
        case GET_NOTE:
          getNote(conn, context, receivedMessage);
          break;
        case RELOAD_NOTE:
          reloadNote(conn, context, receivedMessage);
          break;
        case NEW_NOTE:
          createNote(conn, context, receivedMessage);
          break;
        case DEL_NOTE:
          deleteNote(conn, context, receivedMessage);
          break;
        case REMOVE_FOLDER:
          removeFolder(conn, context, receivedMessage);
          break;
        case MOVE_NOTE_TO_TRASH:
          moveNoteToTrash(conn, context, receivedMessage);
          break;
        case MOVE_FOLDER_TO_TRASH:
          moveFolderToTrash(conn, context, receivedMessage);
          break;
        case EMPTY_TRASH:
          emptyTrash(conn, context);
          break;
        case RESTORE_FOLDER:
          restoreFolder(conn, context, receivedMessage);
          break;
        case RESTORE_NOTE:
          restoreNote(conn, context, receivedMessage);
          break;
        case RESTORE_ALL:
          restoreAll(conn, context, receivedMessage);
          break;
        case CLONE_NOTE:
          cloneNote(conn, context, receivedMessage);
          break;
        case IMPORT_NOTE:
          importNote(conn, context, receivedMessage);
          break;
        case CONVERT_NOTE_NBFORMAT:
          convertNote(conn, receivedMessage);
          break;
        case COMMIT_PARAGRAPH:
          updateParagraph(conn, context, receivedMessage);
          break;
        case RUN_PARAGRAPH:
          runParagraph(conn, context, receivedMessage);
          break;
        case PARAGRAPH_EXECUTED_BY_SPELL:
          broadcastSpellExecution(conn, context, receivedMessage);
          break;
        case RUN_ALL_PARAGRAPHS:
          runAllParagraphs(conn, context, receivedMessage);
          break;
        case CANCEL_PARAGRAPH:
          cancelParagraph(conn, context, receivedMessage);
          break;
        case MOVE_PARAGRAPH:
          moveParagraph(conn, context, receivedMessage);
          break;
        case INSERT_PARAGRAPH:
          insertParagraph(conn, context, receivedMessage);
          break;
        case COPY_PARAGRAPH:
          copyParagraph(conn, context, receivedMessage);
          break;
        case PARAGRAPH_REMOVE:
          removeParagraph(conn, context, receivedMessage);
          break;
        case PARAGRAPH_CLEAR_OUTPUT:
          clearParagraphOutput(conn, context, receivedMessage);
          break;
        case PARAGRAPH_CLEAR_ALL_OUTPUT:
          clearAllParagraphOutput(conn, context, receivedMessage);
          break;
        case NOTE_UPDATE:
          updateNote(conn, context, receivedMessage);
          break;
        case NOTE_RENAME:
          renameNote(conn, context, receivedMessage);
          break;
        case FOLDER_RENAME:
          renameFolder(conn, context, receivedMessage);
          break;
        case UPDATE_PERSONALIZED_MODE:
          updatePersonalizedMode(conn, context, receivedMessage);
          break;
        case COMPLETION:
          completion(conn, context, receivedMessage);
          break;
        case PING:
          break; //do nothing
        case ANGULAR_OBJECT_UPDATED:
          angularObjectUpdated(conn, context, receivedMessage);
          break;
        case ANGULAR_OBJECT_CLIENT_BIND:
          angularObjectClientBind(conn, receivedMessage);
          break;
        case ANGULAR_OBJECT_CLIENT_UNBIND:
          angularObjectClientUnbind(conn, receivedMessage);
          break;
        case LIST_CONFIGURATIONS:
          sendAllConfigurations(conn, context, receivedMessage);
          break;
        case CHECKPOINT_NOTE:
          checkpointNote(conn, context, receivedMessage);
          break;
        case LIST_REVISION_HISTORY:
          listRevisionHistory(conn, context, receivedMessage);
          break;
        case SET_NOTE_REVISION:
          setNoteRevision(conn, context, receivedMessage);
          break;
        case NOTE_REVISION:
          getNoteByRevision(conn, context, receivedMessage);
          break;
        case NOTE_REVISION_FOR_COMPARE:
          getNoteByRevisionForCompare(conn, context, receivedMessage);
          break;
        case LIST_NOTE_JOBS:
          unicastNoteJobInfo(conn, context, receivedMessage);
          break;
        case UNSUBSCRIBE_UPDATE_NOTE_JOBS:
          unsubscribeNoteJobInfo(conn);
          break;
        case GET_INTERPRETER_BINDINGS:
          getInterpreterBindings(conn, context, receivedMessage);
          break;
        case SAVE_INTERPRETER_BINDINGS:
          saveInterpreterBindings(conn, context, receivedMessage);
          break;
        case EDITOR_SETTING:
          getEditorSetting(conn, context, receivedMessage);
          break;
        case GET_INTERPRETER_SETTINGS:
          getInterpreterSettings(conn, context, receivedMessage);
          break;
        case WATCHER:
          connectionManager.switchConnectionToWatcher(conn);
          break;
        case SAVE_NOTE_FORMS:
          saveNoteForms(conn, context, receivedMessage);
          break;
        case REMOVE_NOTE_FORMS:
          removeNoteForms(conn, context, receivedMessage);
          break;
        case PATCH_PARAGRAPH:
          patchParagraph(conn, context, receivedMessage);
          break;
        default:
          break;
      }
    } catch (Exception e) {
      LOGGER.error("Can't handle message: {}", msg, e);
      try {
        conn.send(serializeMessage(new Message(OP.ERROR_INFO).put("info", e.getMessage())));
      } catch (IOException iox) {
        LOGGER.error("Fail to send error info", iox);
      }
    }
  }

  @OnClose
  public void onClose(Session session, CloseReason closeReason) {
    NotebookSocket notebookSocket = sessionIdNotebookSocketMap.remove(session.getId());
    if (notebookSocket != null) {
      LOGGER.info("Closed connection to {} ({}) {}", ServerUtils.getRemoteAddress(session), closeReason.getCloseCode().getCode(), closeReason.getReasonPhrase());
      removeConnection(notebookSocket);
    }
  }

  private void removeConnection(NotebookSocket notebookSocket) {
    connectionManager.removeConnection(notebookSocket);
    connectionManager.removeWatcherConnection(notebookSocket);
    connectionManager.removeConnectionFromAllNote(notebookSocket);
    connectionManager.removeUserConnection(notebookSocket.getUser(), notebookSocket);
  }

  private boolean sendParagraphStatusToFrontend() {
    return zConf.getBoolean(ZeppelinConfiguration.ConfVars.ZEPPELIN_WEBSOCKET_PARAGRAPH_STATUS_PROGRESS);
  }

  @OnError
  public void onError(Session session, Throwable error) {
    if (session != null) {
      NotebookSocket notebookSocket = sessionIdNotebookSocketMap.remove(session.getId());
      if (notebookSocket != null) {
        removeConnection(notebookSocket);
      }
    }
    if (error instanceof SocketTimeoutException) {
      LOGGER.warn("Socket Session to {} timed out", ServerUtils.getRemoteAddress(session));
      LOGGER.debug("SocketTimeoutException", error);
    } else if (error instanceof IOException) {
      LOGGER.warn("Client {} is gone", ServerUtils.getRemoteAddress(session));
      LOGGER.debug("IOException", error);
    } else {
      LOGGER.error("Error in WebSocket Session to {}", ServerUtils.getRemoteAddress(session), error);
    }
  }

  protected Message deserializeMessage(String msg) {
    return gson.fromJson(msg, Message.class);
  }

  protected String serializeMessage(Message m) {
    return gson.toJson(m);
  }

  public void broadcast(Message m) {
    connectionManager.broadcast(m);
  }

  public void unicastNoteJobInfo(NotebookSocket conn,
                                 ServiceContext context,
                                 Message fromMessage) throws IOException {

    connectionManager.addNoteConnection(JobManagerServiceType.JOB_MANAGER_PAGE.getKey(), conn);
    getJobManagerService().getNoteJobInfoByUnixTime(0, context,
        new WebSocketServiceCallback<List<JobManagerService.NoteJobInfo>>(conn) {
          @Override
          public void onSuccess(List<JobManagerService.NoteJobInfo> notesJobInfo,
                                ServiceContext context) throws IOException {
            super.onSuccess(notesJobInfo, context);
            Map<String, Object> response = new HashMap<>();
            response.put("lastResponseUnixTime", System.currentTimeMillis());
            response.put("jobs", notesJobInfo);
            conn.send(serializeMessage(new Message(OP.LIST_NOTE_JOBS).put("noteJobs", response)));
          }

          @Override
          public void onFailure(Exception ex, ServiceContext context) throws IOException {
            LOGGER.warn(ex.getMessage());
          }
        });
  }

  public void broadcastUpdateNoteJobInfo(Note note, long lastUpdateUnixTime) throws IOException {
    ServiceContext context = new ServiceContext(new AuthenticationInfo(), authorizationService.getOwners(note.getId()));
    getJobManagerService().getNoteJobInfoByUnixTime(lastUpdateUnixTime, context,
        new WebSocketServiceCallback<List<JobManagerService.NoteJobInfo>>(null) {
          @Override
          public void onSuccess(List<JobManagerService.NoteJobInfo> notesJobInfo,
                                ServiceContext context) throws IOException {
            super.onSuccess(notesJobInfo, context);
            Map<String, Object> response = new HashMap<>();
            response.put("lastResponseUnixTime", System.currentTimeMillis());
            response.put("jobs", notesJobInfo);
            connectionManager.broadcast(JobManagerServiceType.JOB_MANAGER_PAGE.getKey(),
                new Message(OP.LIST_UPDATE_NOTE_JOBS).put("noteRunningJobs", response));
          }

          @Override
          public void onFailure(Exception ex, ServiceContext context) throws IOException {
            LOGGER.warn(ex.getMessage());
          }
        });
  }

  public void unsubscribeNoteJobInfo(NotebookSocket conn) {
    connectionManager.removeNoteConnection(JobManagerServiceType.JOB_MANAGER_PAGE.getKey(), conn);
  }

  public void getInterpreterBindings(NotebookSocket conn,
                                     ServiceContext context,
                                     Message fromMessage) throws IOException {
    List<InterpreterSettingsList> settingList = new ArrayList<>();
    String noteId = (String) fromMessage.data.get("noteId");

    getNotebook().processNote(noteId,
      note -> {
        if (note != null) {
          List<InterpreterSetting> bindedSettings =
              note.getBindedInterpreterSettings(new ArrayList<>(context.getUserAndRoles()));
          for (InterpreterSetting setting : bindedSettings) {
            settingList.add(new InterpreterSettingsList(setting.getId(), setting.getName(),
                setting.getInterpreterInfos(), true));
          }
        }
        conn.send(serializeMessage(new Message(OP.INTERPRETER_BINDINGS).put("interpreterBindings", settingList)));
        return null;
      });
  }

  public void saveInterpreterBindings(NotebookSocket conn, ServiceContext context, Message fromMessage)
      throws IOException {
    List<InterpreterSettingsList> settingList = new ArrayList<>();
    String noteId = (String) fromMessage.data.get("noteId");
    // use write lock, because defaultInterpreterGroup is overwritten
    getNotebook().processNote(noteId,
      note -> {
        if (note != null) {
          List<String> settingIdList =
              gson.fromJson(String.valueOf(fromMessage.data.get("selectedSettingIds")),
                  new TypeToken<ArrayList<String>>() {
                  }.getType());
          if (!settingIdList.isEmpty()) {
            note.setDefaultInterpreterGroup(settingIdList.get(0));
            getNotebook().saveNote(note, context.getAutheInfo());
          }
          List<InterpreterSetting> bindedSettings =
            note.getBindedInterpreterSettings(new ArrayList<>(context.getUserAndRoles()));
          for (InterpreterSetting setting : bindedSettings) {
            settingList.add(new InterpreterSettingsList(setting.getId(), setting.getName(),
              setting.getInterpreterInfos(), true));
          }
        }
        return null;
      });
    conn.send(serializeMessage(
        new Message(OP.INTERPRETER_BINDINGS).put("interpreterBindings", settingList)));
  }

  public void broadcastNote(Note note) {
    inlineBroadcastNote(note);
  }

  private void inlineBroadcastNote(Note note) {
    Message message = new Message(OP.NOTE).put("note", note);
    connectionManager.broadcast(note.getId(), message);
  }

  private void inlineBroadcastParagraph(Note note, Paragraph p, String msgId) {
    broadcastNoteForms(note);

    if (note.isPersonalizedMode()) {
      broadcastParagraphs(p.getUserParagraphMap(), p, msgId);
    } else {
      Message message = new Message(OP.PARAGRAPH).withMsgId(msgId).put("paragraph", p);
      connectionManager.broadcast(note.getId(), message);
    }
  }

  public void broadcastParagraph(Note note, Paragraph p, String msgId) {
    inlineBroadcastParagraph(note, p, msgId);
  }

  private void inlineBroadcastParagraphs(Map<String, Paragraph> userParagraphMap, String msgId) {
    if (null != userParagraphMap) {
      for (String user : userParagraphMap.keySet()) {
        Message message = new Message(OP.PARAGRAPH).withMsgId(msgId).put("paragraph", userParagraphMap.get(user));
        connectionManager.multicastToUser(user, message);
      }
    }
  }

  private void broadcastParagraphs(Map<String, Paragraph> userParagraphMap, Paragraph defaultParagraph, String msgId) {
    inlineBroadcastParagraphs(userParagraphMap, msgId);
  }

  private void inlineBroadcastNewParagraph(Note note, Paragraph para) {
    LOGGER.info("Broadcasting paragraph on run call instead of note.");
    int paraIndex = note.getParagraphs().indexOf(para);

    Message message = new Message(OP.PARAGRAPH_ADDED).put("paragraph", para).put("index", paraIndex);
    connectionManager.broadcast(note.getId(), message);
  }

  private void broadcastNewParagraph(Note note, Paragraph para) {
    inlineBroadcastNewParagraph(note, para);
  }

  private void inlineBroadcastNoteList() {
    broadcastNoteListUpdate();
  }

  public void broadcastNoteListUpdate() {
    connectionManager.forAllUsers((user, userAndRoles) -> {
      List<NoteInfo> notesInfo = getNotebook().getNotesInfo(
          noteId -> authorizationService.isReader(noteId, userAndRoles));

      connectionManager.multicastToUser(user,
          new Message(OP.NOTES_INFO).put("notes", notesInfo));
    });
  }

  public void broadcastNoteList(AuthenticationInfo subject, Set<String> userAndRoles) {
    inlineBroadcastNoteList();
  }

  public void listNotesInfo(NotebookSocket conn, ServiceContext context) throws IOException {
    getNotebookService().listNotesInfo(false, context,
        new WebSocketServiceCallback<List<NoteInfo>>(conn) {
          @Override
          public void onSuccess(List<NoteInfo> notesInfo, ServiceContext context) throws IOException {
            super.onSuccess(notesInfo, context);
            connectionManager.unicast(new Message(OP.NOTES_INFO).put("notes", notesInfo), conn);
          }
        });
  }

  public void broadcastReloadedNoteList(ServiceContext context)
      throws IOException {
    getNotebook().reloadAllNotes(context.getAutheInfo());
    broadcastNoteListUpdate();
  }

  void permissionError(NotebookSocket conn, String op, String userName, Set<String> userAndRoles,
                       Set<String> allowed) throws IOException {
    LOGGER.info("Cannot {}. Connection readers {}. Allowed readers {}", op, userAndRoles, allowed);

    conn.send(serializeMessage(new Message(OP.AUTH_INFO).put("info",
        "Insufficient privileges to " + op
            + " note.\n\n" + "Allowed users or roles: "
            + allowed
            .toString() + "\n\n" + "But the user "
            + userName + " belongs to: " + userAndRoles
            .toString())));
  }

  /**
   * @return false if user doesn't have writer permission for this paragraph
   */
  private boolean hasParagraphWriterPermission(NotebookSocket conn, Notebook notebook,
                                               String noteId, Set<String> userAndRoles,
                                               String principal, String op)
      throws IOException {
    if (!authorizationService.isWriter(noteId, userAndRoles)) {
      permissionError(conn, op, principal, userAndRoles, authorizationService.getOwners(noteId));
      return false;
    }

    return true;
  }

  private void getNote(NotebookSocket conn, ServiceContext context, Message fromMessage) throws IOException {
    String noteId = (String) fromMessage.get("id");
    if (noteId == null) {
      return;
    }
    getNotebookService().getNote(noteId, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context)
              throws IOException {
            connectionManager.addNoteConnection(note.getId(), conn);
            conn.send(
                serializeMessage(new Message(OP.NOTE).put("note", note)));
            updateAngularObjectRegistry(conn, note);
            sendAllAngularObjects(note, context.getAutheInfo().getUser(),
                conn);
          }
        }, null);
  }

  private void reloadNote(NotebookSocket conn, ServiceContext context, Message fromMessage)
      throws IOException {
    String noteId = (String) fromMessage.get("id");
    if (noteId == null) {
      return;
    }
    getNotebookService().getNote(noteId, true, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context) throws IOException {
            connectionManager.addNoteConnection(note.getId(), conn);
            conn.send(serializeMessage(new Message(OP.NOTE).put("note", note)));
            updateAngularObjectRegistry(conn, note);
            sendAllAngularObjects(note, context.getAutheInfo().getUser(), conn);
          }
        }, null);
  }

  /**
   * Update the AngularObject object in the note to InterpreterGroup and AngularObjectRegistry.
   */
  private void updateAngularObjectRegistry(NotebookSocket conn, Note note) {
    for (Paragraph paragraph : note.getParagraphs()) {
      InterpreterGroup interpreterGroup = null;
      try {
        interpreterGroup = findInterpreterGroupForParagraph(note, paragraph.getId());
      } catch (Exception e) {
        LOGGER.warn(e.getMessage(), e);
      }
      if (null == interpreterGroup) {
        return;
      }
      RemoteAngularObjectRegistry registry = (RemoteAngularObjectRegistry)
          interpreterGroup.getAngularObjectRegistry();

      List<AngularObject> angularObjects = note.getAngularObjects(interpreterGroup.getId());
      for (AngularObject ao : angularObjects) {
        if (StringUtils.equals(ao.getNoteId(), note.getId())
            && StringUtils.equals(ao.getParagraphId(), paragraph.getId())) {
          pushAngularObjectToRemoteRegistry(ao.getNoteId(), ao.getParagraphId(),
              ao.getName(), ao.get(), registry, interpreterGroup.getId(), conn);
        }
      }
    }
  }

  private void getHomeNote(NotebookSocket conn, ServiceContext context) throws IOException {

    getNotebookService().getHomeNote(context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context) throws IOException {
            super.onSuccess(note, context);
            if (note != null) {
              connectionManager.addNoteConnection(note.getId(), conn);
              conn.send(serializeMessage(new Message(OP.NOTE).put("note", note)));
              sendAllAngularObjects(note, context.getAutheInfo().getUser(), conn);
            } else {
              connectionManager.removeConnectionFromAllNote(conn);
              conn.send(serializeMessage(new Message(OP.NOTE).put("note", null)));
            }
          }
        });
  }

  private void updateNote(NotebookSocket conn, ServiceContext context, Message fromMessage) throws IOException {
    String noteId = (String) fromMessage.get("id");
    String name = (String) fromMessage.get("name");
    Map<String, Object> config = (Map<String, Object>) fromMessage.get("config");
    if (noteId == null) {
      return;
    }
    if (config == null) {
      return;
    }

    getNotebookService().updateNote(noteId, name, config, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context) throws IOException {
            connectionManager.broadcast(note.getId(), new Message(OP.NOTE_UPDATED).put("name", name)
                .put("config", config)
                .put("info", note.getInfo()));
            broadcastNoteList(context.getAutheInfo(), context.getUserAndRoles());
          }
        });
  }

  private void updatePersonalizedMode(NotebookSocket conn, ServiceContext context, Message fromMessage)
      throws IOException {
    String noteId = (String) fromMessage.get("id");
    String personalized = (String) fromMessage.get("personalized");
    boolean isPersonalized = personalized.equals("true");

    getNotebookService().updatePersonalizedMode(noteId, isPersonalized, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context)
              throws IOException {
            super.onSuccess(note, context);
            connectionManager.broadcastNote(note);
          }
        });
  }

  private void renameNote(NotebookSocket conn, ServiceContext context, Message fromMessage) throws IOException {
    String noteId = (String) fromMessage.get("id");
    String name = (String) fromMessage.get("name");
    boolean isRelativePath = false;
    if (fromMessage.get("relative") != null) {
      isRelativePath = (boolean) fromMessage.get("relative");
    }
    if (noteId == null) {
      return;
    }
    getNotebookService().renameNote(noteId, name, isRelativePath, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context) throws IOException {
            super.onSuccess(note, context);
            broadcastNote(note);
            broadcastNoteList(context.getAutheInfo(), context.getUserAndRoles());
          }

          @Override
          public void onFailure(Exception ex, ServiceContext context) throws IOException {
            super.onFailure(ex, context);
         // If there was a failure, then resend the latest notebook information to update stale UI
            getNotebook().processNote(noteId,
              note -> {
                broadcastNote(note);
                return null;
              });
          }
        });
  }

  private void renameFolder(NotebookSocket conn, ServiceContext context, Message fromMessage) throws IOException {
    String oldFolderId = (String) fromMessage.get("id");
    String newFolderId = (String) fromMessage.get("name");
    getNotebookService().renameFolder(oldFolderId, newFolderId, context,
        new WebSocketServiceCallback<List<NoteInfo>>(conn) {
          @Override
          public void onSuccess(List<NoteInfo> result, ServiceContext context) throws IOException {
            super.onSuccess(result, context);
            broadcastNoteList(context.getAutheInfo(), context.getUserAndRoles());
          }
        });
  }

  private void createNote(NotebookSocket conn, ServiceContext context, Message message) throws IOException {

    String noteName = (String) message.get("name");
    String defaultInterpreterGroup = (String) message.get("defaultInterpreterGroup");

    getNotebookService().createNote(noteName, defaultInterpreterGroup, true, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context) throws IOException {
            super.onSuccess(note, context);
            connectionManager.addNoteConnection(note.getId(), conn);
            conn.send(serializeMessage(new Message(OP.NEW_NOTE).put("note", note)));
            broadcastNoteList(context.getAutheInfo(), context.getUserAndRoles());
          }

          @Override
          public void onFailure(Exception ex, ServiceContext context) throws IOException {
            super.onFailure(ex, context);
            conn.send(serializeMessage(new Message(OP.ERROR_INFO)
                .put("info", "Failed to create note.\n" + ExceptionUtils.getMessage(ex))));
          }
        });
  }

  private void deleteNote(NotebookSocket conn, ServiceContext context, Message fromMessage) throws IOException {
    String noteId = (String) fromMessage.get("id");
    getNotebookService().removeNote(noteId, context,
        new WebSocketServiceCallback<String>(conn) {
          @Override
          public void onSuccess(String message, ServiceContext context) throws IOException {
            super.onSuccess(message, context);
            connectionManager.removeNoteConnection(noteId);
            broadcastNoteList(context.getAutheInfo(), context.getUserAndRoles());
          }
        });
  }

  private void removeFolder(NotebookSocket conn, ServiceContext context, Message fromMessage) throws IOException {

    String folderPath = (String) fromMessage.get("id");
    folderPath = "/" + folderPath;
    getNotebookService().removeFolder(folderPath, context,
        new WebSocketServiceCallback<List<NoteInfo>>(conn) {
          @Override
          public void onSuccess(List<NoteInfo> notesInfo, ServiceContext context) throws IOException {
            super.onSuccess(notesInfo, context);
            for (NoteInfo noteInfo : notesInfo) {
              connectionManager.removeNoteConnection(noteInfo.getId());
            }
            broadcastNoteList(context.getAutheInfo(), context.getUserAndRoles());
          }
        });
  }

  private void moveNoteToTrash(NotebookSocket conn, ServiceContext context, Message fromMessage) throws IOException {
    String noteId = (String) fromMessage.get("id");
    getNotebookService().moveNoteToTrash(noteId, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context) throws IOException {
            super.onSuccess(note, context);
            broadcastNote(note);
            broadcastNoteList(context.getAutheInfo(), context.getUserAndRoles());
          }
        });
  }

  private void moveFolderToTrash(NotebookSocket conn, ServiceContext context, Message fromMessage)
      throws IOException {

    String folderPath = (String) fromMessage.get("id");
    getNotebookService().moveFolderToTrash(folderPath, context,
        new WebSocketServiceCallback<Void>(conn) {
          @Override
          public void onSuccess(Void result, ServiceContext context) throws IOException {
            super.onSuccess(result, context);
            broadcastNoteList(context.getAutheInfo(), context.getUserAndRoles());
          }
        });

  }

  private void restoreNote(NotebookSocket conn, ServiceContext context, Message fromMessage) throws IOException {
    String noteId = (String) fromMessage.get("id");
    getNotebookService().restoreNote(noteId, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context) throws IOException {
            super.onSuccess(note, context);
            broadcastNote(note);
            broadcastNoteList(context.getAutheInfo(), context.getUserAndRoles());
          }
        });

  }

  private void restoreFolder(NotebookSocket conn,
                             ServiceContext context,
                             Message fromMessage) throws IOException {
    String folderPath = (String) fromMessage.get("id");
    folderPath = "/" + folderPath;
    getNotebookService().restoreFolder(folderPath, context,
        new WebSocketServiceCallback<Void>(conn) {
          @Override
          public void onSuccess(Void result, ServiceContext context) throws IOException {
            super.onSuccess(result, context);
            broadcastNoteList(context.getAutheInfo(), context.getUserAndRoles());
          }
        });
  }

  private void restoreAll(NotebookSocket conn,
                          ServiceContext context,
                          Message fromMessage) throws IOException {
    getNotebookService().restoreAll(context,
        new WebSocketServiceCallback<Void>(conn) {
          @Override
          public void onSuccess(Void result, ServiceContext context) throws IOException {
            super.onSuccess(result, context);
            broadcastNoteList(context.getAutheInfo(), context.getUserAndRoles());
          }
        });
  }

  private void emptyTrash(NotebookSocket conn, ServiceContext context) throws IOException {
    getNotebookService().emptyTrash(context,
        new WebSocketServiceCallback<Void>(conn) {
          @Override
          public void onSuccess(Void result, ServiceContext context) throws IOException {
            super.onSuccess(result, context);
            broadcastNoteList(context.getAutheInfo(), context.getUserAndRoles());
          }
        });
  }

  private void updateParagraph(NotebookSocket conn, ServiceContext context, Message fromMessage) throws IOException {
    String paragraphId = (String) fromMessage.get("id");
    String noteId = connectionManager.getAssociatedNoteId(conn);
    if (noteId == null) {
      noteId = (String) fromMessage.get("noteId");
    }
    String title = (String) fromMessage.get("title");
    String text = (String) fromMessage.get("paragraph");
    Map<String, Object> params = (Map<String, Object>) fromMessage.get("params");
    Map<String, Object> config = (Map<String, Object>) fromMessage.get("config");

    getNotebookService().updateParagraph(noteId, paragraphId, title, text, params, config, context,
        new WebSocketServiceCallback<Paragraph>(conn) {
          @Override
          public void onSuccess(Paragraph p, ServiceContext context) throws IOException {
            super.onSuccess(p, context);
            if (p.getNote().isPersonalizedMode()) {
              Map<String, Paragraph> userParagraphMap = p.getNote().getParagraph(paragraphId).getUserParagraphMap();
              broadcastParagraphs(userParagraphMap, p, fromMessage.msgId);
            } else {
              broadcastParagraph(p.getNote(), p, fromMessage.msgId);
            }
          }
        });
  }

  private void patchParagraph(NotebookSocket conn,
                              ServiceContext context,
                              Message fromMessage) throws IOException {
    if (!zConf.isZeppelinNotebookCollaborativeModeEnable()) {
      return;
    }
    String paragraphId = fromMessage.getType("id", LOGGER);
    if (paragraphId == null) {
      return;
    }

    String noteId = connectionManager.getAssociatedNoteId(conn);
    if (noteId == null) {
      noteId = fromMessage.getType("noteId", LOGGER);
      if (noteId == null) {
        return;
      }
    }
    final String noteId2 = noteId;
    String patchText = fromMessage.getType("patch", LOGGER);
    if (patchText == null) {
      return;
    }

    getNotebookService().patchParagraph(noteId, paragraphId, patchText, context,
        new WebSocketServiceCallback<String>(conn) {
          @Override
          public void onSuccess(String result, ServiceContext context) throws IOException {
            super.onSuccess(result, context);
            Message message = new Message(OP.PATCH_PARAGRAPH)
                .put("patch", result)
                .put("paragraphId", paragraphId);
            connectionManager.broadcastExcept(noteId2, message, conn);
          }
        });
  }

  private void cloneNote(NotebookSocket conn,
                         ServiceContext context,
                         Message fromMessage) throws IOException {
    String noteId = connectionManager.getAssociatedNoteId(conn);
    String name = (String) fromMessage.get("name");
    getNotebookService().cloneNote(noteId, name, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note newNote, ServiceContext context) throws IOException {
            super.onSuccess(newNote, context);
            connectionManager.addNoteConnection(newNote.getId(), conn);
            conn.send(serializeMessage(
                new Message(OP.NEW_NOTE).put("note", newNote)));
            broadcastNoteList(context.getAutheInfo(), context.getUserAndRoles());
          }
        });
  }

  private void clearAllParagraphOutput(NotebookSocket conn,
                                       ServiceContext context,
                                       Message fromMessage) throws IOException {
    final String noteId = (String) fromMessage.get("id");
    getNotebookService().clearAllParagraphOutput(noteId, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context) throws IOException {
            super.onSuccess(note, context);
            broadcastNote(note);
          }
        });
  }

  protected void convertNote(NotebookSocket conn, Message fromMessage) throws IOException {
    String noteId = fromMessage.get("noteId").toString();
    getNotebook().processNote(noteId,
      note -> {
        if (note == null) {
          throw new IOException("No such note: " + noteId);
        } else {
          Message resp = new Message(OP.CONVERTED_NOTE_NBFORMAT)
              .put("nbformat", new JupyterUtil().getNbformat(note.toJson()))
              .put("noteName", fromMessage.get("noteName"));
          conn.send(serializeMessage(resp));
          return null;
        }
      });
  }

  protected String importNote(NotebookSocket conn, ServiceContext context, Message fromMessage) throws IOException {
    String noteJson = null;
    String noteName = (String) ((Map) fromMessage.get("note")).get("name");
    // Checking whether the notebook data is from a Jupyter or a Zeppelin Notebook.
    // Jupyter notebooks have paragraphs under the "cells" label.
    if (((Map) fromMessage.get("note")).get("cells") == null) {
      noteJson = gson.toJson(fromMessage.get("note"));
    } else {
      noteJson = new JupyterUtil().getJson(
          gson.toJson(fromMessage.get("note")), IdHashes.generateId(), "%python", "%md");
    }
    return getNotebookService().importNote(noteName, noteJson, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context) throws IOException {
            super.onSuccess(note, context);
            try {
              broadcastNote(note);
              broadcastNoteList(context.getAutheInfo(), context.getUserAndRoles());
            } catch (NullPointerException e) {
              // TODO(zjffdu) remove this try catch. This is only for test of
              // NotebookServerTest#testImportNotebook
            }
          }
        });
  }

  private void removeParagraph(NotebookSocket conn,
                               ServiceContext context,
                               Message fromMessage) throws IOException {
    final String paragraphId = (String) fromMessage.get("id");
    String noteId = connectionManager.getAssociatedNoteId(conn);
    getNotebookService().removeParagraph(noteId, paragraphId,
        context, new WebSocketServiceCallback<Paragraph>(conn) {
          @Override
          public void onSuccess(Paragraph p, ServiceContext context) throws IOException {
            super.onSuccess(p, context);
            connectionManager.broadcast(p.getNote().getId(), new Message(OP.PARAGRAPH_REMOVED).put("id", p.getId()));
          }
        });
  }

  private void clearParagraphOutput(NotebookSocket conn,
                                    ServiceContext context,
                                    Message fromMessage) throws IOException {
    final String paragraphId = (String) fromMessage.get("id");
    String noteId = connectionManager.getAssociatedNoteId(conn);
    getNotebookService().clearParagraphOutput(noteId, paragraphId, context,
        new WebSocketServiceCallback<Paragraph>(conn) {
          @Override
          public void onSuccess(Paragraph p, ServiceContext context) throws IOException {
            super.onSuccess(p, context);
            if (p.getNote().isPersonalizedMode()) {
              connectionManager.unicastParagraph(p.getNote(), p, context.getAutheInfo().getUser(), fromMessage.msgId);
            } else {
              broadcastParagraph(p.getNote(), p, fromMessage.msgId);
            }
          }
        });
  }

  private void completion(NotebookSocket conn,
                          ServiceContext context,
                          Message fromMessage) throws IOException {
    String noteId = connectionManager.getAssociatedNoteId(conn);
    String paragraphId = (String) fromMessage.get("id");
    String buffer = (String) fromMessage.get("buf");
    int cursor = (int) Double.parseDouble(fromMessage.get("cursor").toString());
    getNotebookService().completion(noteId, paragraphId, buffer, cursor, context,
        new WebSocketServiceCallback<List<InterpreterCompletion>>(conn) {
          @Override
          public void onSuccess(List<InterpreterCompletion> completions, ServiceContext context) throws IOException {
            super.onSuccess(completions, context);
            Message resp = new Message(OP.COMPLETION_LIST).put("id", paragraphId);
            resp.put("completions", completions);
            conn.send(serializeMessage(resp));
          }

          @Override
          public void onFailure(Exception ex, ServiceContext context) throws IOException {
            super.onFailure(ex, context);
            Message resp = new Message(OP.COMPLETION_LIST).put("id", paragraphId);
            resp.put("completions", new ArrayList<>());
            conn.send(serializeMessage(resp));
          }
        });
  }

  /**
   * 1. When angular object updated from client.
   * 2. Save AngularObject to note.
   *
   * @param conn        the web socket.
   * @param fromMessage the message.
   */
  private void angularObjectUpdated(NotebookSocket conn,
                                    ServiceContext context,
                                    Message fromMessage) throws IOException {
    String noteId = (String) fromMessage.get("noteId");
    String paragraphId = (String) fromMessage.get("paragraphId");
    String interpreterGroupId = (String) fromMessage.get("interpreterGroupId");
    String varName = (String) fromMessage.get("name");
    Object varValue = fromMessage.get("value");
    String user = fromMessage.principal;

    getNotebookService().updateAngularObject(noteId, paragraphId, interpreterGroupId,
        varName, varValue, context,
        new WebSocketServiceCallback<AngularObject>(conn) {
          @Override
          public void onSuccess(AngularObject ao, ServiceContext context) throws IOException {
            super.onSuccess(ao, context);
            connectionManager.broadcastExcept(noteId,
                new Message(
                    OP.ANGULAR_OBJECT_UPDATE).put("angularObject", ao)
                    .put("interpreterGroupId", interpreterGroupId)
                    .put("noteId", noteId)
                    .put("paragraphId", ao.getParagraphId()),
                conn);
            getNotebook().processNote(noteId,
              note -> {
                note.addOrUpdateAngularObject(interpreterGroupId, ao);
                return null;
              });
          }
        });
  }

  /**
   * 1. Push the given Angular variable to the target interpreter angular
   * registry given a noteId and a paragraph id.
   * 2. Save AngularObject to note.
   */
  protected void angularObjectClientBind(NotebookSocket conn, Message fromMessage) throws Exception {
    String noteId = fromMessage.getType("noteId");
    String varName = fromMessage.getType("name");
    Object varValue = fromMessage.get("value");
    String paragraphId = fromMessage.getType("paragraphId");
    if (paragraphId == null) {
      throw new IllegalArgumentException(
          "target paragraph not specified for " + "angular value bind");
    }

    getNotebook().processNote(noteId,
      note -> {
        if (note != null) {
          InterpreterGroup interpreterGroup;
          try {
            interpreterGroup = findInterpreterGroupForParagraph(note, paragraphId);
          } catch (Exception e) {
            LOGGER.error("No interpreter group found for noteId {} and paragraphId {}", noteId, paragraphId, e);
            return null;
          }
          final RemoteAngularObjectRegistry registry = (RemoteAngularObjectRegistry)
              interpreterGroup.getAngularObjectRegistry();
          AngularObject ao = pushAngularObjectToRemoteRegistry(noteId, paragraphId, varName, varValue,
              registry, interpreterGroup.getId(), conn);
          note.addOrUpdateAngularObject(interpreterGroup.getId(), ao);
        }
        return null;
      });
  }

  /**
   * 1. Remove the given Angular variable to the target interpreter(s) angular
   * registry given a noteId and an optional list of paragraph id(s).
   * 2. Delete AngularObject from note.
   */
  protected void angularObjectClientUnbind(NotebookSocket conn, Message fromMessage) throws Exception {
    String noteId = fromMessage.getType("noteId");
    String varName = fromMessage.getType("name");
    String paragraphId = fromMessage.getType("paragraphId");
    if (paragraphId == null) {
      throw new IllegalArgumentException(
          "target paragraph not specified for " + "angular value unBind");
    }

    getNotebook().processNote(noteId,
      note -> {
        if (note != null) {
          InterpreterGroup interpreterGroup;
          try {
            interpreterGroup = findInterpreterGroupForParagraph(note, paragraphId);
          } catch (Exception e) {
            LOGGER.error("No interpreter group found for noteId {} and paragraphId {}", noteId, paragraphId, e);
            return null;
          }
          final RemoteAngularObjectRegistry registry =
              (RemoteAngularObjectRegistry) interpreterGroup.getAngularObjectRegistry();
          AngularObject ao =
              removeAngularFromRemoteRegistry(noteId, paragraphId, varName, registry, interpreterGroup.getId(), conn);
          note.deleteAngularObject(interpreterGroup.getId(), noteId, paragraphId, varName);
        }
        return null;
      });
  }

  private InterpreterGroup findInterpreterGroupForParagraph(Note note, String paragraphId) throws Exception {
    final Paragraph paragraph = note.getParagraph(paragraphId);
    if (paragraph == null) {
      throw new IllegalArgumentException("Unknown paragraph with id : " + paragraphId);
    }
    return paragraph.getBindedInterpreter().getInterpreterGroup();
  }

  private AngularObject pushAngularObjectToRemoteRegistry(String noteId, String paragraphId, String varName,
                                                          Object varValue,
                                                          RemoteAngularObjectRegistry remoteRegistry,
                                                          String interpreterGroupId,
                                                          NotebookSocket conn) {
    final AngularObject ao = remoteRegistry.addAndNotifyRemoteProcess(varName, varValue, noteId, paragraphId);

    connectionManager.broadcastExcept(noteId, new Message(OP.ANGULAR_OBJECT_UPDATE)
        .put("angularObject", ao)
        .put("interpreterGroupId", interpreterGroupId).put("noteId", noteId)
        .put("paragraphId", paragraphId), conn);

    return ao;
  }

  private AngularObject removeAngularFromRemoteRegistry(String noteId, String paragraphId, String varName,
                                                        RemoteAngularObjectRegistry remoteRegistry,
                                                        String interpreterGroupId,
                                                        NotebookSocket conn) {
    final AngularObject ao = remoteRegistry.removeAndNotifyRemoteProcess(varName, noteId, paragraphId);
    connectionManager.broadcastExcept(noteId, new Message(OP.ANGULAR_OBJECT_REMOVE)
        .put("angularObject", ao)
        .put("interpreterGroupId", interpreterGroupId).put("noteId", noteId)
        .put("paragraphId", paragraphId), conn);

    return ao;
  }

  private void moveParagraph(NotebookSocket conn,
                             ServiceContext context,
                             Message fromMessage) throws IOException {
    final String paragraphId = (String) fromMessage.get("id");
    final int newIndex = (int) Double.parseDouble(fromMessage.get("index").toString());
    String noteId = connectionManager.getAssociatedNoteId(conn);
    getNotebookService().moveParagraph(noteId, paragraphId, newIndex, context,
        new WebSocketServiceCallback<Paragraph>(conn) {
          @Override
          public void onSuccess(Paragraph result, ServiceContext context) throws IOException {
            super.onSuccess(result, context);
            connectionManager.broadcast(result.getNote().getId(),
                new Message(OP.PARAGRAPH_MOVED)
                    .put("id", paragraphId)
                    .put("index", newIndex));
          }
        });
  }

  private String insertParagraph(NotebookSocket conn,
                                 ServiceContext context,
                                 Message fromMessage) throws IOException {
    final int index = (int) Double.parseDouble(fromMessage.get("index").toString());
    String noteId = connectionManager.getAssociatedNoteId(conn);
    Map<String, Object> config;
    if (fromMessage.get("config") != null) {
      config = (Map<String, Object>) fromMessage.get("config");
    } else {
      config = new HashMap<>();
    }

    Paragraph newPara = getNotebookService().insertParagraph(noteId, index, config, context,
        new WebSocketServiceCallback<Paragraph>(conn) {
          @Override
          public void onSuccess(Paragraph p, ServiceContext context) throws IOException {
            super.onSuccess(p, context);
            broadcastNewParagraph(p.getNote(), p);
          }
        });

    return newPara.getId();
  }

  private void copyParagraph(NotebookSocket conn,
                             ServiceContext context,
                             Message fromMessage) throws IOException {
    String newParaId = insertParagraph(conn, context, fromMessage);

    if (newParaId == null) {
      return;
    }
    fromMessage.put("id", newParaId);

    updateParagraph(conn, context, fromMessage);
  }

  private void cancelParagraph(NotebookSocket conn, ServiceContext context, Message fromMessage) throws IOException {
    final String paragraphId = (String) fromMessage.get("id");
    String noteId = connectionManager.getAssociatedNoteId(conn);
    getNotebookService().cancelParagraph(noteId, paragraphId, context, new WebSocketServiceCallback<>(conn));
  }

  private void runAllParagraphs(NotebookSocket conn,
                                ServiceContext context,
                                Message fromMessage) throws IOException {
    final String noteId = (String) fromMessage.get("noteId");
    List<Map<String, Object>> paragraphs =
        gson.fromJson(String.valueOf(fromMessage.data.get("paragraphs")),
            new TypeToken<List<Map<String, Object>>>() {
            }.getType());

    executorService.submit(() -> {
      try {
        if (!getNotebookService().runAllParagraphs(noteId, paragraphs, context,
            new WebSocketServiceCallback<Paragraph>(conn))) {
          // If one paragraph fails, we need to broadcast paragraph states to the client,
          // or paragraphs not run will stay in PENDING state.
          getNotebookService().getNote(noteId, context, new SimpleServiceCallback<>(),
            note -> {
              if (note != null) {
                for (Paragraph p : note.getParagraphs()) {
                  broadcastParagraph(note, p, null);
                }
              }
              return null;
            });
        }
      } catch (Throwable t) {
        LOGGER.error("Error in running all paragraphs", t);
      }
    });
  }

  private void broadcastSpellExecution(NotebookSocket conn,
                                       ServiceContext context,
                                       Message fromMessage) throws IOException {

    String noteId = connectionManager.getAssociatedNoteId(conn);
    getNotebookService().spell(noteId, fromMessage,
        context, new WebSocketServiceCallback<Paragraph>(conn) {
          @Override
          public void onSuccess(Paragraph p, ServiceContext context) throws IOException {
            super.onSuccess(p, context);
            // broadcast to other clients only
            connectionManager.broadcastExcept(p.getNote().getId(),
                new Message(OP.RUN_PARAGRAPH_USING_SPELL).put("paragraph", p), conn);
          }
        });
  }

  private void runParagraph(NotebookSocket conn,
                            ServiceContext context,
                            Message fromMessage) throws IOException {
    String paragraphId = (String) fromMessage.get("id");
    String noteId = connectionManager.getAssociatedNoteId(conn);
    String text = (String) fromMessage.get("paragraph");
    String title = (String) fromMessage.get("title");
    Map<String, Object> params = (Map<String, Object>) fromMessage.get("params");
    Map<String, Object> config = (Map<String, Object>) fromMessage.get("config");
    getNotebook().processNote(noteId,
      note -> {
        getNotebookService().runParagraph(note, paragraphId, title, text, params, config, null,
          false, false, context,
          new WebSocketServiceCallback<Paragraph>(conn) {
            @Override
            public void onSuccess(Paragraph p, ServiceContext context)
                throws IOException {
              super.onSuccess(p, context);
              if (p.getNote().isPersonalizedMode()) {
                Paragraph p2 = p.getNote().clearPersonalizedParagraphOutput(paragraphId,
                    context.getAutheInfo().getUser());
                connectionManager.unicastParagraph(p.getNote(), p2, context.getAutheInfo().getUser(), fromMessage.msgId);
              }

              // if it's the last paragraph and not empty, let's add a new one
              boolean isTheLastParagraph = p.getNote().isLastParagraph(paragraphId);
              if (!(StringUtils.isEmpty(p.getText()) ||
                StringUtils.isEmpty(p.getScriptText())) &&
                  isTheLastParagraph) {
                Paragraph newPara = p.getNote().addNewParagraph(p.getAuthenticationInfo());
                broadcastNewParagraph(p.getNote(), newPara);
              }
            }
          });
        return null;
      });

  }

  private void sendAllConfigurations(NotebookSocket conn,
                                     ServiceContext context,
                                     Message message) throws IOException {

    getConfigurationService().getAllProperties(context,
        new WebSocketServiceCallback<Map<String, String>>(conn) {
          @Override
          public void onSuccess(Map<String, String> properties, ServiceContext context) throws IOException {
            super.onSuccess(properties, context);
            properties.put("isRevisionSupported", String.valueOf(getNotebook().isRevisionSupported()));
            conn.send(serializeMessage(new Message(OP.CONFIGURATIONS_INFO).put("configurations", properties)));
          }
        });
  }

  private void checkpointNote(NotebookSocket conn,
                              ServiceContext context,
                              Message fromMessage) throws IOException {
    String noteId = (String) fromMessage.get("noteId");
    String commitMessage = (String) fromMessage.get("commitMessage");

    getNotebookService().checkpointNote(noteId, commitMessage, context,
        new WebSocketServiceCallback<Revision>(conn) {
          @Override
          public void onSuccess(Revision revision, ServiceContext context) throws IOException {
            super.onSuccess(revision, context);
            if (!Revision.isEmpty(revision)) {

              List<Revision> revisions = getNotebook().processNote(noteId,
                note -> getNotebook().listRevisionHistory(noteId, note.getPath(), context.getAutheInfo()));
              conn.send(serializeMessage(new Message(OP.LIST_REVISION_HISTORY).put("revisionList", revisions)));
            } else {
              conn.send(serializeMessage(
                  new Message(OP.ERROR_INFO).put("info",
                      "Couldn't checkpoint note revision: possibly no changes found or storage doesn't support versioning. "
                          + "Please check the logs for more details.")));
            }
          }
        });
  }

  private void listRevisionHistory(NotebookSocket conn,
                                   ServiceContext context,
                                   Message fromMessage) throws IOException {
    String noteId = (String) fromMessage.get("noteId");
    getNotebookService().listRevisionHistory(noteId, context,
        new WebSocketServiceCallback<List<Revision>>(conn) {
          @Override
          public void onSuccess(List<Revision> revisions, ServiceContext context) throws IOException {
            super.onSuccess(revisions, context);
            conn.send(serializeMessage(new Message(OP.LIST_REVISION_HISTORY).put("revisionList", revisions)));
          }
        });
  }

  private void setNoteRevision(NotebookSocket conn,
                               ServiceContext context,
                               Message fromMessage) throws IOException {
    String noteId = (String) fromMessage.get("noteId");
    String revisionId = (String) fromMessage.get("revisionId");
    getNotebookService().setNoteRevision(noteId, revisionId, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context) throws IOException {
            super.onSuccess(note, context);
            Note reloadedNote = getNotebook().loadNoteFromRepo(noteId, context.getAutheInfo());
            conn.send(serializeMessage(new Message(OP.SET_NOTE_REVISION).put("status", true)));
            broadcastNote(reloadedNote);
          }
        });
  }

  private void getNoteByRevision(NotebookSocket conn,
                                 ServiceContext context,
                                 Message fromMessage)
      throws IOException {
    String noteId = (String) fromMessage.get("noteId");
    String revisionId = (String) fromMessage.get("revisionId");
    getNotebookService().getNotebyRevision(noteId, revisionId, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context) throws IOException {
            super.onSuccess(note, context);
            conn.send(serializeMessage(
                new Message(OP.NOTE_REVISION)
                    .put("noteId", noteId)
                    .put("revisionId", revisionId)
                    .put("note", note)));
          }
        });
  }

  private void getNoteByRevisionForCompare(NotebookSocket conn,
                                           ServiceContext context,
                                           Message fromMessage) throws IOException {
    String noteId = (String) fromMessage.get("noteId");
    String revisionId = (String) fromMessage.get("revisionId");
    String position = (String) fromMessage.get("position");
    getNotebookService().getNoteByRevisionForCompare(noteId, revisionId, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context) throws IOException {
            super.onSuccess(note, context);
            conn.send(serializeMessage(
                new Message(OP.NOTE_REVISION_FOR_COMPARE)
                    .put("noteId", noteId)
                    .put("revisionId", revisionId)
                    .put("position", position)
                    .put("note", note)));
          }
        });
  }

  /**
   * This callback is for the paragraph that runs on ZeppelinServer.
   *
   * @param output output to append
   */
  @Override
  public void onOutputAppend(String noteId, String paragraphId, int index, String output) {
    if (!sendParagraphStatusToFrontend()) {
      return;
    }
    Message msg = new Message(OP.PARAGRAPH_APPEND_OUTPUT)
        .put("noteId", noteId)
        .put("paragraphId", paragraphId)
        .put("index", index)
        .put("data", output);
    connectionManager.broadcast(noteId, msg);
  }

  /**
   * This callback is for the paragraph that runs on ZeppelinServer.
   *
   * @param output output to update (replace)
   */
  @Override
  public void onOutputUpdated(String noteId, String paragraphId, int index,
                              InterpreterResult.Type type, String output) {
    if (!sendParagraphStatusToFrontend()) {
      return;
    }
    Message msg = new Message(OP.PARAGRAPH_UPDATE_OUTPUT)
        .put("noteId", noteId)
        .put("paragraphId", paragraphId)
        .put("index", index)
        .put("type", type)
        .put("data", output);
    try {
      getNotebook().processNote(noteId,
        note -> {
          if (note == null) {
            LOGGER.warn("Note {} not found", noteId);
            return null;
          }
          Paragraph paragraph = note.getParagraph(paragraphId);
          paragraph.updateOutputBuffer(index, type, output);
          if (note.isPersonalizedMode()) {
            String user = note.getParagraph(paragraphId).getUser();
            if (null != user) {
              connectionManager.multicastToUser(user, msg);
            }
          } else {
            connectionManager.broadcast(noteId, msg);
          }
          return null;
        });
    } catch (IOException e) {
      LOGGER.warn("Fail to call onOutputUpdated", e);
    }
  }

  /**
   * This callback is for the paragraph that runs on ZeppelinServer.
   */
  @Override
  public void onOutputClear(String noteId, String paragraphId) {
    if (!sendParagraphStatusToFrontend()) {
      return;
    }

    try {
      getNotebook().processNote(noteId,
        note -> {
          if (note == null) {
            // It is possible the note is removed, but the job is still running
            LOGGER.warn("Note {} doesn't existed, it maybe deleted.", noteId);
          } else {
            note.clearParagraphOutput(paragraphId);
            Paragraph paragraph = note.getParagraph(paragraphId);
            broadcastParagraph(note, paragraph, MSG_ID_NOT_DEFINED);
          }
          return null;
        });

    } catch (IOException e) {
      LOGGER.warn("Fail to call onOutputClear", e);
    }
  }

  /**
   * When application append output.
   */
  @Override
  public void onOutputAppend(String noteId, String paragraphId, int index, String appId,
                             String output) {
    Message msg =
        new Message(OP.APP_APPEND_OUTPUT).put("noteId", noteId).put("paragraphId", paragraphId)
            .put("index", index).put("appId", appId).put("data", output);
    connectionManager.broadcast(noteId, msg);
  }

  /**
   * When application update output.
   */
  @Override
  public void onOutputUpdated(String noteId, String paragraphId, int index, String appId,
                              InterpreterResult.Type type, String output) {
    Message msg =
        new Message(OP.APP_UPDATE_OUTPUT)
            .put("noteId", noteId)
            .put("paragraphId", paragraphId)
            .put("index", index)
            .put("type", type)
            .put("appId", appId)
            .put("data", output);
    connectionManager.broadcast(noteId, msg);
  }

  @Override
  public void onLoad(String noteId, String paragraphId, String appId, HeliumPackage pkg) {
    Message msg = new Message(OP.APP_LOAD).put("noteId", noteId).put("paragraphId", paragraphId)
        .put("appId", appId).put("pkg", pkg);
    connectionManager.broadcast(noteId, msg);
  }

  @Override
  public void onStatusChange(String noteId, String paragraphId, String appId, String status) {
    Message msg =
        new Message(OP.APP_STATUS_CHANGE).put("noteId", noteId).put("paragraphId", paragraphId)
            .put("appId", appId).put("status", status);
    connectionManager.broadcast(noteId, msg);
  }

  @Override
  public void runParagraphs(String noteId,
                            List<Integer> paragraphIndices,
                            List<String> paragraphIds,
                            String curParagraphId) throws IOException {
    getNotebook().processNote(noteId,
      note -> {
        final List<String> toBeRunParagraphIds = new ArrayList<>();
        if (note == null) {
          throw new IOException("Not existed noteId: " + noteId);
        }
        if (!paragraphIds.isEmpty() && !paragraphIndices.isEmpty()) {
          throw new IOException("Can not specify paragraphIds and paragraphIndices together");
        }
        if (paragraphIds != null && !paragraphIds.isEmpty()) {
          for (String paragraphId : paragraphIds) {
            if (note.getParagraph(paragraphId) == null) {
              throw new IOException("Not existed paragraphId: " + paragraphId);
            }
            if (!paragraphId.equals(curParagraphId)) {
              toBeRunParagraphIds.add(paragraphId);
            }
          }
        }
        if (paragraphIndices != null && !paragraphIndices.isEmpty()) {
          for (int paragraphIndex : paragraphIndices) {
            if (note.getParagraph(paragraphIndex) == null) {
              throw new IOException("Not existed paragraphIndex: " + paragraphIndex);
            }
            if (!note.getParagraph(paragraphIndex).getId().equals(curParagraphId)) {
              toBeRunParagraphIds.add(note.getParagraph(paragraphIndex).getId());
            }
          }
        }
        // run the whole note except the current paragraph
        if (paragraphIds.isEmpty() && paragraphIndices.isEmpty()) {
          for (Paragraph paragraph : note.getParagraphs()) {
            if (!paragraph.getId().equals(curParagraphId)) {
              toBeRunParagraphIds.add(paragraph.getId());
            }
          }
        }
        Runnable runThread = new Runnable() {
          @Override
          public void run() {
            for (String paragraphId : toBeRunParagraphIds) {
              note.run(paragraphId, true);
            }
          }
        };
        executorService.submit(runThread);
        return null;
      });
  }

  @Override
  public void onParagraphRemove(Paragraph p) {
    try {
      ServiceContext context =
          new ServiceContext(new AuthenticationInfo(), authorizationService.getOwners(p.getNote().getId()));
      getJobManagerService().getNoteJobInfoByUnixTime(System.currentTimeMillis() - 5000, context,
          new JobManagerServiceCallback());
    } catch (IOException e) {
      LOGGER.warn("can not broadcast for job manager: {}", e.getMessage(), e);
    }
  }

  @Override
  public void onNoteRemove(Note note, AuthenticationInfo subject) {
    try {
      broadcastUpdateNoteJobInfo(note, System.currentTimeMillis() - 5000);
    } catch (IOException e) {
      LOGGER.warn("can not broadcast for job manager: {}", e.getMessage(), e);
    }

    try {
      getJobManagerService().removeNoteJobInfo(note.getId(), null,
          new JobManagerServiceCallback());
    } catch (IOException e) {
      LOGGER.warn("can not broadcast for job manager: {}", e.getMessage(), e);
    }

  }

  @Override
  public void onParagraphCreate(Paragraph p) {
    try {
      getJobManagerService().getNoteJobInfo(p.getNote().getId(), null,
          new JobManagerServiceCallback());
    } catch (IOException e) {
      LOGGER.warn("can not broadcast for job manager: {}", e.getMessage(), e);
    }
  }

  @Override
  public void onParagraphUpdate(Paragraph p) {
    // do nothing
  }

  @Override
  public void onNoteCreate(Note note, AuthenticationInfo subject) {
    try {
      getJobManagerService().getNoteJobInfo(note.getId(), null,
          new JobManagerServiceCallback());
    } catch (IOException e) {
      LOGGER.warn("can not broadcast for job manager: {}", e.getMessage(), e);
    }
  }

  @Override
  public void onNoteUpdate(Note note, AuthenticationInfo subject) {
    // do nothing
  }

  @Override
  public void onParagraphStatusChange(Paragraph p, Status status) {
    try {
      getJobManagerService().getNoteJobInfo(p.getNote().getId(), null,
          new JobManagerServiceCallback());
    } catch (IOException e) {
      LOGGER.warn("can not broadcast for job manager: {}", e.getMessage(), e);
    }
  }

  private class JobManagerServiceCallback
      extends SimpleServiceCallback<List<JobManagerService.NoteJobInfo>> {
    @Override
    public void onSuccess(List<JobManagerService.NoteJobInfo> notesJobInfo,
                          ServiceContext context) throws IOException {
      super.onSuccess(notesJobInfo, context);
      Map<String, Object> response = new HashMap<>();
      response.put("lastResponseUnixTime", System.currentTimeMillis());
      response.put("jobs", notesJobInfo);
      connectionManager.broadcast(JobManagerServiceType.JOB_MANAGER_PAGE.getKey(),
          new Message(OP.LIST_UPDATE_NOTE_JOBS).put("noteRunningJobs", response));
    }
  }

  @Override
  public void onProgressUpdate(Job<?> job, int progress) {
    if (job instanceof Paragraph) {
      final Paragraph p = (Paragraph) job;
      if (!sendParagraphStatusToFrontend()) {
        return;
      }
      connectionManager.broadcast(p.getNote().getId(),
          new Message(OP.PROGRESS).put("id", p.getId()).put("progress", progress));
    }
  }

  @Override
  public void onStatusChange(Job<?> job, Status before, Status after) {
    if (job instanceof Paragraph) {
      final Paragraph p = (Paragraph) job;

      if (after == Status.ERROR) {
        if (p.getException() != null) {
          LOGGER.error("Error", p.getException());
        }
      }

      if (p.isTerminated() || after == Status.RUNNING) {
        if (p.getStatus() == Status.FINISHED) {
          LOGGER.info("Job {} is finished successfully, status: {}", p.getId(), p.getStatus());
        } else if (p.isTerminated()) {
          LOGGER.warn("Job {} is finished, status: {}, exception: {}, result: {}", p.getId(),
              p.getStatus(), p.getException(), p.getReturn());
        } else {
          LOGGER.info("Job {} starts to RUNNING", p.getId());
        }

        try {
          String noteId = p.getNote().getId();
          getNotebook().processNote(noteId,
              note -> {
                if (note == null) {
                  LOGGER.warn("Note {} doesn't existed.", noteId);
                  return null;
                } else {
                  getNotebook().saveNote(p.getNote(), p.getAuthenticationInfo());
                }
                return null;
              });
        } catch (IOException e) {
          LOGGER.error(e.toString(), e);
        }
      }

      p.setStatusToUserParagraph(p.getStatus());
      broadcastParagraph(p.getNote(), p, MSG_ID_NOT_DEFINED);
      try {
        broadcastUpdateNoteJobInfo(p.getNote(), System.currentTimeMillis() - 5000);
      } catch (IOException e) {
        LOGGER.error("can not broadcast for job manager", e);
      }
    }

  }

  @Override
  public void checkpointOutput(String noteId, String paragraphId) {
    try {
      getNotebook().processNote(noteId,
        note -> {
          note.getParagraph(paragraphId).checkpointOutput();
          getNotebook().saveNote(note, AuthenticationInfo.ANONYMOUS);
          return null;
        });
    } catch (IOException e) {
      LOGGER.warn("Fail to save note: {}", noteId, e);
    }
  }

  @Override
  public void noteRunningStatusChange(String noteId, boolean newStatus) {
    connectionManager.broadcast(noteId, new Message(OP.NOTE_RUNNING_STATUS).put("status", newStatus));
  }

  private void sendAllAngularObjects(Note note, String user, NotebookSocket conn)
      throws IOException {
    List<InterpreterSetting> settings =
        getNotebook().getBindedInterpreterSettings(note.getId());
    if (settings == null || settings.isEmpty()) {
      return;
    }

    for (InterpreterSetting intpSetting : settings) {
      if (intpSetting.getInterpreterGroup(user, note.getId()) == null) {
        continue;
      }
      AngularObjectRegistry registry =
          intpSetting.getInterpreterGroup(user, note.getId()).getAngularObjectRegistry();
      List<AngularObject> objects = registry.getAllWithGlobal(note.getId());
      for (AngularObject object : objects) {
        conn.send(serializeMessage(
            new Message(OP.ANGULAR_OBJECT_UPDATE).put("angularObject", object)
                .put("interpreterGroupId",
                    intpSetting.getInterpreterGroup(user,
                            note.getId())
                        .getId())
                .put("noteId", note.getId())
                .put("paragraphId", object.getParagraphId())));
      }
    }
  }

  @Override
  public void onAddAngularObject(String interpreterGroupId, AngularObject angularObject) {
    onUpdateAngularObject(interpreterGroupId, angularObject);
  }

  @Override
  public void onUpdateAngularObject(String interpreterGroupId, AngularObject angularObject) {
    if (getNotebook() == null) {
      return;
    }

    // not global scope, so we just need to load the corresponded note.
    if (angularObject.getNoteId() != null) {
      try {
        updateNoteAngularObject(angularObject.getNoteId(), angularObject, interpreterGroupId);
      } catch (IOException e) {
        LOGGER.error("AngularObject's note: {} is not found", angularObject.getNoteId(), e);
      }
    } else {
      // global scope angular object needs to load and iterate all notes, this is inefficient.
      getNotebook().getNotesInfo().stream().forEach(noteInfo -> {
        if (angularObject.getNoteId() != null && !noteInfo.getId().equals(angularObject.getNoteId())) {
          return;
        }
        try {
          updateNoteAngularObject(noteInfo.getId(), angularObject, interpreterGroupId);
        } catch (IOException e) {
          LOGGER.error("AngularObject's note: {} is not found", angularObject.getNoteId(), e);
        }
      });
    }
  }

  private void updateNoteAngularObject(String noteId, AngularObject angularObject, String interpreterGroupId) throws IOException {
    List<InterpreterSetting> intpSettings = getNotebook().
      processNote(noteId, note -> note.getBindedInterpreterSettings(new ArrayList<>(authorizationService.getOwners(note.getId()))));
    if (intpSettings.isEmpty()) {
      return;
    }
    connectionManager.broadcast(noteId, new Message(OP.ANGULAR_OBJECT_UPDATE)
        .put("angularObject", angularObject)
        .put("interpreterGroupId", interpreterGroupId).put("noteId", noteId)
        .put("paragraphId", angularObject.getParagraphId()));
  }

  @Override
  public void onRemoveAngularObject(String interpreterGroupId, AngularObject angularObject) {
    // not global scope, so we just need to load the corresponded note.
    if (angularObject.getNoteId() != null) {
      String noteId = angularObject.getNoteId();
      removeNoteAngularObject(noteId, angularObject, interpreterGroupId);
    } else {
      // global scope angular object needs to load and iterate all notes, this is inefficient.
      getNotebook().getNotesInfo().forEach(noteInfo -> {
        if (angularObject.getNoteId() != null && !noteInfo.getId().equals(angularObject.getNoteId())) {
          return;
        }
        removeNoteAngularObject(noteInfo.getId(), angularObject, interpreterGroupId);
      });
    }
  }

  private void removeNoteAngularObject(String noteId, AngularObject angularObject, String interpreterGroupId) {
    List<String> settingIds =
        getNotebook().getInterpreterSettingManager().getSettingIds();
    for (String id : settingIds) {
      if (interpreterGroupId.contains(id)) {
        connectionManager.broadcast(noteId,
            new Message(OP.ANGULAR_OBJECT_REMOVE)
                .put("name", angularObject.getName())
                .put("noteId", angularObject.getNoteId())
                .put("paragraphId", angularObject.getParagraphId()));
        break;
      }
    }
  }

  private void getEditorSetting(NotebookSocket conn,
                                ServiceContext context,
                                Message fromMessage) throws IOException {
    String paragraphId = (String) fromMessage.get("paragraphId");
    String paragraphText = (String) fromMessage.get("paragraphText");
    String noteId = connectionManager.getAssociatedNoteId(conn);

    getNotebookService().getEditorSetting(noteId, paragraphText, context,
        new WebSocketServiceCallback<Map<String, Object>>(conn) {
          @Override
          public void onSuccess(Map<String, Object> settings, ServiceContext context) throws IOException {
            super.onSuccess(settings, context);
            Message resp = new Message(OP.EDITOR_SETTING);
            resp.put("paragraphId", paragraphId);
            resp.put("editor", settings);
            conn.send(serializeMessage(resp));
          }

          @Override
          public void onFailure(Exception ex, ServiceContext context) {
            LOGGER.warn(ex.getMessage());
          }
        });
  }

  private void getInterpreterSettings(NotebookSocket conn,
                                      ServiceContext context,
                                      Message message) throws IOException {
    List<InterpreterSetting> allSettings = getNotebook().getInterpreterSettingManager().get();
    List<InterpreterSetting> result = new ArrayList<>();
    for (InterpreterSetting setting : allSettings) {
      if (setting.isUserAuthorized(new ArrayList<>(context.getUserAndRoles()))) {
        result.add(setting);
      }
    }
    conn.send(serializeMessage(
        new Message(OP.INTERPRETER_SETTINGS).put("interpreterSettings", result)));
  }

  @Override
  public void onParaInfosReceived(String noteId, String paragraphId,
                                  String interpreterSettingId, Map<String, String> metaInfos) {
    try {
      getNotebook().processNote(noteId,
        note -> {
          if (note != null) {
            Paragraph paragraph = note.getParagraph(paragraphId);
            if (paragraph != null) {
              InterpreterSetting setting = getNotebook().getInterpreterSettingManager()
                  .get(interpreterSettingId);
              String label = metaInfos.get("label");
              String tooltip = metaInfos.get("tooltip");
              List<String> keysToRemove = Arrays.asList("noteId", "paraId", "label", "tooltip");
              for (String removeKey : keysToRemove) {
                metaInfos.remove(removeKey);
              }
              paragraph
                .updateRuntimeInfos(label, tooltip, metaInfos, setting.getGroup(), setting.getId());
              getNotebook().saveNote(note, AuthenticationInfo.ANONYMOUS);
              connectionManager.broadcast(
                  note.getId(),
                  new Message(OP.PARAS_INFO).put("id", paragraphId).put("infos",
                      paragraph.getRuntimeInfos()));
            }
          }
          return null;
        });
    } catch (IOException e) {
      LOGGER.warn("Fail to call onParaInfosReceived", e);
    }
  }

  @Override
  public List<ParagraphInfo> getParagraphList(String user, String noteId)
      throws IOException, TException, ServiceException{
      // Check READER permission
      Set<String> userAndRoles = new HashSet<>();
      userAndRoles.add(user);
      boolean isAllowed = authorizationService.isReader(noteId, userAndRoles);
      Set<String> allowed = authorizationService.getReaders(noteId);
      if (!isAllowed) {
        String errorMsg = "Insufficient privileges to READER note. " +
            "Allowed users or roles: " + allowed;
        throw new ServiceException(errorMsg);
      }
      return getNotebook().processNote(noteId,
        note -> {
          if (null == note) {
            throw new IOException("Not found this note : " + noteId);
          }
          // Convert Paragraph to ParagraphInfo
          List<ParagraphInfo> paragraphInfos = new ArrayList<>();
          List<Paragraph> paragraphs = note.getParagraphs();
          for (Paragraph paragraph : paragraphs) {
            ParagraphInfo paraInfo = new ParagraphInfo();
            paraInfo.setNoteId(noteId);
            paraInfo.setParagraphId(paragraph.getId());
            paraInfo.setParagraphTitle(paragraph.getTitle());
            paraInfo.setParagraphText(paragraph.getText());
            paragraphInfos.add(paraInfo);
          }
          return paragraphInfos;
        });
  }

  private void broadcastNoteForms(Note note) {
    GUI formsSettings = new GUI();
    formsSettings.setForms(note.getNoteForms());
    formsSettings.setParams(note.getNoteParams());
    connectionManager.broadcast(note.getId(),
        new Message(OP.SAVE_NOTE_FORMS).put("formsData", formsSettings));
  }

  private void saveNoteForms(NotebookSocket conn,
                             ServiceContext context,
                             Message fromMessage) throws IOException {
    String noteId = (String) fromMessage.get("noteId");
    Map<String, Object> noteParams = (Map<String, Object>) fromMessage.get("noteParams");

    getNotebookService().saveNoteForms(noteId, noteParams, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context) {
            broadcastNoteForms(note);
          }
        });
  }

  private void removeNoteForms(NotebookSocket conn,
                               ServiceContext context,
                               Message fromMessage) throws IOException {
    String noteId = (String) fromMessage.get("noteId");
    String formName = (String) fromMessage.get("formName");

    getNotebookService().removeNoteForms(noteId, formName, context,
        new WebSocketServiceCallback<Note>(conn) {
          @Override
          public void onSuccess(Note note, ServiceContext context) {
            broadcastNoteForms(note);
          }
        });
  }

  @ManagedAttribute
  public Set<String> getConnectedUsers() {
    return connectionManager.getConnectedUsers();
  }

  @ManagedOperation
  public void sendMessage(String message) {
    Message m = new Message(OP.NOTICE);
    m.data.put("notice", message);
    connectionManager.broadcast(m);
  }

  private ServiceContext getServiceContext(TicketContainer.Entry ticketEntry) {
    AuthenticationInfo authInfo =
        new AuthenticationInfo(ticketEntry.getPrincipal(), ticketEntry.getRoles(), ticketEntry.getTicket());
    Set<String> userAndRoles = new HashSet<>();
    userAndRoles.add(authInfo.getUser());
    userAndRoles.addAll(authInfo.getRoles());
    return new ServiceContext(authInfo, userAndRoles);
  }

  public class WebSocketServiceCallback<T> extends SimpleServiceCallback<T> {

    private final NotebookSocket conn;

    WebSocketServiceCallback(NotebookSocket conn) {
      this.conn = conn;
    }

    @Override
    public void onFailure(Exception ex, ServiceContext context) throws IOException {
      super.onFailure(ex, context);
      if (ex instanceof ForbiddenException) {
        Type type = new TypeToken<Map<String, String>>() {
        }.getType();
        Map<String, String> jsonObject =
            gson.fromJson(((ForbiddenException) ex).getResponse().getEntity().toString(), type);
        conn.send(serializeMessage(new Message(OP.AUTH_INFO)
            .put("info", jsonObject.get("message"))));
      } else {
        String message = ex.getMessage();
        if (ex.getCause() != null) {
          message += ", cause: " + ex.getCause().getMessage();
        }
        conn.send(serializeMessage(new Message(OP.ERROR_INFO).put("info", message)));
      }
    }
  }
}
