import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  getEarnings,
  getProfile,
  putVehicle,
  updateProfile,
  type DriverProfile,
  type Earnings,
  type VehicleType,
} from '../lib/api';
import { money } from '../lib/format';
import { waUrl } from '../lib/links';
import { OPS_WHATSAPP } from '../config';
import { useSession } from '../state/session';
import { colors, shadow, PILL } from '../theme';
import AvailabilityCard from '../components/AvailabilityCard';

// Driver profile (ADR-003 P0). Identity + REAL derived stats (no fake rating) +
// structured vehicle + language preference + emergency contact. Phone is the OTP
// identity; approval/stats are system-owned. Two saves: "details" (name, display
// name, language, emergency → PATCH /driver/profile) and "vehicle" (structured →
// PUT /driver/vehicles).
const LANGUAGES: { id: 'en' | 'sn' | 'nd'; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'sn', label: 'chiShona' },
  { id: 'nd', label: 'isiNdebele' },
];
const VEHICLE_TYPES: { id: VehicleType; label: string }[] = [
  { id: 'motorbike', label: 'Motorbike' },
  { id: 'car', label: 'Car' },
  { id: 'van', label: 'Van' },
  { id: 'bicycle', label: 'Bicycle' },
  { id: 'foot', label: 'On foot' },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

export default function ProfileScreen() {
  const { session, signOut } = useSession();
  const token = session?.token ?? '';

  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);

  // Editable details
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [language, setLanguage] = useState<'en' | 'sn' | 'nd'>('en');
  const [ecName, setEcName] = useState('');
  const [ecPhone, setEcPhone] = useState('');
  // Editable vehicle
  const [vType, setVType] = useState<VehicleType>('car');
  const [vMake, setVMake] = useState('');
  const [vModel, setVModel] = useState('');
  const [vColour, setVColour] = useState('');
  const [vPlate, setVPlate] = useState('');

  const [savingDetails, setSavingDetails] = useState(false);
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const hydrate = useCallback((p: DriverProfile) => {
    setProfile(p);
    setName(p.name ?? '');
    setDisplayName(p.display_name ?? '');
    setLanguage(p.preferred_language);
    setEcName(p.emergency_contact?.name ?? '');
    setEcPhone(p.emergency_contact?.phone ?? '');
    if (p.vehicle) {
      setVType(p.vehicle.type);
      setVMake(p.vehicle.make ?? '');
      setVModel(p.vehicle.model ?? '');
      setVColour(p.vehicle.colour ?? '');
      setVPlate(p.vehicle.plate ?? '');
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await getProfile(token);
        if (!cancelled) hydrate(p);
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
  }, [token, hydrate]);

  const saveDetails = useCallback(async () => {
    setSavingDetails(true);
    setNote(null);
    try {
      await updateProfile(token, {
        name: name.trim(),
        display_name: displayName.trim(),
        preferred_language: language,
        emergency_contact_name: ecName.trim(),
        emergency_contact_phone: ecPhone.trim(),
      });
      const p = await getProfile(token);
      hydrate(p);
      setNote('Saved.');
    } catch {
      setNote('Could not save — check your connection and try again.');
    } finally {
      setSavingDetails(false);
    }
  }, [token, name, displayName, language, ecName, ecPhone, hydrate]);

  const saveVehicle = useCallback(async () => {
    setSavingVehicle(true);
    setNote(null);
    try {
      // 'foot' carries no make/model — omit them so a prior vehicle's stale detail
      // can't leak. Blank fields go as undefined (let the server keep them null).
      await putVehicle(
        token,
        vType === 'foot'
          ? { type: vType }
          : {
              type: vType,
              make: vMake.trim() || undefined,
              model: vModel.trim() || undefined,
              colour: vColour.trim() || undefined,
              plate: vPlate.trim() || undefined,
            },
      );
      const p = await getProfile(token);
      hydrate(p);
      setNote('Vehicle saved.');
    } catch {
      setNote('Could not save your vehicle — try again.');
    } finally {
      setSavingVehicle(false);
    }
  }, [token, vType, vMake, vModel, vColour, vPlate, hydrate]);

  const stats = profile?.stats;
  const canGoOnline = profile?.capabilities?.can_go_online ?? true;
  const ratingLabel =
    stats && stats.rating_count > 0 && stats.rating_avg != null
      ? `${stats.rating_avg.toFixed(1)} rating`
      : 'New driver';
  const jobsLine = stats
    ? `${stats.lifetime_jobs} deliver${stats.lifetime_jobs === 1 ? 'y' : 'ies'}` +
      (stats.completion_rate != null ? ` · ${Math.round(stats.completion_rate * 100)}% completed` : '')
    : '';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Profile</Text>

      {/* Avatar + identity header — REAL stats (rating only once it exists). */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          {initials(name) ? (
            <Text style={styles.avatarText}>{initials(name)}</Text>
          ) : (
            <Feather name="user" size={28} color={colors.surface} />
          )}
        </View>
        <View style={styles.headerBody}>
          <Text style={styles.headerName} numberOfLines={1}>
            {displayName || name || 'Your name'}
          </Text>
          <View style={styles.ratingRow}>
            {stats && stats.rating_count > 0 ? (
              <Feather name="star" size={14} color={colors.money} />
            ) : null}
            <Text style={styles.ratingText}>{ratingLabel}</Text>
          </View>
          {jobsLine ? <Text style={styles.jobsText}>{jobsLine}</Text> : null}
          {profile?.zone ? <Text style={styles.jobsText}>Zone · {profile.zone.name}</Text> : null}
        </View>
      </View>

      {!canGoOnline ? (
        <View style={[styles.pending, styles.pendingRow]}>
          <Feather name="clock" size={18} color={colors.pendingText} />
          <Text style={[styles.pendingText, styles.pendingTextFlex]}>
            Your account is awaiting approval — you can set up your profile, but shifts unlock
            once ops approves you.
          </Text>
        </View>
      ) : null}

      {/* Immutable phone — the login identity. */}
      <View style={styles.card}>
        <View style={styles.phoneRow}>
          <Feather name="lock" size={20} color={colors.textMuted} />
          <View style={styles.phoneBody}>
            <Text style={styles.phoneValue}>{profile?.phone ?? ''}</Text>
            <Text style={styles.phoneHint}>Login number — can&apos;t be changed</Text>
          </View>
        </View>
      </View>

      {/* Your details: name, display name, language, emergency contact. */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your details</Text>

        <Text style={styles.label}>Full name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Tendai Moyo"
          placeholderTextColor={colors.placeholder}
          maxLength={80}
        />

        <Text style={[styles.label, styles.labelSpaced]}>Display name (optional)</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="What customers see — e.g. Tendai"
          placeholderTextColor={colors.placeholder}
          maxLength={80}
        />

        <Text style={[styles.label, styles.labelSpaced]}>Language</Text>
        <View style={styles.chips}>
          {LANGUAGES.map((l) => (
            <Pressable
              key={l.id}
              style={[styles.chip, language === l.id && styles.chipActive]}
              onPress={() => setLanguage(l.id)}
            >
              <Text style={[styles.chipText, language === l.id && styles.chipTextActive]}>{l.label}</Text>
            </Pressable>
          ))}
        </View>
        {language !== 'en' ? (
          <Text style={styles.hint}>App text in this language is on the way — your choice is saved.</Text>
        ) : null}

        <Text style={[styles.label, styles.labelSpaced]}>Emergency contact</Text>
        <TextInput
          style={styles.input}
          value={ecName}
          onChangeText={setEcName}
          placeholder="Name (next of kin)"
          placeholderTextColor={colors.placeholder}
          maxLength={120}
        />
        <TextInput
          style={[styles.input, styles.inputGap]}
          value={ecPhone}
          onChangeText={setEcPhone}
          placeholder="Phone — e.g. +263 77 000 0000"
          placeholderTextColor={colors.placeholder}
          keyboardType="phone-pad"
          maxLength={40}
        />

        <Pressable
          style={[styles.save, savingDetails && styles.busy]}
          onPress={saveDetails}
          disabled={savingDetails || name.trim().length < 2}
        >
          <Text style={styles.saveText}>{savingDetails ? 'Saving…' : 'Save details'}</Text>
        </Pressable>
      </View>

      {/* Vehicle — structured. */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Vehicle</Text>
        <View style={styles.chips}>
          {VEHICLE_TYPES.map((v) => (
            <Pressable
              key={v.id}
              style={[styles.chip, vType === v.id && styles.chipActive]}
              onPress={() => setVType(v.id)}
            >
              <Text style={[styles.chipText, vType === v.id && styles.chipTextActive]}>{v.label}</Text>
            </Pressable>
          ))}
        </View>

        {vType !== 'foot' ? (
          <>
            <View style={styles.row}>
              <View style={styles.rowItem}>
                <Text style={[styles.label, styles.labelSpaced]}>Make</Text>
                <TextInput
                  style={styles.input}
                  value={vMake}
                  onChangeText={setVMake}
                  placeholder="Honda"
                  placeholderTextColor={colors.placeholder}
                  maxLength={40}
                />
              </View>
              <View style={styles.rowItem}>
                <Text style={[styles.label, styles.labelSpaced]}>Model</Text>
                <TextInput
                  style={styles.input}
                  value={vModel}
                  onChangeText={setVModel}
                  placeholder="Fit"
                  placeholderTextColor={colors.placeholder}
                  maxLength={40}
                />
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.rowItem}>
                <Text style={[styles.label, styles.labelSpaced]}>Colour</Text>
                <TextInput
                  style={styles.input}
                  value={vColour}
                  onChangeText={setVColour}
                  placeholder="Red"
                  placeholderTextColor={colors.placeholder}
                  maxLength={30}
                />
              </View>
              <View style={styles.rowItem}>
                <Text style={[styles.label, styles.labelSpaced]}>Plate</Text>
                <TextInput
                  style={styles.input}
                  value={vPlate}
                  onChangeText={setVPlate}
                  placeholder="ABC 1234"
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="characters"
                  maxLength={20}
                />
              </View>
            </View>
          </>
        ) : null}

        <Pressable style={[styles.save, savingVehicle && styles.busy]} onPress={saveVehicle} disabled={savingVehicle}>
          <Text style={styles.saveText}>{savingVehicle ? 'Saving…' : 'Save vehicle'}</Text>
        </Pressable>
      </View>

      {note ? <Text style={styles.note}>{note}</Text> : null}

      <AvailabilityCard token={token} />

      {earnings ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Money</Text>
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
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  ratingText: { color: colors.textMuted, fontSize: 14 },
  jobsText: { color: colors.textFaint, fontSize: 13, marginTop: 2 },

  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, ...shadow.card },
  cardTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 12 },

  pending: { backgroundColor: colors.pendingBg, borderRadius: 12, padding: 12 },
  pendingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  pendingText: { color: colors.pendingText, fontSize: 15 },
  pendingTextFlex: { flex: 1 },

  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  phoneBody: { flex: 1 },
  phoneValue: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  phoneHint: { color: colors.textMuted, fontSize: 14, marginTop: 2 },

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
  inputGap: { marginTop: 8 },
  row: { flexDirection: 'row', gap: 12 },
  rowItem: { flex: 1 },
  hint: { color: colors.textFaint, fontSize: 13, marginTop: 8 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: PILL,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.tabActive, borderColor: colors.tabActive },
  chipText: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  chipTextActive: { color: colors.surface },

  save: { backgroundColor: colors.btnPrimaryBg, borderRadius: PILL, minHeight: 48, justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  busy: { opacity: 0.6 },
  saveText: { color: colors.btnPrimaryText, fontSize: 16, fontWeight: '700' },
  note: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },

  moneyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  moneyLabel: { color: colors.textMuted, fontSize: 15 },
  moneyValue: { fontSize: 15, fontWeight: '700' },
  moneyHint: { color: colors.textFaint, fontSize: 12, marginTop: 8 },

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
