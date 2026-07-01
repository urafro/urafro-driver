import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock the native/heavy leaves ActiveJob pulls in (factories reference no outer vars,
// so they hoist cleanly): the OSRM route map (WebView), background GPS, and the photo
// pickers used only in the deliver flow.
jest.mock('../src/components/RouteMap', () => () => null);
jest.mock('../src/lib/location', () => ({ watchLocation: () => Promise.resolve(() => {}) }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));

import ActiveJob from '../src/components/ActiveJob';
import type { DriverDelivery } from '../src/lib/api';
import { render, pressableWithText, press, textOf, unmount } from './helpers/rtr';

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

  it('renders the 4-segment stepper and fires onAction on the lifecycle tap', () => {
    const onAction = jest.fn();
    const r = render(<ActiveJob job={assignedJob()} token="tok" onAction={onAction} busy={false} />);

    const all = textOf(r.root);
    for (const step of ['Claimed', 'Picked up', 'On the way', 'Delivered']) {
      expect(all).toContain(step);
    }

    press(pressableWithText(r.root, "I've picked up"));
    expect(onAction).toHaveBeenCalledWith('picked_up');
    unmount(r);
  });
});
