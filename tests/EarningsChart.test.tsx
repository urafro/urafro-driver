import { describe, it, expect, jest } from '@jest/globals';
import EarningsChart from '../src/components/EarningsChart';
import type { EarningsHistory } from '../src/lib/api';
import { render, pressableWithText, press, unmount, textOf } from './helpers/rtr';

// #50/#68 · the weekly earnings chart. These bars used to be hardcoded SAMPLE data;
// they now come from GET /driver/earnings/history, so what matters is that each of
// the three REAL states reads honestly — loading, empty (a new driver, not an error),
// and failed (say so, keep a way back, never imply the balance above is wrong).

function history(
  days: EarningsHistory['days'],
  totalMinor = days.reduce((s, d) => s + d.earned_minor, 0),
): EarningsHistory {
  return { days, total_minor: totalMinor, currency: 'USD' };
}

// 2026-06-08 is a Monday, so a full week runs M → Su.
const WEEK = ['08', '09', '10', '11', '12', '13', '14'].map((d) => ({
  date: `2026-06-${d}`,
  earned_minor: 0,
  deliveries: 0,
}));

const noop = () => {};

describe('EarningsChart (component)', () => {
  it('shows a loading placeholder, and no money, before the window arrives', () => {
    const r = render(<EarningsChart history={null} failed={false} onRetry={noop} />);
    const text = textOf(r.root);
    expect(text.includes('Last 7 days')).toBe(true);
    expect(text.includes('$')).toBe(false); // never a figure the server hasn't sent
    expect(text.includes('Could not load')).toBe(false);
    unmount(r);
  });

  it('draws a bar per day, labelled by weekday, with the window total', () => {
    const week = WEEK.map((d, i) =>
      i === 6 ? { ...d, earned_minor: 1_600, deliveries: 2 } : { ...d, earned_minor: 400, deliveries: 1 },
    );
    const r = render(<EarningsChart history={history(week)} failed={false} onRetry={noop} />);
    const text = textOf(r.root);
    expect(text).toContain('MTuWThFSaSu'); // one tag per day, oldest first
    expect(text).toContain('$40.00'); // 6 × $4.00 + $16.00
    expect(text.includes('No earnings yet this week')).toBe(false);
    unmount(r);
  });

  it('a driver with no history gets a flat week and reassurance, not an error', () => {
    const r = render(<EarningsChart history={history(WEEK)} failed={false} onRetry={noop} />);
    const text = textOf(r.root);
    expect(text).toContain('No earnings yet this week');
    expect(text.includes('Could not load')).toBe(false);
    // No total on an empty week — "$0.00" beside the heading reads like a bad month.
    expect(text.includes('$')).toBe(false);
    unmount(r);
  });

  it('a failed load says so, offers a retry, and does not disown the balance above', () => {
    const onRetry = jest.fn();
    const r = render(<EarningsChart history={null} failed onRetry={onRetry} />);
    const text = textOf(r.root);
    expect(text).toContain('Could not load your daily earnings');
    expect(text).toContain('Your balance above is up to date');
    press(pressableWithText(r.root, 'Try again'));
    expect(onRetry).toHaveBeenCalled();
    unmount(r);
  });

  it('marks a docked day instead of letting it pass for a day off', () => {
    // A correction outrunning that day's credits. The bar clamps to the same stub
    // height as an empty day, so the SAY-SO has to come from somewhere else: the
    // minus mark, the legend, and a signed total.
    const week = WEEK.map((d, i) => (i === 3 ? { ...d, earned_minor: -250, deliveries: 0 } : d));
    const r = render(<EarningsChart history={history(week, -250)} failed={false} onRetry={noop} />);
    const text = textOf(r.root);
    // The week still draws, with the minus mark sitting in the docked (Thursday)
    // column — the flattened text interleaves it exactly where the bar is.
    expect(text).toContain('MTuW−ThFSaSu');
    expect(text).toContain('money taken back off your earnings');
    expect(text).toContain('-$2.50'); // signed total, not "$-2.50" and not "$2.50"
    // A week with a correction is not an empty week.
    expect(text.includes('No earnings yet this week')).toBe(false);
    unmount(r);
  });

  it('leaves an ordinary week unmarked', () => {
    const week = WEEK.map((d) => ({ ...d, earned_minor: 400, deliveries: 1 }));
    const r = render(<EarningsChart history={history(week)} failed={false} onRetry={noop} />);
    const text = textOf(r.root);
    expect(text.includes('−')).toBe(false);
    expect(text.includes('money taken back off your earnings')).toBe(false);
    unmount(r);
  });
});
