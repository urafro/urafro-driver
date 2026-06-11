import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { ApiError, requestOtp, verifyOtp } from '../lib/api';
import { toE164 } from '../lib/phone';
import { useSession } from '../state/session';
import { colors, PILL } from '../theme';

// Two-step OTP login: enter phone → request code → enter the 6-digit code →
// verify → mint a driver token and sign in. The session change re-renders the
// app root into the Home screen, so there's no manual navigation here.
export default function LoginScreen() {
  const { signIn } = useSession();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phoneInput, setPhoneInput] = useState('+263');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(): Promise<void> {
    const e164 = toE164(phoneInput);
    if (!e164) {
      setError('Enter a valid phone number');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestOtp(e164);
      setPhone(e164);
      setStep('code');
    } catch (e) {
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
      setError('Enter the 6-digit code');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { token, driver_id } = await verifyOtp(phone, code);
      await signIn({ token, driverId: driver_id });
    } catch (e) {
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
      <Text style={styles.title}>urAfro Driver</Text>

      {step === 'phone' ? (
        <>
          <Text style={styles.label}>Your phone number</Text>
          <TextInput
            style={styles.input}
            value={phoneInput}
            onChangeText={setPhoneInput}
            keyboardType="phone-pad"
            autoFocus
            placeholder="+263 77 123 4567"
            placeholderTextColor={colors.placeholder}
          />
          <SubmitButton label="Send code" onPress={sendCode} busy={busy} />
        </>
      ) : (
        <>
          <Text style={styles.label}>Enter the code sent to {phone}</Text>
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
          <SubmitButton label="Verify" onPress={confirmCode} busy={busy} />
          <Pressable
            onPress={() => {
              setStep('phone');
              setCode('');
              setError(null);
            }}
          >
            <Text style={styles.link}>Use a different number</Text>
          </Pressable>
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
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
      {busy ? <ActivityIndicator color={colors.btnPrimaryText} /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 },
  title: { color: colors.textPrimary, fontSize: 30, fontWeight: '700', marginBottom: 32 },
  label: { color: colors.textSecondary, fontSize: 15, marginBottom: 8 },
  input: {
    backgroundColor: colors.inputBgRaised,
    color: colors.textPrimary,
    fontSize: 18,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  codeInput: { letterSpacing: 8, textAlign: 'center', fontSize: 24 },
  button: {
    // Brand V1: the gold pill CTA (black text — never white on gold).
    backgroundColor: colors.btnPrimaryBg,
    borderRadius: PILL,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.btnPrimaryText, fontSize: 16, fontWeight: '700' },
  link: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: 18 },
  error: { color: colors.danger, fontSize: 14, marginTop: 16, textAlign: 'center' },
});
