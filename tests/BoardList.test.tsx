import { describe, it, expect } from '@jest/globals';
import BoardList from '../src/components/BoardList';
import type { BoardJob } from '../src/lib/api';
import { render, unmount, textOf } from './helpers/rtr';

// H2 · the "Available" open-board browse view. Coarse cards (fee / distance / COD),
// plus loading + empty states. Read-only for now (grab is a separate money-path slice).

function job(overrides: Partial<BoardJob> = {}): BoardJob {
  return { delivery_id: 'del-1', pickup_distance_km: 1.2, driver_fee_minor: 400, cod: false, ...overrides };
}

describe('BoardList (component)', () => {
  it('renders a coarse card with the fee and distance', () => {
    const r = render(<BoardList board={[job()]} />);
    const text = textOf(r.root);
    expect(text.includes('1.2 km to pickup')).toBe(true);
    expect(text.includes('$4.00')).toBe(true);
    unmount(r);
  });

  it('shows a cash chip only for a COD job', () => {
    const cod = render(<BoardList board={[job({ cod: true })]} />);
    expect(textOf(cod.root).includes('Cash job')).toBe(true);
    unmount(cod);
    const prepaid = render(<BoardList board={[job({ cod: false })]} />);
    expect(textOf(prepaid.root).includes('Cash job')).toBe(false);
    unmount(prepaid);
  });

  it('shows the loading state for a null board', () => {
    const r = render(<BoardList board={null} />);
    expect(textOf(r.root).includes('Loading the board')).toBe(true);
    unmount(r);
  });

  it('shows the empty state for an empty board', () => {
    const r = render(<BoardList board={[]} />);
    expect(textOf(r.root).includes('No open jobs')).toBe(true);
    unmount(r);
  });
});
