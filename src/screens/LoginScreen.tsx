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
    } catch {
      setError('Could not send the code — check your connection and try again.');
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
            placeholderTextColor="#475569"
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
            placeholderTextColor="#475569"
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
      {busy ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 30, fontWeight: '700', marginBottom: 32 },
  label: { color: '#cbd5e1', fontSize: 15, marginBottom: 8 },
  input: {
    backgroundColor: '#1e293b',
    color: '#fff',
    fontSize: 18,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  codeInput: { letterSpacing: 8, textAlign: 'center', fontSize: 24 },
  button: {
    backgroundColor: '#22d3ee',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#0f172a', fontSize: 16, fontWeight: '700' },
  link: { color: '#94a3b8', fontSize: 14, textAlign: 'center', marginTop: 18 },
  error: { color: '#fca5a5', fontSize: 14, marginTop: 16, textAlign: 'center' },
});
