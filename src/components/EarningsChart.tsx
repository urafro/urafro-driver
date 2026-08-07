import { Pressable, StyleSheet, View } from 'react-native';
import type { EarningsHistory } from '../lib/api';
import { money, weekdayTag } from '../lib/format';
import { colors, radius, shadow, space, typography } from '../theme';
import { Skeleton, Text } from './ui';

// The driver's daily-earnings chart, drawn from GET /driver/earnings/history.
//
// These bars were hardcoded sample data badged SAMPLE for most of the app's life
// (#50/#68) because no history endpoint existed. They are real ledger money now, so
// the badge and the invented numbers are gone — and the three states a real read has
// are handled honestly instead:
//   • loading  — skeleton bars (structure, not a spinner: the 3G-market default)
//   • loaded   — the bars, plus a reassuring note when the week is genuinely empty
//                (a new driver with no history is NOT an error)
//   • failed   — the card says so and offers a retry; the caller's live balance is a
//                separate read and stays on screen
// A fourth case hides inside "loaded": a DOCKED day, where a correction outran that
// day's credits. It has no positive height to draw, so it would otherwise be pixel-
// identical to a day off. It is marked instead (red stub + minus + legend + a signed
// total) — on a money screen, "you were charged" must never read as "you rested".
// Presentational only (BoardList's convention): the caller owns the fetch.

/** Days requested and charted. Lives next to the heading it labels so the two
 *  cannot drift; the server clamps whatever it is sent to 1..31 anyway. */
export const EARNINGS_HISTORY_DAYS = 7;

const BAR_MAX_H = 96; // the tallest bar; the rest scale against the week's peak
const BAR_MIN_H = 6; // a day with no work is still a visible baseline stub
// An uneven silhouette, so the placeholder reads as a chart rather than a block.
const SKELETON_BARS = [34, 58, 22, 70, 44, 62, 30];

export type EarningsChartProps = {
  /** The loaded window, or null while it is still in flight (or after a failure). */
  history: EarningsHistory | null;
  /** True when the last attempt failed — only meaningful while `history` is null. */
  failed: boolean;
  onRetry: () => void;
};

export default function EarningsChart({ history, failed, onRetry }: EarningsChartProps) {
  const days = history?.days ?? [];
  // A negative day (a correction outrunning that day's credits) has no height to
  // draw, so it never sets the scale — it gets its own DOCKED treatment below.
  const chartMax = Math.max(1, ...days.map((d) => Math.max(0, d.earned_minor)));
  // "Nothing yet" vs "a quiet week": both draw flat bars, but only the former earns
  // the reassuring note.
  const worked = days.some((d) => d.earned_minor !== 0 || d.deliveries > 0);
  // Any money taken back this week? Drives the legend that explains the red stubs —
  // colour alone must not be what tells a driver they were docked.
  const anyDocked = days.some((d) => d.earned_minor < 0);
  const totalDocked = (history?.total_minor ?? 0) < 0;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.label}>Last {EARNINGS_HISTORY_DAYS} days</Text>
        {history && worked ? (
          // A negative window total drops the gold money colour: a red "-$2.50" is the
          // only honest way to head a week that went backwards.
          <Text style={[styles.total, totalDocked && styles.totalDocked]}>
            {money(history.total_minor)}
          </Text>
        ) : null}
      </View>

      {history == null && failed ? (
        <>
          <Text style={styles.error}>
            Could not load your daily earnings. Your balance above is up to date.
          </Text>
          <Pressable style={styles.retry} onPress={onRetry} accessibilityRole="button">
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </>
      ) : history == null ? (
        <View
          style={styles.chart}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading your daily earnings"
        >
          {SKELETON_BARS.map((h, i) => (
            <View key={i} style={styles.barCol}>
              <Skeleton height={h} rounded={6} />
              <Skeleton width={16} height={12} />
            </View>
          ))}
        </View>
      ) : (
        <>
          <View style={styles.chart}>
            {days.map((d, i) => {
              const today = i === days.length - 1; // the contract returns oldest first
              // A day the ledger took money BACK from. It clamps to no height like an
              // empty day, so it must not also LOOK like one: an empty day is "you
              // didn't work", a docked day is "you were charged". Marked instead —
              // a red stub, a minus above it, a red tag, and the legend under the
              // chart — so it can't be read as a quiet day.
              const docked = d.earned_minor < 0;
              const value = Math.max(0, d.earned_minor);
              return (
                <View
                  key={d.date}
                  style={styles.barCol}
                  accessible
                  accessibilityLabel={`${d.date}: ${money(d.earned_minor)}${
                    docked ? ', taken off your earnings' : ''
                  }, ${d.deliveries} ${d.deliveries === 1 ? 'delivery' : 'deliveries'}`}
                >
                  {docked ? <Text style={styles.dockedMark}>−</Text> : null}
                  <View
                    style={[
                      styles.bar,
                      { height: Math.max(BAR_MIN_H, (value / chartMax) * BAR_MAX_H) },
                      docked
                        ? styles.barDocked
                        : value === 0
                          ? styles.barEmpty
                          : today
                            ? styles.barToday
                            : styles.barOther,
                    ]}
                  />
                  <Text
                    style={[
                      styles.barDay,
                      today && styles.barDayToday,
                      docked && styles.barDayDocked,
                    ]}
                  >
                    {weekdayTag(d.date)}
                  </Text>
                </View>
              );
            })}
          </View>
          {anyDocked ? (
            <Text style={styles.dockedNote}>
              A red day is money taken back off your earnings, not a day you did not work.
              Ask ops if a correction looks wrong.
            </Text>
          ) : null}
          {worked ? null : (
            <Text style={styles.note}>
              No earnings yet this week. Your first completed delivery shows up here.
            </Text>
          )}
        </>
      )}
    </View>
  );
}

// Text styles from the shared type scale (typography.*); spacing/radii from tokens.
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.lg,
    marginTop: space.lg,
    ...shadow.card,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  label: { ...typography.subheading, fontWeight: '700', color: colors.textPrimary },
  total: { ...typography.subheading, fontWeight: '700', color: colors.money },
  totalDocked: { color: colors.danger },

  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, height: 120, marginTop: space.lg },
  barCol: { flex: 1, alignItems: 'center', gap: space.xs },
  bar: { width: '100%', borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  barToday: { backgroundColor: colors.tabActive },
  barOther: { backgroundColor: colors.btnPrimaryBg },
  // A day with nothing earned: a faint baseline stub, not a tiny gold sliver that
  // would read as a small amount of money.
  barEmpty: { backgroundColor: colors.hairline },
  // A day the ledger took money back: the same stub height as an empty day (there is
  // no positive amount to draw) but unmistakably NOT the same thing.
  barDocked: { backgroundColor: colors.danger },
  barDay: { ...typography.caption, fontSize: 11, lineHeight: 14, color: colors.textFaint },
  barDayToday: { color: colors.tabActive, fontWeight: '700' },
  barDayDocked: { color: colors.danger, fontWeight: '700' },
  dockedMark: { ...typography.micro, color: colors.danger },

  note: { ...typography.caption, color: colors.textFaint, marginTop: space.md },
  dockedNote: { ...typography.caption, color: colors.danger, marginTop: space.md },
  error: { ...typography.callout, color: colors.textMuted, marginTop: space.md },
  retry: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    marginTop: space.md,
  },
  retryText: { ...typography.body, fontWeight: '700', color: colors.textMuted },
});
