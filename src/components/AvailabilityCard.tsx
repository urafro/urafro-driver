import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getSchedule, setSchedule } from '../lib/api';
import { colors, shadow, PILL, FONT } from '../theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// A "day you usually work" maps to a default 06:00–18:00 window. A finer per-day
// time editor can come later; the days are what ops need for planning supply.
const DEFAULT_START = 6 * 60;
const DEFAULT_END = 18 * 60;

/**
 * Availability schedule (ADR-003 P4). Pick the days you usually work; saved as
 * weekly windows. Informational — it doesn't lock you out of going online, it
 * helps ops plan supply.
 */
export default function AvailabilityCard({ token }: { token: string }) {
  const [days, setDays] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await getSchedule(token);
      setDays(new Set(data.map((w) => w.day_of_week)));
    } catch {
      // leave empty if it can't load
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (d: number) => {
    setNote(null);
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  const save = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      await setSchedule(
        token,
        [...days].sort().map((d) => ({ day_of_week: d, start_minute: DEFAULT_START, end_minute: DEFAULT_END })),
      );
      setNote('Saved.');
    } catch {
      setNote('Could not save — try again.');
    } finally {
      setBusy(false);
    }
  }, [token, days]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Availability</Text>
      <Text style={styles.lead}>The days you usually work (helps the team plan — it won&apos;t stop you going online any time).</Text>
      <View style={styles.days}>
        {DAYS.map((label, d) => (
          <Pressable
            key={d}
            style={[styles.day, days.has(d) && styles.dayActive]}
            onPress={() => toggle(d)}
          >
            <Text style={[styles.dayText, days.has(d) && styles.dayTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={[styles.save, busy && styles.busy]} onPress={save} disabled={busy}>
        <Text style={styles.saveText}>{busy ? 'Saving…' : 'Save availability'}</Text>
      </Pressable>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, ...shadow.card },
  title: { color: colors.textPrimary, fontSize: 16, fontFamily: FONT, fontWeight: '700' },
  lead: { color: colors.textMuted, fontSize: 14, fontFamily: FONT, lineHeight: 20, marginTop: 4, marginBottom: 12 },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  day: {
    width: 44,
    height: 44,
    borderRadius: PILL,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  dayActive: { backgroundColor: colors.tabActive, borderColor: colors.tabActive },
  dayText: { color: colors.textMuted, fontSize: 13, fontFamily: FONT, fontWeight: '700' },
  dayTextActive: { color: colors.surface },
  save: { backgroundColor: colors.btnPrimaryBg, borderRadius: PILL, minHeight: 48, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  busy: { opacity: 0.6 },
  saveText: { color: colors.btnPrimaryText, fontSize: 16, fontFamily: FONT, fontWeight: '700' },
  note: { color: colors.textMuted, fontSize: 14, fontFamily: FONT, marginTop: 10, textAlign: 'center' },
});
