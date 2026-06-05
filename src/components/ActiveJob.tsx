import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Delivery } from '../lib/api';
import { money, placeLabel } from '../lib/format';

export type LifecycleAction = 'picked_up' | 'in_transit' | 'delivered' | 'failed';

// The actions available from each status (mirrors the platform state machine).
const ACTIONS: Record<string, { label: string; to: LifecycleAction; danger?: boolean }[]> = {
  assigned: [
    { label: "I've picked up", to: 'picked_up' },
    { label: "Can't complete", to: 'failed', danger: true },
  ],
  picked_up: [
    { label: 'On my way', to: 'in_transit' },
    { label: 'Delivered', to: 'delivered' },
  ],
  in_transit: [{ label: 'Delivered', to: 'delivered' }],
};

const STATUS_LABEL: Record<string, string> = {
  assigned: 'Assigned',
  picked_up: 'Picked up',
  in_transit: 'In transit',
  delivered: 'Delivered',
  failed: 'Failed',
};

// The driver's current job: where to go, and the next step(s) in the delivery.
export default function ActiveJob({
  job,
  onAction,
  busy,
}: {
  job: Delivery;
  onAction: (to: LifecycleAction) => void;
  busy: boolean;
}) {
  const status = job.status ?? 'assigned';
  const actions = ACTIONS[status] ?? [];

  return (
    <View style={styles.container}>
      <Text style={styles.badge}>{STATUS_LABEL[status] ?? status}</Text>

      <Text style={styles.heading}>Deliver to</Text>
      <Text style={styles.place}>{placeLabel(job.dropoff)}</Text>

      <Text style={styles.heading}>Pickup</Text>
      <Text style={styles.place}>{placeLabel(job.pickup)}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>Fee {money(job.fee_minor)}</Text>
        {job.collect_minor ? (
          <Text style={styles.collect}>Collect {money(job.collect_minor)} cash</Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        {actions.map((a) => (
          <Pressable
            key={a.to}
            style={[styles.btn, a.danger ? styles.danger : styles.primary, busy && styles.busy]}
            onPress={() => onAction(a.to)}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color={a.danger ? '#fca5a5' : '#0f172a'} />
            ) : (
              <Text style={[styles.btnText, a.danger && styles.dangerText]}>{a.label}</Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#1e293b', borderRadius: 14, padding: 20 },
  badge: {
    alignSelf: 'flex-start',
    color: '#0f172a',
    backgroundColor: '#22d3ee',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  heading: { color: '#64748b', fontSize: 13, marginTop: 18, textTransform: 'uppercase' },
  place: { color: '#fff', fontSize: 18, marginTop: 4 },
  metaRow: { flexDirection: 'row', gap: 16, marginTop: 18 },
  meta: { color: '#22d3ee', fontSize: 15, fontWeight: '600' },
  collect: { color: '#fbbf24', fontSize: 15, fontWeight: '600' },
  actions: { gap: 10, marginTop: 24 },
  btn: { borderRadius: 10, paddingVertical: 15, alignItems: 'center' },
  primary: { backgroundColor: '#22c55e' },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#7f1d1d' },
  busy: { opacity: 0.6 },
  btnText: { color: '#0f172a', fontSize: 16, fontWeight: '700' },
  dangerText: { color: '#fca5a5' },
});
