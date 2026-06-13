import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { HistoryItem } from '../lib/api';
import { dayLabel, money, placeLabel, podMethodLabel, timeLabel } from '../lib/format';
import { REASON_LABEL, statusMeta } from '../lib/jobs';
import { colors, PILL, shadow } from '../theme';

// The full record of one past run (the Jobs-tab detail). Read-only — proof of what
// happened and what it earned, for the driver's own records and any dispute. Money
// AGGREGATES (balance, cash owed) live in Earnings; this only states this one run.
export default function JobDetail({
  item,
  onClose,
  onOpenEarnings,
}: {
  item: HistoryItem;
  onClose: () => void;
  onOpenEarnings: () => void;
}) {
  const meta = statusMeta(item.status);
  const when = item.delivered_at ?? item.updated_at;
  const codDue = item.collect_minor ?? 0;
  const codCollected = item.cod_collected_minor;
  const pod = item.status === 'delivered' ? podMethodLabel(item.pod_method) : null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Job details</Text>
          <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
            <Feather name="x" size={24} color={colors.textPrimary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.statusRow}>
            <View style={[styles.badge, { borderColor: meta.color }]}>
              <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
            </View>
            {when ? (
              <Text style={styles.when}>
                {dayLabel(when)} · {timeLabel(when)}
              </Text>
            ) : null}
          </View>

          {/* Both legs — the run as it happened. */}
          <View style={styles.card}>
            <Text style={styles.legEyebrow}>Pickup</Text>
            <Text style={styles.legPlace}>{placeLabel(item.pickup)}</Text>
            <View style={styles.legLink}>
              <Feather name="arrow-down" size={14} color={colors.textFaint} />
              {item.trip_km != null ? <Text style={styles.tripText}>{item.trip_km} km</Text> : null}
            </View>
            <Text style={styles.legEyebrow}>Dropoff</Text>
            <Text style={styles.legPlace}>{placeLabel(item.dropoff)}</Text>
          </View>

          {/* What happened + what it earned. */}
          <View style={styles.card}>
            {item.status === 'delivered' ? (
              <Row label="You earned" value={money(item.driver_fee_minor)} strong accent />
            ) : item.status === 'failed' ? (
              <Row
                label="Couldn't complete"
                value={REASON_LABEL[item.failure_reason ?? ''] ?? item.failure_reason ?? '—'}
                danger
              />
            ) : item.status === 'cancelled' ? (
              <Row label="Outcome" value="Cancelled by merchant" />
            ) : null}

            {codDue > 0 || codCollected != null ? (
              <Row
                label="Cash collected"
                value={
                  codCollected != null
                    ? `${money(codCollected)}${codDue > 0 ? ` of ${money(codDue)} due` : ''}`
                    : `${money(codDue)} due`
                }
              />
            ) : null}

            {pod ? <Row label="Handover" value={pod} /> : null}
          </View>

          <Pressable style={styles.earningsLink} onPress={onOpenEarnings}>
            <Text style={styles.earningsLinkText}>Balance & cash owed are in Earnings</Text>
            <Feather name="chevron-right" size={18} color={colors.textFaint} />
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Row({
  label,
  value,
  strong,
  accent,
  danger,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          strong && styles.rowValueStrong,
          accent && styles.rowValueAccent,
          danger && styles.rowValueDanger,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  close: { padding: 4 },

  content: { padding: 20, gap: 16, paddingBottom: 40 },

  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: PILL,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceAlt,
  },
  badgeText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  when: { color: colors.textFaint, fontSize: 14, flexShrink: 1, textAlign: 'right' },

  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, ...shadow.card },
  legEyebrow: {
    color: colors.tabActive,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  legPlace: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', lineHeight: 23, marginTop: 2 },
  legLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 10 },
  tripText: { color: colors.textFaint, fontSize: 13 },

  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  rowLabel: { color: colors.textMuted, fontSize: 15, flexShrink: 0 },
  rowValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  rowValueStrong: { fontSize: 18, fontWeight: '700' },
  rowValueAccent: { color: colors.money },
  rowValueDanger: { color: colors.danger },

  earningsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 12,
  },
  earningsLinkText: { color: colors.textMuted, fontSize: 15 },
});
