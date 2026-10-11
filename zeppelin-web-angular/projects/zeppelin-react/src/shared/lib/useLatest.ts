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

import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * The latest value for code that runs after a render, such as event handlers and observers. It is updated once the
 * render commits, never during it, so a render React throws away cannot leave its value behind.
 */
export const useLatest = <T>(value: T) => {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
};

/** A callback whose identity never changes but always runs the latest `callback`, for memoized children. */
export const useStableCallback = <Args extends unknown[], Result>(callback: (...args: Args) => Result) => {
  const latest = useLatest(callback);
  return useCallback((...args: Args) => latest.current(...args), [latest]);
};
