import { describe, it, expect, jest } from '@jest/globals';
import BoardList from '../src/components/BoardList';
import type { BoardJob } from '../src/lib/api';
import { render, pressableWithText, press, unmount, textOf } from './helpers/rtr';

// H2 + #170 · the "Available" open-board. Coarse cards (fee / distance / COD) + a Grab
// button that fires onGrab, plus loading + empty states.

function job(overrides: Partial<BoardJob> = {}): BoardJob {
  return { delivery_id: 'del-1', pickup_distance_km: 1.2, driver_fee_minor: 400, cod: false, ...overrides };
}
const noop = () => {};

describe('BoardList (component)', () => {
  it('renders a coarse card with the fee and distance', () => {
    const r = render(<BoardList board={[job()]} onGrab={noop} grabbingId={null} />);
    const text = textOf(r.root);
    expect(text.includes('1.2 km to pickup')).toBe(true);
    expect(text.includes('$4.00')).toBe(true);
    unmount(r);
  });

  it('Grab fires onGrab with the delivery id', () => {
    const onGrab = jest.fn();
    const r = render(<BoardList board={[job()]} onGrab={onGrab} grabbingId={null} />);
    press(pressableWithText(r.root, 'Grab'));
    expect(onGrab).toHaveBeenCalledWith('del-1');
    unmount(r);
  });

  it('shows a cash chip only for a COD job', () => {
    const cod = render(<BoardList board={[job({ cod: true })]} onGrab={noop} grabbingId={null} />);
    expect(textOf(cod.root).includes('Cash job')).toBe(true);
    unmount(cod);
    const prepaid = render(<BoardList board={[job({ cod: false })]} onGrab={noop} grabbingId={null} />);
    expect(textOf(prepaid.root).includes('Cash job')).toBe(false);
    unmount(prepaid);
  });

  it('shows the loading state for a null board', () => {
    const r = render(<BoardList board={null} onGrab={noop} grabbingId={null} />);
    expect(textOf(r.root).includes('Loading the board')).toBe(true);
    unmount(r);
  });

  it('shows the empty state for an empty board', () => {
    const r = render(<BoardList board={[]} onGrab={noop} grabbingId={null} />);
    expect(textOf(r.root).includes('No open jobs')).toBe(true);
    unmount(r);
  });
});
