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

import type { Page, Response } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../e2e/models/login-page';
import { LoginTestUtil } from '../e2e/models/login-page.util';
import { performLoginIfRequired } from '../e2e/utils';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

const loginPage = (response: Promise<Response>, loginVisible = true, visible = Promise.resolve()) => {
  let url = 'http://example.test/#/login';
  const login = {
    isVisible: vi.fn().mockImplementation(() => Promise.resolve(loginVisible && url.includes('login'))),
    waitFor: vi.fn().mockReturnValue(visible)
  };
  const other = { waitFor: vi.fn().mockResolvedValue(undefined), first: () => other };
  const page = {
    url: () => url,
    locator: (selector: string) => (selector === 'zeppelin-login' ? login : other),
    getByRole: vi.fn(),
    waitForResponse: vi.fn().mockReturnValue(response),
    evaluate: vi.fn().mockImplementation(() => {
      url = 'http://example.test/#/';
      return Promise.resolve();
    }),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    waitForURL: vi.fn().mockRejectedValue(new Error('Not a login route'))
  };
  vi.spyOn(LoginTestUtil, 'isShiroEnabled').mockResolvedValue(true);
  vi.spyOn(LoginTestUtil, 'getTestCredentials').mockResolvedValue({
    test: { username: 'fixture-user', password: 'fixture-password', roles: [] }
  });
  const submit = vi.spyOn(LoginPage.prototype, 'login').mockResolvedValue(undefined);
  return { page, submit, login };
};

const response = (ok: boolean) => ({ ok: () => ok }) as Response;

describe('E2E authentication readiness', () => {
  afterEach(() => vi.restoreAllMocks());

  it('waits for the login response before navigating away from the form', async () => {
    const pending = deferred<Response>();
    const { page, submit } = loginPage(pending.promise);
    const authenticated = performLoginIfRequired(page as unknown as Page);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(page.evaluate).not.toHaveBeenCalled();
    pending.resolve(response(true));
    await expect(authenticated).resolves.toBe(true);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('waits for the form when the login route arrives before its DOM', async () => {
    const ready = deferred<void>();
    const { page, submit, login } = loginPage(Promise.resolve(response(true)), false, ready.promise);
    const authenticated = performLoginIfRequired(page as unknown as Page);
    await vi.waitFor(() => expect(login.waitFor).toHaveBeenCalledTimes(1));
    expect(submit).not.toHaveBeenCalled();
    ready.resolve();
    await expect(authenticated).resolves.toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('leaves the login form in place when authentication is rejected', async () => {
    const { page } = loginPage(Promise.resolve(response(false)));
    await expect(performLoginIfRequired(page as unknown as Page)).resolves.toBe(false);
    expect(page.evaluate).not.toHaveBeenCalled();
  });
});
