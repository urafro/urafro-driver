import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
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
import { colors, shadow, typography, space, radius } from '../theme';
import { Text, useToast } from '../components/ui';
import { animateNext } from '../lib/motion';
import { haptics } from '../lib/haptics';
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
  const toast = useToast();

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
        if (!cancelled) toast.error('Could not load your profile — try again.');
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
      toast.success('Details saved'); // toast fires the success haptic itself
    } catch {
      toast.error('Could not save — check your connection and try again.');
    } finally {
      setSavingDetails(false);
    }
  }, [token, name, displayName, language, ecName, ecPhone, hydrate, toast]);

  const saveVehicle = useCallback(async () => {
    setSavingVehicle(true);
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
      toast.success('Vehicle saved');
    } catch {
      toast.error('Could not save your vehicle — try again.');
    } finally {
      setSavingVehicle(false);
    }
  }, [token, vType, vMake, vModel, vColour, vPlate, hydrate, toast]);

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
              onPress={() => {
                haptics.tap(); // selection tick
                setLanguage(l.id);
              }}
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
              onPress={() => {
                haptics.tap(); // selection tick
                // B3: the make/model/colour/plate block appears/collapses when the
                // choice crosses the 'foot' boundary — animate that layout change.
                if ((vType === 'foot') !== (v.id === 'foot')) animateNext('base');
                setVType(v.id);
              }}
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

      {/* Cash-on-delivery limit (C8). Headroom is the actionable figure; a $0 cap
          (no valued vehicle yet) gets an explainer, not a bare "$0.00". */}
      {profile ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cash on delivery</Text>
          {profile.cod_cap_minor > 0 ? (
            <>
              <Row label="Cash you can still carry" value={money(profile.cod_headroom_minor)} color={colors.cod} />
              <Text style={styles.moneyHint}>
                Your COD limit is {money(profile.cod_cap_minor)} — it rises as ops value your vehicle and your
                verification tier goes up.
              </Text>
            </>
          ) : (
            <View style={styles.codLocked}>
              <Feather name="alert-circle" size={18} color={colors.codText} />
              <Text style={styles.codLockedText}>
                You can&apos;t carry cash-on-delivery jobs yet. Ask ops to value your vehicle so you can start
                carrying COD.
              </Text>
            </View>
          )}
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

// Text styles from the shared type scale (typography.*); spacing/radii from tokens.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingTop: 72, paddingBottom: space.xxxl, gap: space.lg },
  title: { ...typography.display, color: colors.textPrimary },

  header: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.tabActive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.heading, fontSize: 20, lineHeight: 26, color: colors.surface },
  headerBody: { flex: 1, minWidth: 0 },
  headerName: { ...typography.heading, fontSize: 20, lineHeight: 26, color: colors.textPrimary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.xs },
  ratingText: { ...typography.callout, color: colors.textMuted },
  jobsText: { ...typography.caption, fontSize: 13, lineHeight: 18, color: colors.textFaint, marginTop: 2 },

  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.lg, ...shadow.card },
  cardTitle: { ...typography.subheading, fontWeight: '700', color: colors.textPrimary, marginBottom: space.md },

  pending: { backgroundColor: colors.pendingBg, borderRadius: radius.md, padding: space.md },
  pendingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  pendingText: { ...typography.body, color: colors.pendingText },
  pendingTextFlex: { flex: 1 },

  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  phoneBody: { flex: 1 },
  phoneValue: { ...typography.subheading, fontWeight: '700', color: colors.textPrimary },
  phoneHint: { ...typography.callout, color: colors.textMuted, marginTop: 2 },

  label: { ...typography.callout, fontWeight: '700', color: colors.textPrimary, marginBottom: space.sm },
  labelSpaced: { marginTop: space.lg },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
  },
  inputGap: { marginTop: space.sm },
  row: { flexDirection: 'row', gap: space.md },
  rowItem: { flex: 1 },
  hint: { ...typography.caption, fontSize: 13, lineHeight: 18, color: colors.textFaint, marginTop: space.sm },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14, // non-grid literal, kept exact
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.tabActive, borderColor: colors.tabActive },
  chipText: { ...typography.callout, fontWeight: '700', color: colors.textMuted },
  chipTextActive: { color: colors.surface },

  save: { backgroundColor: colors.btnPrimaryBg, borderRadius: radius.pill, minHeight: 48, justifyContent: 'center', alignItems: 'center', marginTop: space.xl },
  busy: { opacity: 0.6 },
  saveText: { ...typography.subheading, fontWeight: '700', color: colors.btnPrimaryText },

  moneyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  moneyLabel: { ...typography.body, color: colors.textMuted },
  moneyValue: { ...typography.body, fontWeight: '700' },
  moneyHint: { ...typography.caption, color: colors.textFaint, marginTop: space.sm },
  codLocked: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, backgroundColor: colors.codBg, borderRadius: radius.sm, padding: space.md },
  codLockedText: { ...typography.callout, flex: 1, color: colors.codText },

  ghostBtn: {
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ghostBtnText: { ...typography.subheading, fontWeight: '700', color: colors.textPrimary },
  dangerBtn: {
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dangerBtnText: { ...typography.subheading, fontWeight: '700', color: colors.danger },
});
