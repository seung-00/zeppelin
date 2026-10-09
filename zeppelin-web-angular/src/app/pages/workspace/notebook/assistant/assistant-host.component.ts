/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ChangeDetectorRef, Component, DoCheck, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { merge, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { Note, OP, type AssistantHostProps, type AssistantSocket } from '@zeppelin/sdk';
import { BaseUrlService, MessageService, TicketService } from '@zeppelin/services';
import { AssistantReveal } from './assistant-reveal';
import { AssistantSlots } from './assistant-slots';

@Component({
  selector: 'zeppelin-assistant-host',
  template: `
    @if (useAssistantPanel) {
      @if (assistantPanelFailed) {
        <p role="alert">Unable to load the assistant.</p>
      } @else {
        <div zeppelin-react-mount="./AssistantWorkspace" [reactProps]="assistantProps ?? {}"></div>
      }
    }
  `,
  standalone: false
})
export class AssistantHostComponent implements OnInit, DoCheck, OnDestroy {
  /** A resize of the panel, so the notebook sidebar keeps the same width. */
  @Output() readonly panelWidthChange = new EventEmitter<number>();
  useAssistantPanel = false;
  assistantPanelFailed = false;
  /** Props for the remote; rebuilt after an invalidation, and refreshed when the paragraph list changes. */
  assistantProps: AssistantHostProps | null = null;

  // Sending and run events share the notebook WebSocket, which Angular owns.
  readonly assistantSocket: AssistantSocket = {
    connectionKey: this.messages,
    send: message => {
      if (message.noteId !== this.note?.id) {
        throw new DOMException('Notebook changed', 'AbortError');
      }
      this.messages.send<OP.ASSISTANT_SEND_MESSAGE>(OP.ASSISTANT_SEND_MESSAGE, message);
    },
    subscribe: listener => {
      const subscription = this.messages.receive(OP.ASSISTANT_EVENT).subscribe(listener);
      return () => subscription.unsubscribe();
    },
    subscribeClose: listener => {
      const subscription = this.messages.closed().subscribe(() => listener());
      return () => subscription.unsubscribe();
    }
  };

  private currentNote!: Exclude<Note['note'], undefined>;
  private destroy$ = new Subject<void>();
  private lastParagraphs: NonNullable<AssistantHostProps['paragraphs']> = [];
  private panelWidth?: number;

  private draftOwner = this.ticket.ticket?.principal;
  private sessionController?: AbortController;
  private scopedSocket?: AssistantSocket;
  private assistantGeneration = 0;
  private destroyed = false;

  constructor(
    private cdr: ChangeDetectorRef,
    private baseUrl: BaseUrlService,
    private ticket: TicketService,
    private slots: AssistantSlots,
    private reveal: AssistantReveal,
    private messages: MessageService
  ) {}

  get note(): Exclude<Note['note'], undefined> {
    return this.currentNote;
  }

  /** The notebook reads the reactAssistant flag with the other React surface flags. */
  @Input() set enabled(enabled: boolean) {
    if (this.useAssistantPanel && !enabled) this.invalidateAssistant();
    // Turning it back on retries a remote that failed to load.
    if (!this.useAssistantPanel && enabled) this.assistantPanelFailed = false;
    this.useAssistantPanel = enabled;
  }

  @Input() set note(note: Exclude<Note['note'], undefined>) {
    if (this.currentNote?.id !== note?.id) {
      this.invalidateAssistant();
      this.assistantPanelFailed = false;
    }
    this.currentNote = note;
  }

  /** The notebook sidebar's width, which the panel shares. */
  @Input() set sidebarWidth(width: number) {
    this.panelWidth = width;
  }

  // Stable across prop rebuilds so the React panel does not re-report its visibility.
  readonly onPanelVisibilityChange = (visible: boolean): void => {
    this.slots.setPanelOpen(visible);
  };

  readonly subscribePanelClose = (listener: () => void): (() => void) => {
    const subscription = this.slots.panelCloseRequests.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  readonly onPanelWidthChange = (width: number): void => {
    this.panelWidthChange.emit(width);
  };

  readonly onAssistantError = (error: unknown): void => {
    console.error('React assistant panel error', error);
    this.assistantPanelFailed = true;
    this.cdr.markForCheck();
  };

  ngOnInit(): void {
    merge(this.ticket.ticket$, this.ticket.logout$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.refreshAccount());
    this.slots.slots.pipe(takeUntil(this.destroy$)).subscribe(() => {
      // Slots are registered during child view checks; publish once that pass finishes.
      queueMicrotask(() => {
        if (this.destroyed) return;
        this.assistantProps = null;
        this.cdr.markForCheck();
      });
    });
  }

  // Paragraphs can be added, removed or retitled in place on the same note object, so they are compared each
  // check rather than only when `note` is set. The shared sidebar width follows the same way.
  ngDoCheck(): void {
    if (!this.useAssistantPanel || !this.currentNote) return;
    this.refreshAccount();
    const paragraphs = this.note.paragraphs;
    const paragraphCount = paragraphs?.length ?? 0;
    let paragraphsChanged = paragraphCount !== this.lastParagraphs.length;
    for (let index = 0; !paragraphsChanged && index < paragraphCount; index++) {
      const previous = this.lastParagraphs[index];
      const current = paragraphs[index];
      paragraphsChanged = previous.id !== current.id || previous.title !== current.title;
    }
    if (paragraphsChanged) {
      this.lastParagraphs = (paragraphs ?? []).map(({ id, title }) => ({ id, title }));
    }
    if (!this.assistantProps) {
      this.assistantProps = this.buildAssistantProps(this.lastParagraphs);
    } else if (paragraphsChanged || this.assistantProps.panelWidth !== this.panelWidth) {
      this.assistantProps = { ...this.assistantProps, paragraphs: this.lastParagraphs, panelWidth: this.panelWidth };
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.invalidateAssistant();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private refreshAccount(): void {
    const owner = this.ticket.ticket?.principal;
    if (owner === this.draftOwner) return;
    this.draftOwner = owner;
    this.invalidateAssistant();
    this.assistantPanelFailed = false;
    this.cdr.markForCheck();
  }

  private invalidateAssistant(): void {
    this.assistantGeneration++;
    this.assistantProps = null;
    this.sessionController?.abort();
    this.sessionController = undefined;
    this.scopedSocket = undefined;
  }

  private buildAssistantProps(paragraphs: AssistantHostProps['paragraphs']): AssistantHostProps {
    const generation = this.assistantGeneration;
    const owner = this.draftOwner;
    const isCurrent = () => generation === this.assistantGeneration && owner === this.ticket.ticket?.principal;
    if (!this.scopedSocket) {
      this.sessionController = new AbortController();
      this.scopedSocket = {
        ...this.assistantSocket,
        signal: this.sessionController.signal,
        send: message => {
          if (!isCurrent() || !this.useAssistantPanel || this.destroyed) {
            throw new DOMException('Assistant session changed', 'AbortError');
          }
          this.assistantSocket.send(message);
        }
      };
    }
    return {
      noteId: this.note.id,
      // The remote calls the conversation REST API itself; auth failures come back through onAuthError.
      apiBase: this.baseUrl.getRestApiBase(),
      socket: this.scopedSocket,
      slots: this.slots.slots.value,
      draftOwner: owner,
      onAuthError: (status, location) => {
        if (isCurrent()) {
          this.onAssistantAuthError(status, location);
        }
      },
      onError: error => {
        if (isCurrent()) {
          this.onAssistantError(error);
        }
      },
      revealParagraph: paragraphId =>
        isCurrent()
          ? this.reveal.reveal(paragraphId)
          : Promise.reject(new DOMException('Notebook changed', 'AbortError')),
      paragraphs,
      onPanelVisibilityChange: this.onPanelVisibilityChange,
      subscribePanelClose: this.subscribePanelClose,
      panelWidth: this.panelWidth,
      onPanelWidthChange: this.onPanelWidthChange
    };
  }

  private onAssistantAuthError(status: number, location: string | null): void {
    this.ticket.handleAuthFailure(status, location);
  }
}
