import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { getEarnings, getProfile, updateProfile, type Earnings } from '../lib/api';
import { money } from '../lib/format';
import { waUrl } from '../lib/links';
import { OPS_WHATSAPP } from '../config';
import { useSession } from '../state/session';
import { colors, shadow, PILL } from '../theme';

// Driver profile + the money summary (ADR-002 B). Name + vehicle are the only
// driver-editable fields (phone is the OTP identity; approval is ops-owned).
export default function ProfileScreen() {
  const { session, signOut } = useSession();
  const token = session?.token ?? '';

  const [name, setName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [phone, setPhone] = useState('');
  const [approved, setApproved] = useState(true);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await getProfile(token);
        if (cancelled) return;
        setName(p.name);
        setVehicle(p.vehicle ?? '');
        setPhone(p.phone);
        setApproved(p.approved);
      } catch {
        if (!cancelled) setNote('Could not load your profile — try again.');
      }
      try {
        const e = await getEarnings(token);
        if (!cancelled) setEarnings(e);
      } catch {
        // non-critical
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const save = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      await updateProfile(token, { name: name.trim(), vehicle: vehicle.trim() });
      setNote('Saved.');
    } catch {
      setNote('Could not save — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [token, name, vehicle]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Profile</Text>

      {!approved ? (
        <View style={styles.pending}>
          <Text style={styles.pendingText}>
            ⏳ Your account is awaiting approval — you can set up your profile, but shifts unlock
            once ops approves you.
          </Text>
        </View>
      ) : null}

      <Text style={styles.label}>Phone (login)</Text>
      <Text style={styles.phone}>{phone}</Text>

      <Text style={styles.label}>Your name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Tendai M."
        placeholderTextColor={colors.placeholder}
        maxLength={80}
      />

      <Text style={styles.label}>Vehicle</Text>
      <TextInput
        style={styles.input}
        value={vehicle}
        onChangeText={setVehicle}
        placeholder="e.g. Honda Fit, red — or Motorbike"
        placeholderTextColor={colors.placeholder}
        maxLength={80}
      />

      <Pressable style={[styles.save, busy && styles.busy]} onPress={save} disabled={busy || name.trim().length < 2}>
        <Text style={styles.saveText}>{busy ? 'Saving…' : 'Save'}</Text>
      </Pressable>
      {note ? <Text style={styles.note}>{note}</Text> : null}

      {earnings ? (
        <View style={styles.moneyCard}>
          <Text style={styles.moneyTitle}>Money</Text>
          <Row label="Owed to you (all time)" value={money(earnings.payable_minor)} color={colors.money} />
          <Row
            label={`Today (${earnings.today_deliveries} deliver${earnings.today_deliveries === 1 ? 'y' : 'ies'})`}
            value={money(earnings.today_minor)}
            color={colors.money}
          />
          {earnings.cod_owed_minor > 0 ? (
            <>
              <Row label="Cash collected, to hand in" value={money(earnings.cod_owed_minor)} color={colors.cod} />
              <Text style={styles.moneyHint}>
                Hand COD cash to ops at the end of your shift — your earnings are paid out separately.
              </Text>
            </>
          ) : null}
        </View>
      ) : null}

      <View style={styles.footer}>
        {OPS_WHATSAPP ? (
          <Pressable onPress={() => void Linking.openURL(waUrl(OPS_WHATSAPP))}>
            <Text style={styles.link}>Contact ops on WhatsApp</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={signOut}>
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.moneyRow}>
      <Text style={styles.moneyLabel}>{label}</Text>
      <Text style={[styles.moneyValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, paddingTop: 72, paddingBottom: 32 },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '700', marginBottom: 8 },
  pending: { backgroundColor: colors.pendingBg, borderRadius: 10, padding: 12, marginTop: 8 },
  pendingText: { color: colors.pendingText, fontSize: 13 },
  label: { color: colors.textMuted, fontSize: 13, marginTop: 20, marginBottom: 6 },
  phone: { color: colors.textSecondary, fontSize: 16 },
  input: {
    backgroundColor: colors.inputBgRaised,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  save: { backgroundColor: colors.btnPrimaryBg, borderRadius: PILL, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  busy: { opacity: 0.6 },
  saveText: { color: colors.btnPrimaryText, fontSize: 16, fontWeight: '700' },
  note: { color: colors.textMuted, fontSize: 13, marginTop: 10, textAlign: 'center' },
  moneyCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, marginTop: 28, ...shadow.card },
  moneyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  moneyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  moneyLabel: { color: colors.textMuted, fontSize: 14 },
  moneyValue: { fontSize: 15, fontWeight: '700' },
  moneyHint: { color: colors.textFaint, fontSize: 12, marginTop: 8 },
  footer: { marginTop: 32, gap: 16, alignItems: 'center' },
  link: { color: colors.textMuted, fontSize: 14 },
});
