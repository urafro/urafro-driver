import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { updateProfile, putVehicle, type DriverProfile, type VehicleType } from '../lib/api';
import { ensureForegroundPermission } from '../lib/location';
import { waUrl } from '../lib/links';
import { OPS_WHATSAPP } from '../config';
import { useSession } from '../state/session';
import { colors, shadow, PILL } from '../theme';

type Step = 'welcome' | 'permissions' | 'profile' | 'waiting';

const VEHICLE_TYPES: { id: VehicleType; label: string }[] = [
  { id: 'motorbike', label: 'Motorbike' },
  { id: 'car', label: 'Car' },
  { id: 'van', label: 'Van' },
  { id: 'bicycle', label: 'Bicycle' },
  { id: 'foot', label: 'On foot' },
];

// First-run onboarding for a new / not-yet-approved driver. Sign-up itself is the
// OTP login (find-or-create); this is everything after: set expectations, explain
// the permissions the shift loop needs, capture name + vehicle (otherwise buried
// in Profile and skipped), then hold on an approval-gate that auto-advances to the
// app the moment ops clears them. A returning, still-unapproved driver who already
// filled in their details jumps straight to the waiting step.
export default function Onboarding({
  token,
  profile,
  onReload,
}: {
  token: string;
  profile: DriverProfile;
  /** Re-fetch the profile in the app root — when it comes back approved, the root
   *  swaps this whole flow out for the tabbed app. */
  onReload: () => void;
}) {
  const { signOut } = useSession();
  const [step, setStep] = useState<Step>(profile.name?.trim() ? 'waiting' : 'welcome');
  const [name, setName] = useState(profile.name ?? '');
  const [vType, setVType] = useState<VehicleType>(profile.vehicle?.type ?? 'motorbike');
  const [vDetail, setVDetail] = useState(profile.vehicle?.make ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On the waiting step, re-check approval whenever the app returns to the
  // foreground — so a driver cleared while the app was backgrounded lands straight
  // in the shift screen on resume without tapping anything.
  useEffect(() => {
    if (step !== 'waiting') return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') onReload();
    });
    return () => sub.remove();
  }, [step, onReload]);

  const continueFromPermissions = useCallback(async () => {
    setBusy(true);
    try {
      // Request the foreground location grant here so the system prompt has
      // context. A denial doesn't block onboarding — going on shift re-asks, and
      // the punch list's background "allow all the time" prompt fires there too.
      await ensureForegroundPermission();
    } catch {
      // best-effort — never trap onboarding on a permission outcome
    } finally {
      setBusy(false);
      setStep('profile');
    }
  }, []);

  const saveDetails = useCallback(async () => {
    if (name.trim().length < 2) {
      setError('Enter your name so ops can recognise you.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateProfile(token, { name: name.trim() });
      await putVehicle(
        token,
        vType === 'foot' ? { type: vType } : { type: vType, make: vDetail.trim() || undefined },
      );
      setStep('waiting');
      onReload();
    } catch {
      setError('Could not save — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [token, name, vType, vDetail, onReload]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Branded header on every step */}
      <View style={styles.header}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>u.</Text>
        </View>
        <View style={styles.brandTitleGroup}>
          <Text style={styles.brandTitle}>urAfro Driver</Text>
          <Text style={styles.brandSub}>Deliver around Harare. Earn in USD.</Text>
        </View>
      </View>

      {step !== 'waiting' ? <StepDots step={step} /> : null}

      {step === 'welcome' ? (
        <View style={styles.section}>
          <Text style={styles.title}>Welcome — let&apos;s get you set up</Text>
          <Text style={styles.lead}>About a minute, then you&apos;re ready for the urAfro team to approve you.</Text>
          <View style={styles.bullets}>
            <Bullet icon="inbox" title="Get delivery offers" body="Jobs pop up near you with the pay and distance up front." />
            <Bullet icon="navigation" title="Pick up & deliver" body="Landmarks and a one-tap call get you to the door." />
            <Bullet icon="dollar-sign" title="Get paid in USD" body="Your cut of every delivery, paid out to your EcoCash." />
          </View>
          <PrimaryButton label="Get started" onPress={() => setStep('permissions')} />
        </View>
      ) : step === 'permissions' ? (
        <View style={styles.section}>
          <Text style={styles.title}>Stay reachable on shift</Text>
          <Text style={styles.lead}>Three things keep offers flowing to you — we&apos;ll ask for them as you go.</Text>
          <PermCard
            icon="map-pin"
            title="Share your location"
            body="When asked, choose “Allow all the time” so offers reach you even with your phone locked in your pocket."
          />
          <PermCard
            icon="battery-charging"
            title="Keep the app awake"
            body="Some phones sleep apps to save battery — you’d silently miss offers. We’ll help you switch that off."
          />
          <PermCard
            icon="bell"
            title="Hear new offers"
            body="Offers expire in 5 minutes — a loud notification means you catch them with the screen off."
          />
          <PrimaryButton label="Continue" onPress={() => void continueFromPermissions()} busy={busy} />
        </View>
      ) : step === 'profile' ? (
        <View style={styles.section}>
          <Text style={styles.title}>Your details</Text>
          <Text style={styles.lead}>So ops can approve you and customers know who&apos;s coming.</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Your name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(v) => {
                setName(v);
                setError(null);
              }}
              placeholder="e.g. Tendai M."
              placeholderTextColor={colors.placeholder}
              maxLength={80}
              autoFocus
            />
            <Text style={[styles.label, styles.labelGap]}>Vehicle</Text>
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
              <TextInput
                style={[styles.input, styles.detailGap]}
                value={vDetail}
                onChangeText={setVDetail}
                placeholder="Make & model — e.g. Honda Fit (optional)"
                placeholderTextColor={colors.placeholder}
                maxLength={60}
              />
            ) : null}
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton label="Save & continue" onPress={() => void saveDetails()} busy={busy} />
        </View>
      ) : (
        // waiting / approval gate
        <View style={styles.section}>
          <View style={styles.reviewBadge}>
            <Feather name="clock" size={36} strokeWidth={1.5} color={colors.warning} />
          </View>
          <Text style={styles.title}>You&apos;re in review</Text>
          <Text style={styles.lead}>
            Thanks{name.trim() ? `, ${name.trim().split(' ')[0]}` : ''} — the urAfro team is checking your account, usually
            within a day. You&apos;ll be able to go on shift the moment you&apos;re cleared.
          </Text>

          <View style={styles.card}>
            <CheckRow done label="Phone number verified" />
            <CheckRow done label="Name & vehicle added" />
            <CheckRow label="Ops review" sub="In progress — we’ll notify you" />
          </View>

          <Pressable style={styles.editRow} onPress={() => setStep('profile')} hitSlop={8}>
            <Feather name="edit-2" size={16} strokeWidth={1.5} color={colors.textMuted} />
            <Text style={styles.editText}>Edit your name or vehicle</Text>
          </Pressable>

          <PrimaryButton label={busy ? 'Checking…' : 'Check again'} onPress={onReload} busy={busy} />

          <View style={styles.footer}>
            {OPS_WHATSAPP ? (
              <Pressable style={styles.opsRow} onPress={() => void Linking.openURL(waUrl(OPS_WHATSAPP))} hitSlop={8}>
                <Feather name="message-circle" size={16} strokeWidth={1.5} color={colors.textMuted} />
                <Text style={styles.link}>Message urAfro ops</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={signOut} hitSlop={8}>
              <Text style={styles.link}>Sign out</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function StepDots({ step }: { step: Step }) {
  const order: Step[] = ['welcome', 'permissions', 'profile'];
  const idx = order.indexOf(step);
  return (
    <View style={styles.dots}>
      {order.map((s, i) => (
        <View key={s} style={[styles.dot, i === idx ? styles.dotActive : i < idx ? styles.dotDone : null]} />
      ))}
    </View>
  );
}

function Bullet({ icon, title, body }: { icon: keyof typeof Feather.glyphMap; title: string; body: string }) {
  return (
    <View style={styles.bullet}>
      <View style={styles.bulletIcon}>
        <Feather name={icon} size={20} strokeWidth={1.5} color={colors.tabActive} />
      </View>
      <View style={styles.bulletTextWrap}>
        <Text style={styles.bulletTitle}>{title}</Text>
        <Text style={styles.bulletBody}>{body}</Text>
      </View>
    </View>
  );
}

function PermCard({ icon, title, body }: { icon: keyof typeof Feather.glyphMap; title: string; body: string }) {
  return (
    <View style={styles.card}>
      <View style={styles.permHead}>
        <Feather name={icon} size={20} strokeWidth={1.5} color={colors.tabActive} />
        <Text style={styles.permTitle}>{title}</Text>
      </View>
      <Text style={styles.permBody}>{body}</Text>
    </View>
  );
}

function CheckRow({ done, label, sub }: { done?: boolean; label: string; sub?: string }) {
  return (
    <View style={styles.checkRow}>
      <Feather
        name={done ? 'check-circle' : 'clock'}
        size={20}
        strokeWidth={1.5}
        color={done ? colors.success : colors.textFaint}
      />
      <View style={styles.checkTextWrap}>
        <Text style={styles.checkLabel}>{label}</Text>
        {sub ? <Text style={styles.checkSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

function PrimaryButton({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable style={[styles.button, busy && styles.buttonBusy]} onPress={onPress} disabled={busy}>
      {busy ? <ActivityIndicator color={colors.btnPrimaryText} /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, paddingTop: 64, paddingBottom: 40, gap: 24 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  brandMark: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.notificationAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: { color: colors.surface, fontSize: 24, fontWeight: '700' },
  brandTitleGroup: { flex: 1 },
  brandTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '700' },
  brandSub: { color: colors.textMuted, fontSize: 14, marginTop: 2 },

  dots: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { width: 24, backgroundColor: colors.tabActive },
  dotDone: { backgroundColor: colors.tabActive },

  section: { gap: 16 },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '700' },
  lead: { color: colors.textMuted, fontSize: 16, lineHeight: 23 },

  bullets: { gap: 16, marginTop: 4 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  bulletIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletTextWrap: { flex: 1 },
  bulletTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  bulletBody: { color: colors.textMuted, fontSize: 15, lineHeight: 21, marginTop: 2 },

  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, ...shadow.card },
  permHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  permTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  permBody: { color: colors.textMuted, fontSize: 15, lineHeight: 21, marginTop: 8 },

  label: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  labelGap: { marginTop: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
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
  detailGap: { marginTop: 8 },
  input: {
    minHeight: 48,
    backgroundColor: colors.inputBg,
    color: colors.textPrimary,
    fontSize: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },

  reviewBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.batteryBg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  checkTextWrap: { flex: 1 },
  checkLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  checkSub: { color: colors.textFaint, fontSize: 14, marginTop: 2 },
  editRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  editText: { color: colors.textMuted, fontSize: 15, textDecorationLine: 'underline' },

  button: {
    backgroundColor: colors.btnPrimaryBg,
    borderRadius: PILL,
    minHeight: 48,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: colors.btnPrimaryText, fontSize: 16, fontWeight: '700' },

  error: { color: colors.danger, fontSize: 15, fontWeight: '700', lineHeight: 21 },

  footer: { marginTop: 8, gap: 16, alignItems: 'center' },
  opsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  link: { color: colors.textMuted, fontSize: 15 },
});
