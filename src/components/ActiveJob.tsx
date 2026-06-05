import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { DriverDelivery } from '../lib/api';
import { money, placeLabel } from '../lib/format';
import { mapsUrl, telUrl } from '../lib/links';

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

// The driver's current job: who/where to head to next (with one-tap Navigate +
// Call), the other stop for context, and the next lifecycle step(s).
export default function ActiveJob({
  job,
  onAction,
  busy,
}: {
  job: DriverDelivery;
  onAction: (to: LifecycleAction) => void;
  busy: boolean;
}) {
  const status = job.status ?? 'assigned';
  const actions = ACTIONS[status] ?? [];

  // Before pickup the driver heads to the merchant; after, to the customer.
  const goingToPickup = status === 'assigned';
  const target = goingToPickup
    ? { label: 'merchant', geo: job.pickup, contact: job.pickup_contact }
    : { label: 'customer', geo: job.dropoff, contact: job.dropoff_contact };

  const navigate = () => {
    if (target.geo?.lat != null && target.geo?.lng != null) {
      void Linking.openURL(mapsUrl(target.geo.lat, target.geo.lng));
    }
  };
  const call = () => {
    if (target.contact?.phone) void Linking.openURL(telUrl(target.contact.phone));
  };

  return (
    <View style={styles.container}>
      <Text style={styles.badge}>{STATUS_LABEL[status] ?? status}</Text>

      <Text style={styles.heading}>Head to the {target.label}</Text>
      <Text style={styles.place}>{placeLabel(target.geo)}</Text>
      {target.contact?.name ? (
        <Text style={styles.contact}>
          {target.contact.name}
          {target.contact.phone ? ` · ${target.contact.phone}` : ''}
        </Text>
      ) : null}

      <View style={styles.coord}>
        {target.geo?.lat != null ? (
          <Pressable style={styles.coordBtn} onPress={navigate}>
            <Text style={styles.coordText}>🧭  Navigate</Text>
          </Pressable>
        ) : null}
        {target.contact?.phone ? (
          <Pressable style={styles.coordBtn} onPress={call}>
            <Text style={styles.coordText}>📞  Call {target.label}</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.heading2}>{goingToPickup ? 'Then deliver to' : 'Picked up from'}</Text>
      <Text style={styles.place2}>{placeLabel(goingToPickup ? job.dropoff : job.pickup)}</Text>

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
  place: { color: '#fff', fontSize: 19, marginTop: 4 },
  contact: { color: '#cbd5e1', fontSize: 14, marginTop: 4 },
  coord: { flexDirection: 'row', gap: 10, marginTop: 14 },
  coordBtn: {
    flex: 1,
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  coordText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  heading2: { color: '#64748b', fontSize: 12, marginTop: 20, textTransform: 'uppercase' },
  place2: { color: '#94a3b8', fontSize: 15, marginTop: 4 },
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
