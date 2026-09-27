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

import { ChangeDetectorRef, Component, Input, NgZone, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { EMPTY, Subject } from 'rxjs';
import { catchError, finalize, takeUntil } from 'rxjs/operators';

import { Note, OP, type AssistantContext, type AssistantSocket } from '@zeppelin/sdk';
import { BaseUrlService, MessageService, ReactFeatureService, TicketService } from '@zeppelin/services';
import { AssistantParagraphService } from '../../../../services/assistant-paragraph.service';
import { AssistantReveal, RevealOptions, RevealResult } from './assistant-reveal';
import { AssistantSlots } from './assistant-slots';

@Component({
  selector: 'zeppelin-assistant-host',
  template: `
    @if (useAssistantPanel) {
      @if (assistantPanelFailed) {
        <p role="alert">Unable to load the assistant.</p>
      } @else {
        <div
          zeppelin-react-mount="./AssistantWorkspace"
          [reactProps]="assistantProps"
          [reactRethrowCallbackErrors]="true"
        ></div>
      }
    }
  `,
  standalone: false
})
export class AssistantHostComponent implements OnInit, OnDestroy {
  /** Paragraph the user last selected; the notebook passes its selection in. */
  @Input() activeParagraphId: string | null = null;
  useAssistantPanel = false;
  assistantPanelFailed = false;
  private currentNote!: Exclude<Note['note'], undefined>;
  private destroy$ = new Subject<void>();
  private lastAssistantProps: Record<string, unknown> | null = null;

  private assistantGeneration = 0;
  private logoutInProgress = false;
  private destroyed = false;

  constructor(
    private activatedRoute: ActivatedRoute,
    private reactFeature: ReactFeatureService,
    private cdr: ChangeDetectorRef,
    private baseUrl: BaseUrlService,
    private ticket: TicketService,
    private ngZone: NgZone,
    private slots: AssistantSlots,
    private paragraphs: AssistantParagraphService,
    private reveal: AssistantReveal,
    private messages: MessageService
  ) {}

  get note(): Exclude<Note['note'], undefined> {
    return this.currentNote;
  }
  get assistantProps(): Record<string, unknown> {
    if (!this.lastAssistantProps) {
      const generation = this.assistantGeneration;
      const noteId = this.note.id;
      const assertCurrent = () => {
        if (generation !== this.assistantGeneration) {
          throw new DOMException('Notebook changed', 'AbortError');
        }
      };
      this.lastAssistantProps = {
        noteId,
        // The remote calls the conversation REST API itself; auth failures come back through onAuthError.
        apiBase: this.baseUrl.getRestApiBase(),
        socket: this.assistantSocket,
        slots: this.slots.slots.value,
        draftOwner: this.ticket.ticket?.principal,
        getContext: (paragraphId?: string): AssistantContext => {
          assertCurrent();
          const paragraph = paragraphId ? this.note.paragraphs.find(p => p.id === paragraphId) : undefined;
          if (paragraphId && !paragraph) throw new Error('Target paragraph no longer exists.');
          if (paragraph?.status === 'RUNNING' || paragraph?.status === 'PENDING')
            throw new Error('Wait for the paragraph to finish running.');
          return {
            noteId,
            target: paragraph
              ? { kind: 'paragraph', paragraphId: paragraph.id }
              : { kind: 'insert', afterParagraphId: this.note.paragraphs[this.note.paragraphs.length - 1]?.id ?? null },
            originalText: paragraph?.text
          };
        },
        onApplyProposal: (context: AssistantContext, code: string) => {
          assertCurrent();
          return this.paragraphs.apply(context, code, () => {
            assertCurrent();
            return this.note;
          });
        },
        onAuthError: (status: number, location: string | null) => {
          if (generation === this.assistantGeneration) {
            this.onAssistantAuthError(status, location);
          }
        },
        onError: (error: unknown) => {
          if (generation === this.assistantGeneration) {
            this.onAssistantError(error);
          }
        },
        revealParagraph: (paragraphId: string, options: RevealOptions): Promise<RevealResult> => {
          assertCurrent();
          return this.reveal.reveal(paragraphId, options);
        },
        getActiveParagraphId: this.getActiveParagraphId,
        onPanelVisibilityChange: this.onPanelVisibilityChange,
        subscribePanelClose: this.subscribePanelClose
      };
    }
    return this.lastAssistantProps;
  }

  @Input() set note(note: Exclude<Note['note'], undefined>) {
    if (this.currentNote?.id !== note?.id) {
      this.invalidateAssistant();
      this.assistantPanelFailed = false;
    }
    this.currentNote = note;
  }

  // Sending and run events share the notebook WebSocket, which Angular owns.
  readonly assistantSocket: AssistantSocket = {
    send: message => {
      if (message.noteId !== this.note?.id) {
        throw new DOMException('Notebook changed', 'AbortError');
      }
      this.messages.send<OP.ASSISTANT_SEND_MESSAGE>(OP.ASSISTANT_SEND_MESSAGE, message);
    },
    subscribe: listener => {
      const subscription = this.messages.receive(OP.ASSISTANT_EVENT).subscribe(listener);
      return () => subscription.unsubscribe();
    }
  };

  readonly getActiveParagraphId = (): string | undefined => this.activeParagraphId ?? undefined;

  // Stable across prop rebuilds so the React panel does not re-report its visibility.
  readonly onPanelVisibilityChange = (visible: boolean): void => {
    this.ngZone.run(() => this.slots.setPanelOpen(visible));
  };

  readonly subscribePanelClose = (listener: () => void): (() => void) => {
    const subscription = this.slots.panelCloseRequests.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  readonly onAssistantError = (error: unknown): void => {
    this.ngZone.run(() => {
      console.error('React assistant panel error', error);
      this.assistantPanelFailed = true;
      this.cdr.markForCheck();
    });
  };

  ngOnInit(): void {
    this.slots.slots.pipe(takeUntil(this.destroy$)).subscribe(() => {
      // Slots are registered during child view checks; publish once that pass finishes.
      queueMicrotask(() => {
        if (this.destroyed) return;
        this.lastAssistantProps = null;
        this.cdr.markForCheck();
      });
    });
    this.activatedRoute.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const enabled = this.reactFeature.isEnabled('assistantPanel', params);
      if (this.useAssistantPanel && !enabled) this.invalidateAssistant();
      this.useAssistantPanel = enabled;

      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.invalidateAssistant();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private invalidateAssistant(): void {
    this.assistantGeneration++;
    this.lastAssistantProps = null;
  }

  private onAssistantAuthError(status: number, location: string | null): void {
    this.ngZone.run(() => {
      if (status === 401 && location !== null) {
        window.location.href = location;
      } else if (status === 405 && !this.logoutInProgress) {
        this.logoutInProgress = true;
        this.ticket
          .logout()
          .pipe(
            catchError(() => EMPTY),
            finalize(() => {
              this.logoutInProgress = false;
            })
          )
          .subscribe();
      }
    });
  }
}
