import TestRenderer, { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { ReactElement } from 'react';

// Minimal react-test-renderer helpers for the driver component tests. We render with
// react-test-renderer directly (not @testing-library/react-native — its v14 renderer
// peer doesn't resolve on this RN 0.85 / React 19 stack) under jest-expo, which supplies
// the RN transform + Expo native mocks.

/** Render an element inside act() and return the renderer. */
export function render(element: ReactElement): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(element);
  });
  return r;
}

/** Concatenate the string text under an instance (walks Text children). */
export function textOf(instance: ReactTestInstance): string {
  const parts: string[] = [];
  const walk = (node: ReactTestInstance | string): void => {
    if (typeof node === 'string') {
      parts.push(node);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(instance);
  return parts.join('');
}

/** The first pressable (any node with an `onPress` handler) whose rendered text
 *  contains `substring`. We match on the `onPress` prop rather than the Pressable
 *  type — jest-expo's RN mock renders Pressable without a Pressable-typed instance,
 *  so findAllByType(Pressable) returns nothing. Throws if none matches. */
export function pressableWithText(root: ReactTestInstance, substring: string): ReactTestInstance {
  const match = root
    .findAll((n) => typeof (n.props as { onPress?: unknown }).onPress === 'function')
    .find((b) => textOf(b).includes(substring));
  if (!match) throw new Error(`no pressable containing "${substring}"`);
  return match;
}

/** Fire a Pressable's onPress inside act(). */
export function press(instance: ReactTestInstance): void {
  act(() => {
    (instance.props as { onPress: () => void }).onPress();
  });
}

/** Fire a Pressable's onPress TWICE inside one act() — a real double tap, where both
 *  presses land before React has re-rendered with the first one's state. The `disabled`
 *  prop and any state check are useless against this, so it is the only way to test a
 *  synchronous re-entry guard (see CourierMessages: a fumbled tap must not text a
 *  customer twice). */
export function doublePress(instance: ReactTestInstance): void {
  act(() => {
    const { onPress } = instance.props as { onPress: () => void };
    onPress();
    onPress();
  });
}

/** Let pending promises settle (a mocked fetch/API call) and re-render, inside act().
 *  Two awaits: one for the mock's own resolution, one for the state update it queues. */
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Unmount inside act() (runs effect cleanups — clears the offer countdown interval). */
export function unmount(r: ReactTestRenderer): void {
  act(() => {
    r.unmount();
  });
}
