import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { ReactElement } from 'react';

// The API client is the only thing this surface talks to, so the ONE call it makes is
// mocked and the rest of the module is kept real — the component branches on
// `e instanceof ApiError` to tell a finished job (409) from a dead network, so a
// hand-rolled stand-in class would quietly send that branch down the wrong path.
jest.mock('../src/lib/api', () => ({
  ...jest.requireActual<typeof import('../src/lib/api')>('../src/lib/api'),
  sendCourierMessage: jest.fn(),
}));

import CourierMessages from '../src/components/CourierMessages';
import { ToastProvider } from '../src/components/ui';
import { ApiError, sendCourierMessage } from '../src/lib/api';
import { render, pressableWithText, press, doublePress, flush, textOf, unmount } from './helpers/rtr';

// D6 (2026-08-08) · the courier→recipient coordination card. What matters here is not
// the layout but the four honesty rules the founder's decision turns on: one tap sends
// once, a double tap does NOT text the customer twice, a failure says so out loud, and
// the RECIPIENT_SMS_ENABLED-off case degrades instead of faking a send.

const send = jest.mocked(sendCourierMessage);

// Every render needs a real ToastProvider so the ack/error haptic channel resolves
// (useToast() falls back to no-ops, but then the toast text never renders).
const withToast = (el: ReactElement) => <ToastProvider>{el}</ToastProvider>;

function renderCard(opts: { collectMinor?: number; phone?: string } = {}) {
  return render(
    withToast(
      <CourierMessages
        jobId="job-1"
        token="tok"
        collectMinor={opts.collectMinor ?? 0}
        phone={opts.phone ?? '+263771111111'}
      />,
    ),
  );
}

describe('CourierMessages (component)', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('sends the tapped template once and confirms it in place', async () => {
    send.mockResolvedValue({ sent: true });
    const r = renderCard();

    const btn = pressableWithText(r.root, 'Arriving now');
    press(btn);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('tok', 'job-1', 'arriving');

    await flush();
    const text = textOf(r.root);
    expect(text).toContain('Sent: Arriving now');
    expect(text).toContain('Text sent to the customer'); // the toast ack
    unmount(r);
  });

  it('a sent template is locked, so tapping it again texts nobody', async () => {
    send.mockResolvedValue({ sent: true });
    const r = renderCard();
    press(pressableWithText(r.root, 'Running late'));
    await flush();

    const sentChip = pressableWithText(r.root, 'Running late');
    expect(sentChip.props.disabled).toBe(true);
    // Fire the handler anyway (a disabled Pressable still carries onPress) — the guard,
    // not the prop, is what has to hold.
    press(sentChip);
    expect(send).toHaveBeenCalledTimes(1);
    unmount(r);
  });

  it('a double tap sends exactly one text', async () => {
    send.mockResolvedValue({ sent: true });
    const r = renderCard();

    doublePress(pressableWithText(r.root, 'Arriving now'));
    expect(send).toHaveBeenCalledTimes(1);

    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    unmount(r);
  });

  it('hides the COD reminder when there is nothing to collect, and prices it when there is', async () => {
    send.mockResolvedValue({ sent: true });

    const prepaid = renderCard({ collectMinor: 0 });
    expect(textOf(prepaid.root)).not.toContain('cash ready');
    unmount(prepaid);

    const cod = renderCard({ collectMinor: 350 });
    expect(textOf(cod.root)).toContain('Have $3.50 cash ready');
    press(pressableWithText(cod.root, 'Have $3.50 cash ready'));
    expect(send).toHaveBeenCalledWith('tok', 'job-1', 'cod_reminder');
    await flush();
    unmount(cod);
  });

  it('says plainly when a send fails, and leaves the template tappable again', async () => {
    send.mockRejectedValue(new Error('network request failed'));
    const r = renderCard();

    press(pressableWithText(r.root, 'Arriving now'));
    await flush();

    const text = textOf(r.root);
    expect(text).toContain('did not send');
    expect(text).toContain('Check your signal');
    expect(text).not.toContain('Sent: Arriving now');

    const retry = pressableWithText(r.root, 'Arriving now');
    expect(retry.props.disabled).toBe(false);
    send.mockResolvedValue({ sent: true });
    press(retry);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(textOf(r.root)).toContain('Sent: Arriving now');
    unmount(r);
  });

  it('a finished job is named as such rather than blamed on the signal', async () => {
    send.mockRejectedValue(new ApiError(409, '409 conflict'));
    const r = renderCard();
    press(pressableWithText(r.root, 'Arriving now'));
    await flush();
    expect(textOf(r.root)).toContain('already finished');
    unmount(r);
  });

  it('degrades honestly when recipient SMS is switched off, keeping the WhatsApp fallback', async () => {
    // 200 with sent:false — the call worked and the customer was told NOTHING.
    send.mockResolvedValue({ sent: false, reason: 'disabled' });
    const r = renderCard();

    press(pressableWithText(r.root, 'Arriving now'));
    await flush();

    const text = textOf(r.root);
    expect(text).toContain('switched off right now, so nothing was sent');
    expect(text).not.toContain('Sent: Arriving now');
    expect(text).not.toContain('Running late'); // the dead templates come off the screen
    expect(text).toContain("I'm outside"); // the WhatsApp fallback stays
    unmount(r);
  });

  it('offers the WhatsApp fallback only when the customer has a number', () => {
    const withPhone = renderCard();
    expect(textOf(withPhone.root)).toContain('WhatsApp');
    unmount(withPhone);

    const without = render(
      withToast(<CourierMessages jobId="job-1" token="tok" collectMinor={0} />),
    );
    const text = textOf(without.root);
    expect(text).not.toContain('WhatsApp');
    expect(text).toContain('Arriving now'); // the platform templates still work
    unmount(without);
  });
});
