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
import { Router } from '@angular/router';
import { EMPTY } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ReactFeatureService, ThemeService, TicketService } from '@zeppelin/services';
import { ReactRemoteLoaderService } from './share/react-mount/react-remote-loader.service';
import { AppComponent } from './app.component';

vi.mock('monaco-editor', () => ({}));

describe('AppComponent assistant preload', () => {
  const setup = (enabled: boolean, fails = false) => {
    const loadModule = vi.fn(() => (fails ? Promise.reject(new Error('offline')) : Promise.resolve({})));
    const updateMonacoTheme = vi.fn();
    const app = new AppComponent(
      { events: EMPTY } as unknown as Router,
      { logout$: EMPTY } as unknown as TicketService,
      { updateMonacoTheme } as unknown as ThemeService,
      { isEnabled: () => enabled } as unknown as ReactFeatureService,
      { loadModule } as unknown as ReactRemoteLoaderService
    );
    return { app, loadModule, updateMonacoTheme };
  };

  it('starts loading the assistant before the notebook mounts when opted in', () => {
    const { app, loadModule } = setup(true);
    app.ngOnInit();
    expect(loadModule).toHaveBeenCalledWith('./AssistantWorkspace');
  });

  it('does not download the assistant when disabled', () => {
    const { app, loadModule } = setup(false);
    app.ngOnInit();
    expect(loadModule).not.toHaveBeenCalled();
  });

  it('does not block shell initialization on a speculative load failure', async () => {
    const { app, updateMonacoTheme } = setup(true, true);
    app.ngOnInit();
    await Promise.resolve();
    expect(updateMonacoTheme).toHaveBeenCalledOnce();
  });
});
