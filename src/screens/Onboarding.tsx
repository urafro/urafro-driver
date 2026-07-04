import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { updateProfile, putVehicle, type DriverProfile, type VehicleType } from '../lib/api';
import VerificationCard from '../components/VerificationCard';
import { ensureForegroundPermission } from '../lib/location';
import { waUrl } from '../lib/links';
import { OPS_WHATSAPP } from '../config';
import { useSession } from '../state/session';
import { colors, shadow, typography, space, radius } from '../theme';
import { Text } from '../components/ui';
import { animateNext } from '../lib/motion';
import { haptics } from '../lib/haptics';

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
   *  swaps this whole flow out for the tabbed app. Returns a promise so the manual
   *  "Check again" button can await it and show real progress. */
  onReload: () => void | Promise<void>;
}) {
  const { signOut } = useSession();
  const [step, setStep] = useState<Step>(profile.name?.trim() ? 'waiting' : 'welcome');
  const [name, setName] = useState(profile.name ?? '');
  const [vType, setVType] = useState<VehicleType>(profile.vehicle?.type ?? 'motorbike');
  const [vDetail, setVDetail] = useState(profile.vehicle?.make ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Verification-status-aware copy for the waiting step.
  const vs = profile.verification_status;
  const blocked = vs === 'suspended' || vs === 'banned';
  const firstName = name.trim() ? `, ${name.trim().split(' ')[0]}` : '';
  const waitingTitle = blocked
    ? vs === 'banned'
      ? 'Account blocked'
      : 'Account on hold'
    : vs === 'in_review'
      ? "You're in review"
      : 'Finish getting verified';
  const waitingLead = blocked
    ? vs === 'banned'
      ? 'Your account has been blocked. Contact urAfro ops if you think this is a mistake.'
      : 'Your account is on hold. Message urAfro ops to sort it out.'
    : vs === 'in_review'
      ? `Thanks${firstName} — the urAfro team is checking your documents, usually within a day. You'll go on shift the moment you're cleared.`
      : `Almost there${firstName} — add the items below and the urAfro team will verify you, usually within a day.`;

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
      animateNext('base'); // B3: step swap cross-fades, not a silent pop
      setStep('profile');
    }
  }, []);

  const saveDetails = useCallback(async () => {
    if (name.trim().length < 2) {
      haptics.error();
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
      haptics.success(); // details are in — moving to the verification gate
      animateNext('base');
      setStep('waiting');
      onReload();
    } catch {
      haptics.error();
      setError('Could not save — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [token, name, vType, vDetail, onReload]);

  // Manual re-check from the waiting gate. Awaits the root's profile re-fetch so the
  // button shows a real "Checking…" state. If we're still on this screen afterwards,
  // ops hasn't cleared us yet (a `verified` status swaps the whole flow out for the
  // tabbed app, unmounting this) — so surface a "still under review" acknowledgement
  // rather than leaving the tap looking like it did nothing.
  const recheck = useCallback(async () => {
    setChecking(true);
    setNotice(null);
    try {
      await onReload();
      setNotice("Still under review — we'll let you know the moment you're cleared.");
    } finally {
      setChecking(false);
    }
  }, [onReload]);

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
          <PrimaryButton
            label="Get started"
            onPress={() => {
              animateNext('base');
              setStep('permissions');
            }}
          />
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
                  onPress={() => {
                    haptics.tap(); // selection tick
                    // the make/model field shows/hides across the 'foot' boundary
                    if ((vType === 'foot') !== (v.id === 'foot')) animateNext('base');
                    setVType(v.id);
                  }}
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
        // waiting / verification gate — status-aware
        <View style={styles.section}>
          <View style={styles.reviewBadge}>
            <Feather
              name={blocked ? 'slash' : 'clock'}
              size={36}
              strokeWidth={1.5}
              color={blocked ? colors.danger : colors.warning}
            />
          </View>
          <Text style={styles.title}>{waitingTitle}</Text>
          <Text style={styles.lead}>{waitingLead}</Text>

          {blocked ? null : <VerificationCard token={token} onChange={onReload} />}

          <Pressable
            style={styles.editRow}
            onPress={() => {
              animateNext('base');
              setStep('profile');
            }}
            hitSlop={8}
          >
            <Feather name="edit-2" size={16} strokeWidth={1.5} color={colors.textMuted} />
            <Text style={styles.editText}>Edit your name or vehicle</Text>
          </Pressable>

          <PrimaryButton label={checking ? 'Checking…' : 'Check again'} onPress={() => void recheck()} busy={checking} />
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

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

function PrimaryButton({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable style={[styles.button, busy && styles.buttonBusy]} onPress={onPress} disabled={busy}>
      {busy ? <ActivityIndicator color={colors.btnPrimaryText} /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

// Text styles from the shared type scale (typography.*); spacing/radii from tokens.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.xxl, paddingTop: 64, paddingBottom: 40, gap: space.xxl },

  header: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  brandMark: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.notificationAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: { ...typography.title, fontSize: 24, lineHeight: 30, color: colors.surface },
  brandTitleGroup: { flex: 1 },
  brandTitle: { ...typography.title, color: colors.textPrimary },
  brandSub: { ...typography.callout, color: colors.textMuted, marginTop: 2 },

  dots: { flexDirection: 'row', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { width: 24, backgroundColor: colors.tabActive },
  dotDone: { backgroundColor: colors.tabActive },

  section: { gap: space.lg },
  title: { ...typography.title, fontSize: 24, lineHeight: 30, color: colors.textPrimary },
  lead: { ...typography.subheading, fontWeight: '400', lineHeight: 23, color: colors.textMuted },

  bullets: { gap: space.lg, marginTop: space.xs },
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
  bulletTitle: { ...typography.subheading, fontWeight: '700', color: colors.textPrimary },
  bulletBody: { ...typography.body, lineHeight: 21, color: colors.textMuted, marginTop: 2 },

  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, ...shadow.card },
  permHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  permTitle: { ...typography.subheading, fontWeight: '700', color: colors.textPrimary },
  permBody: { ...typography.body, lineHeight: 21, color: colors.textMuted, marginTop: space.sm },

  label: { ...typography.callout, fontWeight: '700', color: colors.textPrimary },
  labelGap: { marginTop: space.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
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
  detailGap: { marginTop: space.sm },
  input: {
    minHeight: 48,
    backgroundColor: colors.inputBg,
    color: colors.textPrimary,
    fontSize: 16,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: space.md,
    marginTop: space.sm,
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
  editRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: space.xs },
  editText: { ...typography.body, color: colors.textMuted, textDecorationLine: 'underline' },

  button: {
    backgroundColor: colors.btnPrimaryBg,
    borderRadius: radius.pill,
    minHeight: 48,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xs,
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { ...typography.subheading, fontWeight: '700', color: colors.btnPrimaryText },

  error: { ...typography.body, fontWeight: '700', lineHeight: 21, color: colors.danger },
  notice: { ...typography.callout, color: colors.textMuted, textAlign: 'center' },

  footer: { marginTop: space.sm, gap: space.lg, alignItems: 'center' },
  opsRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  link: { ...typography.body, color: colors.textMuted },
});
