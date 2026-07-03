import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import type { ReactElement } from 'react';

// Mock the native/heavy leaves ActiveJob pulls in (factories reference no outer vars,
// so they hoist cleanly): the OSRM route map (WebView), background GPS, and the photo
// pickers used only in the deliver flow.
jest.mock('../src/components/RouteMap', () => () => null);
jest.mock('../src/lib/location', () => ({ watchLocation: () => Promise.resolve(() => {}) }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));

import ActiveJob from '../src/components/ActiveJob';
import { ToastProvider } from '../src/components/ui';
import type { DriverDelivery } from '../src/lib/api';
import { render, pressableWithText, press, textOf, unmount } from './helpers/rtr';

// Every ActiveJob render is wrapped so its useToast() finds a real provider (the
// per-action ack channel) instead of the dev no-op fallback.
const withToast = (el: ReactElement) => <ToastProvider>{el}</ToastProvider>;

function assignedJob(overrides: Partial<DriverDelivery> = {}): DriverDelivery {
  return {
    id: 'job-1',
    status: 'assigned',
    pickup: { lat: -17.82, lng: 31.05 },
    dropoff: { lat: -17.83, lng: 31.06 },
    pickup_contact: { name: 'Shop', phone: '+263770000000' },
    dropoff_contact: { name: 'Cust', phone: '+263771111111' },
    fee_minor: 500,
    driver_fee_minor: 400,
    ...overrides,
  } as DriverDelivery;
}

describe('ActiveJob (component)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the 4-step stepper and fires onAction on the lifecycle tap', () => {
    const onAction = jest.fn();
    const r = render(withToast(<ActiveJob job={assignedJob()} token="tok" onAction={onAction} busy={false} />));

    const all = textOf(r.root);
    for (const step of ['Claimed', 'Picked up', 'On the way', 'Delivered']) {
      expect(all).toContain(step);
    }

    press(pressableWithText(r.root, "I've picked up"));
    expect(onAction).toHaveBeenCalledWith('picked_up');
    unmount(r);
  });

  it('F4: shows a pooled-run banner (with the leg position) only when the job is batched', () => {
    const batched = render(
      withToast(
        <ActiveJob job={assignedJob({ batch_id: 'batch-1', batch_sequence: 2 })} token="tok" onAction={jest.fn()} busy={false} />,
      ),
    );
    const text = textOf(batched.root);
    expect(text).toContain('Pooled run');
    expect(text).toContain('stop 2');
    unmount(batched);

    const single = render(withToast(<ActiveJob job={assignedJob()} token="tok" onAction={jest.fn()} busy={false} />));
    expect(textOf(single.root)).not.toContain('Pooled run');
    unmount(single);
  });

  it('#66: a multi-leg run renders the pickup-first route strip (all pickups, then all drops)', () => {
    const legA = assignedJob({ id: 'A', status: 'assigned' });
    const legB = assignedJob({ id: 'B', status: 'assigned' });
    const r = render(withToast(<ActiveJob job={legA} run={[legA, legB]} token="tok" onAction={jest.fn()} busy={false} />));
    const text = textOf(r.root);
    expect(text).toContain('Pooled run');
    expect(text).toContain('2 orders'); // both legs
    expect(text).toContain('4 stops'); // 2 pickups + 2 drops
    expect(text).toContain('Pick up'); // the collection phase
    expect(text).toContain('Deliver'); // the delivery phase
    expect(text).toContain('Now'); // the current stop (pick up A) is flagged
    unmount(r);
  });
});
