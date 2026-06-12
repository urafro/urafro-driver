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
// Language + rating are visual previews only — NOT wired to any backend.
const LANGUAGES: { id: string; label: string; active?: boolean; soon?: boolean }[] = [
  { id: 'en', label: 'English', active: true },
  { id: 'sn', label: 'chiShona', soon: true },
  { id: 'nd', label: 'isiNdebele', soon: true },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '👤';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

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

      {/* Avatar + identity header. Rating is a visual preview (no backend field). */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(name)}</Text>
        </View>
        <View style={styles.headerBody}>
          <Text style={styles.headerName} numberOfLines={1}>
            {name || 'Your name'}
          </Text>
          <View style={styles.ratingRow}>
            <Text style={styles.star}>★</Text>
            <Text style={styles.ratingText}>4.8 rating</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>PREVIEW</Text>
            </View>
          </View>
        </View>
      </View>

      {!approved ? (
        <View style={styles.pending}>
          <Text style={styles.pendingText}>
            ⏳ Your account is awaiting approval — you can set up your profile, but shifts unlock
            once ops approves you.
          </Text>
        </View>
      ) : null}

      {/* Immutable phone — the login identity. */}
      <View style={styles.card}>
        <View style={styles.phoneRow}>
          <Text style={styles.lockIcon}>🔒</Text>
          <View style={styles.phoneBody}>
            <Text style={styles.phoneValue}>{phone}</Text>
            <Text style={styles.phoneHint}>Login number — can't be changed</Text>
          </View>
        </View>
      </View>

      {/* Editable name + vehicle. */}
      <View style={styles.card}>
        <Text style={styles.label}>Your name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Tendai M."
          placeholderTextColor={colors.placeholder}
          maxLength={80}
        />

        <Text style={[styles.label, styles.labelSpaced]}>Vehicle</Text>
        <TextInput
          style={styles.input}
          value={vehicle}
          onChangeText={setVehicle}
          placeholder="e.g. Honda Fit, red — or Motorbike"
          placeholderTextColor={colors.placeholder}
          maxLength={80}
        />

        <Pressable
          style={[styles.save, busy && styles.busy]}
          onPress={save}
          disabled={busy || name.trim().length < 2}
        >
          <Text style={styles.saveText}>{busy ? 'Saving…' : 'Save'}</Text>
        </Pressable>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>

      {/* Language — English active; others are Phase D previews. */}
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Language</Text>
        <View style={styles.langList}>
          {LANGUAGES.map((l, i) => (
            <View key={l.id}>
              {i > 0 ? <View style={styles.divider} /> : null}
              <Pressable
                style={styles.langRow}
                onPress={l.soon ? () => setNote('Shona & Ndebele land with Phase D localization.') : undefined}
                disabled={!l.soon}
              >
                <Text style={[styles.langLabel, l.active && styles.langLabelActive]}>{l.label}</Text>
                {l.active ? <Text style={styles.check}>✓</Text> : null}
                {l.soon ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>SOON</Text>
                  </View>
                ) : null}
              </Pressable>
            </View>
          ))}
        </View>
      </View>

      {earnings ? (
        <View style={styles.card}>
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

      {OPS_WHATSAPP ? (
        <Pressable style={styles.ghostBtn} onPress={() => void Linking.openURL(waUrl(OPS_WHATSAPP))}>
          <Text style={styles.ghostBtnText}>Contact ops on WhatsApp</Text>
        </Pressable>
      ) : null}

      <Pressable style={styles.dangerBtn} onPress={signOut}>
        <Text style={styles.dangerBtnText}>Sign out</Text>
      </Pressable>
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
  content: { padding: 16, paddingTop: 72, paddingBottom: 32, gap: 16 },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '700' },

  // Avatar / identity header
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: PILL,
    backgroundColor: colors.tabActive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.surface, fontSize: 20, fontWeight: '700' },
  headerBody: { flex: 1, minWidth: 0 },
  headerName: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  star: { color: colors.money, fontSize: 16 },
  ratingText: { color: colors.textMuted, fontSize: 14 },

  badge: { backgroundColor: colors.surfaceAlt, borderRadius: PILL, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  // Cards
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, ...shadow.card },

  pending: { backgroundColor: colors.pendingBg, borderRadius: 12, padding: 12 },
  pendingText: { color: colors.pendingText, fontSize: 15 },

  // Phone row
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  lockIcon: { fontSize: 20 },
  phoneBody: { flex: 1 },
  phoneValue: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  phoneHint: { color: colors.textMuted, fontSize: 14, marginTop: 2 },

  // Editable fields
  label: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', marginBottom: 8 },
  labelSpaced: { marginTop: 16 },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  save: { backgroundColor: colors.btnPrimaryBg, borderRadius: PILL, minHeight: 48, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  busy: { opacity: 0.6 },
  saveText: { color: colors.btnPrimaryText, fontSize: 16, fontWeight: '700' },
  note: { color: colors.textMuted, fontSize: 14, marginTop: 10, textAlign: 'center' },

  // Language list
  eyebrow: { color: colors.tabActive, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  langList: {},
  divider: { height: 1, backgroundColor: colors.surfaceAlt },
  langRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  langLabel: { flex: 1, color: colors.textPrimary, fontSize: 16 },
  langLabelActive: { fontWeight: '700' },
  check: { color: colors.tabActive, fontSize: 18, fontWeight: '700' },

  // Money block
  moneyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  moneyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  moneyLabel: { color: colors.textMuted, fontSize: 15 },
  moneyValue: { fontSize: 15, fontWeight: '700' },
  moneyHint: { color: colors.textFaint, fontSize: 12, marginTop: 8 },

  // Action buttons
  ghostBtn: {
    minHeight: 48,
    borderRadius: PILL,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ghostBtnText: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  dangerBtn: {
    minHeight: 48,
    borderRadius: PILL,
    borderWidth: 1,
    borderColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dangerBtnText: { color: colors.danger, fontSize: 16, fontWeight: '700' },
});
