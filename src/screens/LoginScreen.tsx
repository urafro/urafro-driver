import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { ApiError, requestOtp, verifyOtp } from '../lib/api';
import { shouldRetry } from '../lib/queue';
import { toE164 } from '../lib/phone';
import { useSession } from '../state/session';
import { colors, typography, space, radius } from '../theme';
import { Text } from '../components/ui';
import { animateNext } from '../lib/motion';
import { haptics } from '../lib/haptics';

// Two-step OTP login: enter phone → request code → enter the 6-digit code →
// verify → mint a driver token and sign in. The session change re-renders the
// app root into the Home screen, so there's no manual navigation here.
export default function LoginScreen() {
  const { signIn } = useSession();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  // The field holds only the LOCAL part — the +263 lives in the prefix chip, so
  // there's no "+263 +263" duplication. toE164 prepends the country code.
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(): Promise<void> {
    const e164 = toE164(phoneInput);
    if (!e164) {
      haptics.error();
      setError('Enter a valid phone number');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      try {
        await requestOtp(e164);
      } catch (e) {
        // The backend (or its DB) may have been idle: the first request wakes it but
        // can time out on the cold start. Retry ONCE after a beat — the retry hits a
        // warm server. Only for TRANSIENT failures (timeout / 5xx); a 4xx like 429
        // (rate-limited) is terminal and rethrows immediately.
        if (!shouldRetry(e)) throw e;
        setError('Waking things up — one moment…');
        await new Promise((r) => setTimeout(r, 2000));
        await requestOtp(e164);
      }
      setError(null);
      setPhone(e164);
      haptics.success(); // tactile "code's on its way"
      animateNext('base'); // B3: phone → code step cross-fades, not a silent pop
      setStep('code');
    } catch (e) {
      haptics.error();
      if (e instanceof ApiError && e.status === 429) {
        setError('Too many attempts — wait a minute and try again.');
      } else if (e instanceof ApiError) {
        setError('Could not send the code — please try again.');
      } else {
        setError('No connection — check your signal and try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(): Promise<void> {
    if (!/^\d{6}$/.test(code)) {
      haptics.error();
      setError('Enter the 6-digit code');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { token, driver_id } = await verifyOtp(phone, code);
      haptics.success(); // verified — the session change swaps the app to Home
      await signIn({ token, driverId: driver_id });
    } catch (e) {
      haptics.error();
      setError(
        e instanceof ApiError && e.status === 401
          ? 'Incorrect or expired code — try again or request a new one.'
          : 'Verification failed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>u.</Text>
        </View>
        <View style={styles.brandTitleGroup}>
          <Text style={styles.title}>urAfro Driver</Text>
          <Text style={styles.subtitle}>Deliver around Harare. Earn in USD.</Text>
        </View>
      </View>

      {step === 'phone' ? (
        <View style={styles.section}>
          <Text style={styles.label}>Your phone number</Text>
          <View style={styles.inputRow}>
            <View style={styles.prefix}>
              <Text style={styles.prefixText}>+263</Text>
            </View>
            <TextInput
              style={[styles.input, styles.inputFlex]}
              value={phoneInput}
              onChangeText={(v) =>
                // Keep the field local: drop anything but digits/spaces and strip a
                // leading country code / trunk zero a driver might still type
                // (263…, 0263…, 0…), so the +263 chip is never duplicated.
                setPhoneInput(v.replace(/[^\d ]/g, '').replace(/^(0?263|0)\s*/, '').slice(0, 12))
              }
              keyboardType="phone-pad"
              autoFocus
              placeholder="77 123 4567"
              placeholderTextColor={colors.placeholder}
            />
          </View>
          <Text style={styles.helper}>
            We&apos;ll text you a 6-digit code — SMS is free. Just your number; we
            add the +263.
          </Text>
          <SubmitButton label="Send code" onPress={sendCode} busy={busy} />
        </View>
      ) : (
        <View style={styles.section}>
          <View>
            <Text style={styles.stepHeading}>Enter the code</Text>
            <Text style={styles.stepSub}>Sent by SMS to {phone}</Text>
          </View>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            placeholder="000000"
            placeholderTextColor={colors.placeholder}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <SubmitButton label="Verify" onPress={confirmCode} busy={busy} />
          <View style={styles.linkRow}>
            <Pressable
              onPress={() => {
                animateNext('base');
                setStep('phone');
                setCode('');
                setError(null);
              }}
              hitSlop={8}
            >
              <Text style={styles.link}>Edit number</Text>
            </Pressable>
            <Pressable onPress={sendCode} disabled={busy} hitSlop={8}>
              <Text style={[styles.link, busy && styles.linkDisabled]}>
                Resend code
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {step === 'phone' && error ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function SubmitButton({
  label,
  onPress,
  busy,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
}) {
  return (
    <Pressable
      style={[styles.button, busy && styles.buttonDisabled]}
      onPress={onPress}
      disabled={busy}
    >
      {busy ? (
        <ActivityIndicator color={colors.btnPrimaryText} />
      ) : (
        <Text style={styles.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

// Text styles from the shared type scale (typography.*); spacing/radii from tokens.
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    padding: space.xxl,
    gap: space.xxl,
  },
  // Branded "u." header — purple mark + title + tagline.
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
  title: { ...typography.title, fontSize: 24, lineHeight: 30, color: colors.textPrimary },
  subtitle: { ...typography.callout, color: colors.textMuted, marginTop: 2 },

  section: { gap: space.lg },
  label: { ...typography.callout, fontWeight: '700', color: colors.textPrimary },
  helper: { ...typography.callout, color: colors.textMuted },

  inputRow: { flexDirection: 'row', gap: space.sm },
  prefix: {
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  prefixText: { ...typography.subheading, fontWeight: '700', color: colors.textPrimary },

  input: {
    minHeight: 48,
    backgroundColor: colors.inputBgRaised,
    color: colors.textPrimary,
    fontSize: 16,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  inputFlex: { flex: 1, minWidth: 0 },
  codeInput: {
    letterSpacing: 8,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
  },

  stepHeading: { ...typography.heading, fontSize: 20, lineHeight: 26, color: colors.textPrimary },
  stepSub: { ...typography.subheading, fontWeight: '400', color: colors.textMuted, marginTop: space.xs },

  button: {
    // Brand V1: the gold pill CTA (black text — never white on gold).
    backgroundColor: colors.btnPrimaryBg,
    borderRadius: radius.pill,
    minHeight: 48,
    paddingVertical: 14, // non-grid literal, kept exact (no space token equals 14)
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { ...typography.subheading, fontWeight: '700', color: colors.btnPrimaryText },

  linkRow: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  link: { ...typography.body, color: colors.textMuted, textDecorationLine: 'underline' },
  linkDisabled: { opacity: 0.5 },

  error: {
    ...typography.subheading,
    fontWeight: '700',
    color: colors.danger,
  },
});
