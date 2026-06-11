import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { DriverDelivery, FailureReason } from '../lib/api';
import { money, placeLabel } from '../lib/format';
import { mapsUrl, telUrl } from '../lib/links';
import { colors } from '../theme';

export type LifecycleAction = 'picked_up' | 'in_transit' | 'delivered' | 'failed';
export interface ActionExtra {
  reason?: FailureReason;
  codCollectedMinor?: number;
  note?: string;
  /** At-door delivery code read out by the customer (verified handover). */
  podPin?: string;
}

// The actions available from each status (mirrors the platform state machine).
// "Can't complete" exists in EVERY live state — a driver stuck after pickup
// (unreachable customer, refused cash) must always have an exit (ADR-002 A.2).
const ACTIONS: Record<string, { label: string; to: LifecycleAction; danger?: boolean }[]> = {
  assigned: [
    { label: "I've picked up", to: 'picked_up' },
    { label: "Can't complete", to: 'failed', danger: true },
  ],
  picked_up: [
    { label: 'On my way', to: 'in_transit' },
    { label: 'Delivered', to: 'delivered' },
    { label: "Can't complete", to: 'failed', danger: true },
  ],
  in_transit: [
    { label: 'Delivered', to: 'delivered' },
    { label: "Can't complete", to: 'failed', danger: true },
  ],
};

const FAILURE_REASONS: { value: FailureReason; label: string }[] = [
  { value: 'customer_unreachable', label: 'Customer unreachable' },
  { value: 'wrong_address', label: 'Wrong address' },
  { value: 'customer_refused', label: 'Customer refused the order' },
  { value: 'cash_refused', label: "Couldn't collect the cash" },
  { value: 'vehicle_problem', label: 'Vehicle problem' },
  { value: 'other', label: 'Something else' },
];

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
  actionError,
}: {
  job: DriverDelivery;
  onAction: (to: LifecycleAction, extra?: ActionExtra) => void;
  busy: boolean;
  /** Result of the driver's last lifecycle tap (layer-1 action feedback) —
   *  rendered adjacent to the control: under the code field in the deliver
   *  panel, else above the action buttons. */
  actionError?: string | null;
}) {
  const status = job.status ?? 'assigned';
  const actions = ACTIONS[status] ?? [];

  // Two-step confirms: "Can't complete" needs a reason; "Delivered" captures the
  // at-door delivery code (verified handover) + PoD note + (on COD jobs) the cash
  // actually collected.
  const [panel, setPanel] = useState<'fail' | 'deliver' | null>(null);
  const [note, setNote] = useState('');
  const [codInput, setCodInput] = useState('');
  const [pinInput, setPinInput] = useState('');

  const codDue = job.collect_minor ?? 0;
  const startAction = (to: LifecycleAction) => {
    if (to === 'failed') {
      setPanel('fail');
    } else if (to === 'delivered') {
      setCodInput(codDue > 0 ? (codDue / 100).toFixed(2) : '');
      setPinInput('');
      setPanel('deliver');
    } else {
      onAction(to);
    }
  };
  // The deliver panel deliberately STAYS OPEN here: on success the whole card
  // unmounts (the job clears), and on a wrong-code 400 the driver needs the form
  // (with their typed code) still in front of them to retry.
  const confirmDelivered = (withPin: boolean) => {
    const extra: ActionExtra = {};
    if (withPin) extra.podPin = pinInput;
    if (note.trim()) extra.note = note.trim().slice(0, 500);
    if (codDue > 0) {
      // Parse dollars → minor units; an unparseable edit falls back to the full
      // amount due (the server's own default) rather than silently booking 0.
      const parsed = Math.round(Number.parseFloat(codInput.replace(',', '.')) * 100);
      extra.codCollectedMinor = Number.isFinite(parsed) && parsed >= 0 ? parsed : codDue;
    }
    onAction('delivered', extra);
  };
  const pinReady = /^\d{4}$/.test(pinInput);

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
        {/* The driver's CUT, never the platform fee — quoting money they don't
            earn is a trust breach (ADR-002 A.3). */}
        <Text style={styles.meta}>You earn {money(job.driver_fee_minor ?? null)}</Text>
        {job.collect_minor ? (
          <Text style={styles.collect}>Collect {money(job.collect_minor)} cash</Text>
        ) : null}
      </View>

      {panel === 'fail' ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>What went wrong?</Text>
          {FAILURE_REASONS.map((r) => (
            <Pressable
              key={r.value}
              style={styles.reasonBtn}
              disabled={busy}
              onPress={() => {
                setPanel(null);
                onAction('failed', { reason: r.value });
              }}
            >
              <Text style={styles.reasonText}>{r.label}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.panelCancel} onPress={() => setPanel(null)}>
            <Text style={styles.panelCancelText}>Back</Text>
          </Pressable>
        </View>
      ) : panel === 'deliver' ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Confirm delivery</Text>
          <Text style={styles.fieldLabel}>Delivery code — ask the customer for the 4-digit code on their receipt</Text>
          <TextInput
            style={[styles.input, styles.pinInput]}
            value={pinInput}
            onChangeText={(t) => setPinInput(t.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="••••"
            placeholderTextColor={colors.placeholder}
          />
          {/* Wrong-code / cap feedback lands HERE, next to the field — not at the
              bottom of the scroll where the keyboard hides it. */}
          {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
          {codDue > 0 ? (
            <>
              <Text style={styles.fieldLabel}>Cash collected (due {money(codDue)})</Text>
              <TextInput
                style={styles.input}
                value={codInput}
                onChangeText={setCodInput}
                keyboardType="decimal-pad"
                placeholder={(codDue / 100).toFixed(2)}
                placeholderTextColor={colors.placeholder}
              />
            </>
          ) : null}
          <Text style={styles.fieldLabel}>Received by / note (optional)</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Left with Tariro at the gate"
            placeholderTextColor={colors.placeholder}
            maxLength={500}
          />
          <Pressable
            style={[styles.btn, styles.primary, (busy || !pinReady) && styles.busy]}
            disabled={busy || !pinReady}
            onPress={() => confirmDelivered(true)}
          >
            {busy ? <ActivityIndicator color={colors.btnPrimaryText} /> : <Text style={styles.btnText}>Confirm delivered</Text>}
          </Pressable>
          {/* Manual fallback — the customer may not have the code (older receipt,
              phone dead). Books the same completion, just unverified ('manual'). */}
          <Pressable style={styles.panelCancel} disabled={busy} onPress={() => confirmDelivered(false)}>
            <Text style={styles.panelCancelText}>No code? Complete without it</Text>
          </Pressable>
          <Pressable style={styles.panelCancel} onPress={() => setPanel(null)}>
            <Text style={styles.panelCancelText}>Back</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.actions}>
          {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
          {actions.map((a) => (
            <Pressable
              key={a.to}
              style={[styles.btn, a.danger ? styles.danger : styles.primary, busy && styles.busy]}
              onPress={() => startAction(a.to)}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={a.danger ? colors.danger : colors.btnPrimaryText} />
              ) : (
                <Text style={[styles.btnText, a.danger && styles.dangerText]}>{a.label}</Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surface, borderRadius: 14, padding: 20 },
  badge: {
    alignSelf: 'flex-start',
    color: colors.badgeText,
    backgroundColor: colors.badgeBg,
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  heading: { color: colors.textFaint, fontSize: 13, marginTop: 18, textTransform: 'uppercase' },
  place: { color: colors.textPrimary, fontSize: 19, marginTop: 4 },
  contact: { color: colors.textSecondary, fontSize: 14, marginTop: 4 },
  coord: { flexDirection: 'row', gap: 10, marginTop: 14 },
  coordBtn: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  coordText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  heading2: { color: colors.textFaint, fontSize: 12, marginTop: 20, textTransform: 'uppercase' },
  place2: { color: colors.textMuted, fontSize: 15, marginTop: 4 },
  metaRow: { flexDirection: 'row', gap: 16, marginTop: 18 },
  meta: { color: colors.money, fontSize: 15, fontWeight: '600' },
  collect: { color: colors.cod, fontSize: 15, fontWeight: '600' },
  actions: { gap: 10, marginTop: 24 },
  panel: { marginTop: 24, gap: 10 },
  panelTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  reasonBtn: { backgroundColor: colors.surfaceAlt, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 14 },
  reasonText: { color: colors.textPrimary, fontSize: 15 },
  panelCancel: { alignItems: 'center', paddingVertical: 10 },
  panelCancelText: { color: colors.textFaint, fontSize: 14 },
  fieldLabel: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  actionError: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  pinInput: { fontSize: 24, fontWeight: '700', letterSpacing: 12, textAlign: 'center' },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  btn: { borderRadius: 10, paddingVertical: 15, alignItems: 'center' },
  primary: { backgroundColor: colors.btnPrimaryBg },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.dangerBorder },
  busy: { opacity: 0.6 },
  btnText: { color: colors.btnPrimaryText, fontSize: 16, fontWeight: '700' },
  dangerText: { color: colors.danger },
});
