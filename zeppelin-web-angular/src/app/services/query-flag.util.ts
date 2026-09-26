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

/** Returns the boolean value of a query flag, or null when it is unset/invalid. */
export const parseBooleanFlag = (value: string | null | undefined): boolean | null => {
  if (value === '' || value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return null;
};

export type FlagLocation = Pick<Location, 'search' | 'hash'>;

/**
 * Reads a boolean flag from the real query string (`/?flag#/route`) and the hash-route
 * query (`#/route?flag`). `true` in either place wins; otherwise `false`, else null.
 */
export const readLocationFlag = (name: string, location: FlagLocation = window.location): boolean | null => {
  try {
    const values = [
      parseBooleanFlag(new URLSearchParams(location.search).get(name)),
      parseBooleanFlag(new URLSearchParams(location.hash.split('?')[1] ?? '').get(name))
    ];
    if (values.includes(true)) {
      return true;
    }
    return values.includes(false) ? false : null;
  } catch {
    return null;
  }
};
