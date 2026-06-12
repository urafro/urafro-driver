import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  ApiError,
  addPayoutMethod,
  getPayoutMethods,
  setDefaultPayoutMethod,
  type PayoutMethod,
} from '../lib/api';
import { colors, shadow, PILL } from '../theme';

type Kind = 'ecocash' | 'bank';

/**
 * Payout-method management (ADR-003 P2). Lists the driver's saved methods (masked)
 * and lets them add an EcoCash line or bank account + pick a default. The account
 * number is encrypted server-side; only a masked tail ever comes back. Actual
 * disbursement stays ops-run during the pilot — this is where the driver tells ops
 * WHERE to send it. Degrades honestly to "opens soon" if the backend isn't
 * configured (503).
 */
export default function PayoutMethods({ token, onChange }: { token: string; onChange?: () => void }) {
  const [methods, setMethods] = useState<PayoutMethod[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Kind>('ecocash');
  const [accountRef, setAccountRef] = useState('');
  const [holder, setHolder] = useState('');
  const [bank, setBank] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMethods((await getPayoutMethods(token)).data);
    } catch {
      setMethods([]);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = () => {
    setAdding(false);
    setAccountRef('');
    setHolder('');
    setBank('');
  };

  const onAdd = useCallback(async () => {
    if (accountRef.trim().length < 4 || holder.trim().length < 2) {
      setNote('Enter the account number and the name on the account.');
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await addPayoutMethod(token, {
        kind,
        account_ref: accountRef.trim(),
        holder_name: holder.trim(),
        bank_name: kind === 'bank' ? bank.trim() || undefined : undefined,
      });
      reset();
      await load();
      onChange?.();
    } catch (e) {
      setNote(
        e instanceof ApiError && e.status === 503
          ? 'Payouts open soon — the team will set this up shortly.'
          : 'Could not save — check your details and try again.',
      );
    } finally {
      setBusy(false);
    }
  }, [token, kind, accountRef, holder, bank, load, onChange]);

  const onSetDefault = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await setDefaultPayoutMethod(token, id);
        await load();
        onChange?.();
      } catch {
        setNote('Could not update — try again.');
      } finally {
        setBusy(false);
      }
    },
    [token, load, onChange],
  );

  return (
    <View style={styles.card}>
      <View style={styles.rowHead}>
        <Feather name="credit-card" size={18} strokeWidth={1.5} color={colors.tabActive} />
        <Text style={styles.cardLabel}>Payout method</Text>
      </View>

      {methods === null ? (
        <ActivityIndicator color={colors.tabActive} style={styles.loading} />
      ) : methods.length === 0 ? (
        <Text style={styles.muted}>Add where you want your earnings paid. Ops sends to your default.</Text>
      ) : (
        methods.map((m) => (
          <View key={m.id} style={styles.method}>
            <Feather
              name={m.kind === 'bank' ? 'home' : 'smartphone'}
              size={18}
              strokeWidth={1.5}
              color={colors.textMuted}
            />
            <View style={styles.methodBody}>
              <Text style={styles.methodLabel}>
                {m.kind === 'bank' ? m.bank_name || 'Bank' : 'EcoCash'} · {m.account_ref_mask}
              </Text>
              <Text style={styles.methodSub}>{m.holder_name}</Text>
            </View>
            {m.is_default ? (
              <View style={styles.defaultBadge}>
                <Text style={styles.defaultBadgeText}>Default</Text>
              </View>
            ) : (
              <Pressable onPress={() => void onSetDefault(m.id)} hitSlop={8} disabled={busy}>
                <Text style={styles.setDefault}>Set default</Text>
              </Pressable>
            )}
          </View>
        ))
      )}

      {adding ? (
        <View style={styles.form}>
          <View style={styles.chips}>
            {(['ecocash', 'bank'] as Kind[]).map((k) => (
              <Pressable
                key={k}
                style={[styles.chip, kind === k && styles.chipActive]}
                onPress={() => setKind(k)}
              >
                <Text style={[styles.chipText, kind === k && styles.chipTextActive]}>
                  {k === 'ecocash' ? 'EcoCash' : 'Bank'}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={accountRef}
            onChangeText={setAccountRef}
            placeholder={kind === 'ecocash' ? 'EcoCash number — +263 77…' : 'Account number'}
            placeholderTextColor={colors.placeholder}
            keyboardType={kind === 'ecocash' ? 'phone-pad' : 'number-pad'}
            maxLength={40}
          />
          {kind === 'bank' ? (
            <TextInput
              style={[styles.input, styles.inputGap]}
              value={bank}
              onChangeText={setBank}
              placeholder="Bank name — e.g. CBZ"
              placeholderTextColor={colors.placeholder}
              maxLength={80}
            />
          ) : null}
          <TextInput
            style={[styles.input, styles.inputGap]}
            value={holder}
            onChangeText={setHolder}
            placeholder="Name on the account"
            placeholderTextColor={colors.placeholder}
            maxLength={120}
          />
          <View style={styles.formActions}>
            <Pressable onPress={reset} hitSlop={8} disabled={busy}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.saveBtn, busy && styles.busy]} onPress={() => void onAdd()} disabled={busy}>
              <Text style={styles.saveBtnText}>{busy ? 'Saving…' : 'Save method'}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable style={styles.addBtn} onPress={() => setAdding(true)}>
          <Feather name="plus" size={16} strokeWidth={1.5} color={colors.tabActive} />
          <Text style={styles.addBtnText}>Add payout method</Text>
        </Pressable>
      )}

      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, marginTop: 16, ...shadow.card },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  muted: { color: colors.textFaint, fontSize: 14, lineHeight: 20 },
  loading: { alignSelf: 'flex-start', marginVertical: 8 },

  method: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  methodBody: { flex: 1 },
  methodLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  methodSub: { color: colors.textFaint, fontSize: 13, marginTop: 1 },
  defaultBadge: { backgroundColor: colors.surfaceAlt, borderRadius: PILL, paddingHorizontal: 12, paddingVertical: 6 },
  defaultBadgeText: { color: colors.tabActive, fontSize: 12, fontWeight: '700' },
  setDefault: { color: colors.textMuted, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },

  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  addBtnText: { color: colors.tabActive, fontSize: 15, fontWeight: '700' },

  form: { marginTop: 12 },
  chips: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  chip: { borderRadius: PILL, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 8 },
  chipActive: { backgroundColor: colors.tabActive, borderColor: colors.tabActive },
  chipText: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  chipTextActive: { color: colors.surface },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  inputGap: { marginTop: 8 },
  formActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 16, marginTop: 12 },
  cancel: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },
  saveBtn: { backgroundColor: colors.btnPrimaryBg, borderRadius: PILL, paddingHorizontal: 20, paddingVertical: 10 },
  busy: { opacity: 0.6 },
  saveBtnText: { color: colors.btnPrimaryText, fontSize: 15, fontWeight: '700' },

  note: { color: colors.textMuted, fontSize: 14, marginTop: 10, lineHeight: 20 },
});
