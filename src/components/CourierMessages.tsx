import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { ApiError, sendCourierMessage, type CourierMessageTemplate } from '../lib/api';
import { money } from '../lib/format';
import { waUrl } from '../lib/links';
import { colors, iconSize, PILL, radius, shadow, space } from '../theme';
import { Text, useToast } from './ui';

// The courier's coordination surface for the customer, on the delivery leg.
//
// DECIDED 2026-08-08 (D6 of the 2026-08 readiness audit, register #47 — the founder
// approved the recommendation: build the UI slice). `POST /driver/deliveries/:id/message`
// had been shipped, contract-frozen and audited for months with NO consumer: couriers
// coordinated over WhatsApp deep links instead, which hand the recipient the courier's
// real number on every message. D5 recorded that masked calling (ADR-042) stays deferred,
// so routing the routine messages through the platform's own SMS rail is the cheapest
// mitigation available: four fixed templates, sent BY URAFRO, so the courier's number
// stays out of the routine cases. It does not close the leak — a phone call still shows
// caller ID, and `cant_find` deliberately carries the courier's number so a
// feature-phone recipient can call back — so the copy below says so rather than
// promising privacy the system does not deliver.
//
// The WhatsApp quick-replies were MOVED here from the contact card rather than deleted:
// the SMS rail is gated on RECIPIENT_SMS_ENABLED (a real per-message cost), so when it
// is off WhatsApp is the courier's only channel and deleting it would strand them. It
// now sits below the templates, labelled with what it costs the courier in privacy.
//
// Deliberately NOT queued offline (unlike the lifecycle actions in src/lib/queue.ts): a
// coordination text is only true at the moment it is sent. "Arriving now" replayed ten
// minutes later, after the handover, is a lie to the customer. A failed send says so and
// waits for the courier to tap again.

type SendState = 'sending' | 'sent' | 'failed';

// How long a just-sent template stays locked. Long enough that a fumbled second tap on a
// moped cannot text the customer twice, short enough that a courier who is STILL late can
// legitimately say so again.
const RESEND_LOCK_MS = 60_000;

// One-way, fixed-text templates (contract enum CourierMessageTemplate). The label says
// what the customer will read, because the courier cannot edit it.
const TEMPLATES: {
  template: CourierMessageTemplate;
  icon: keyof typeof Feather.glyphMap;
  label: string;
}[] = [
  { template: 'arriving', icon: 'navigation', label: 'Arriving now' },
  { template: 'running_late', icon: 'clock', label: 'Running late' },
  { template: 'cant_find', icon: 'map-pin', label: "Can't find the address" },
];

// One-tap WhatsApp replies (moved from the contact card). Kept as the fallback channel.
const QUICK_REPLIES = ["I'm outside", '5 minutes away', "Can't find you, call me?"];

export default function CourierMessages({
  jobId,
  token,
  collectMinor,
  phone,
}: {
  jobId: string;
  token: string;
  /** Cash still due at the door, in minor units. 0 hides the COD template: the server
   *  400s `cod_reminder` with nothing to collect, and "have cash ready" on a prepaid
   *  order is a lie to the customer. */
  collectMinor: number;
  /** The recipient's number — powers the WhatsApp fallback only. The templates need no
   *  number here: the platform reads the recipient off the delivery and sends the SMS. */
  phone?: string;
}) {
  const toast = useToast();
  const [state, setState] = useState<Partial<Record<CourierMessageTemplate, SendState>>>({});
  // The last failure, spelled out in place. A toast alone would vanish before a courier
  // who was watching the road could read it.
  const [error, setError] = useState<string | null>(null);
  // Set when the server tells us NOTHING will send for this job (the cost gate is off, or
  // the order carries no recipient number). The templates then come off the screen instead
  // of pretending to work — the only honest read of `sent: false`.
  const [unavailable, setUnavailable] = useState<string | null>(null);

  // Re-entry guard read and written SYNCHRONOUSLY. A double tap lands both presses in the
  // same frame, before React has re-rendered with `sending`, so the `disabled` prop and
  // the state check below cannot stop the second one on their own — this ref can.
  const inFlight = useRef<CourierMessageTemplate | null>(null);
  const alive = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    return () => {
      alive.current = false;
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
  }, []);

  const items = [
    ...TEMPLATES,
    ...(collectMinor > 0
      ? [
          {
            template: 'cod_reminder' as CourierMessageTemplate,
            icon: 'dollar-sign' as keyof typeof Feather.glyphMap,
            label: `Have ${money(collectMinor)} cash ready`,
          },
        ]
      : []),
  ];

  const send = (template: CourierMessageTemplate, label: string): void => {
    // Already sending something, or this one is sent and still locked: do nothing.
    if (inFlight.current != null) return;
    if (state[template] === 'sending' || state[template] === 'sent') return;
    inFlight.current = template;
    setError(null);
    setState((s) => ({ ...s, [template]: 'sending' }));

    void (async () => {
      try {
        const res = await sendCourierMessage(token, jobId, template);
        if (!alive.current) return;
        if (res.sent) {
          setState((s) => ({ ...s, [template]: 'sent' }));
          toast.success('Text sent to the customer');
          const t = setTimeout(() => {
            if (!alive.current) return;
            setState((s) => (s[template] === 'sent' ? { ...s, [template]: undefined } : s));
          }, RESEND_LOCK_MS);
          timers.current.push(t);
          return;
        }
        // 200, and nobody was texted. Never dress this as a success.
        if (res.reason === 'disabled') {
          setState((s) => ({ ...s, [template]: undefined }));
          setUnavailable(
            'URAFRO texts are switched off right now, so nothing was sent. Call the customer, or use WhatsApp below.',
          );
          toast.warning('Texts are off right now');
        } else if (res.reason === 'no_recipient_phone') {
          setState((s) => ({ ...s, [template]: undefined }));
          setUnavailable('This order has no phone number for the customer, so no text can be sent.');
          toast.warning('No number on this order');
        } else {
          // send_failed (or a reason a newer server adds that this build has never heard
          // of): the rail hiccupped, so keep the template and let the courier retry.
          setState((s) => ({ ...s, [template]: 'failed' }));
          setError(`"${label}" did not send. Tap it again to retry.`);
          toast.error('Text not sent');
        }
      } catch (e) {
        if (!alive.current) return;
        setState((s) => ({ ...s, [template]: 'failed' }));
        setError(
          e instanceof ApiError && e.status === 409
            ? 'This job is already finished, so no more texts can go out.'
            : e instanceof ApiError && e.status >= 400 && e.status < 500
              ? `"${label}" could not be sent for this job.`
              : `"${label}" did not send. Check your signal and tap it again.`,
        );
        toast.error('Text not sent');
      } finally {
        inFlight.current = null;
      }
    })();
  };

  const sending = Object.values(state).includes('sending');

  return (
    <View style={styles.card}>
      <Text variant="label" color="tabActive" style={styles.eyebrow}>
        Tell the customer
      </Text>

      {unavailable ? (
        <Text variant="body" color="textMuted" style={styles.note}>
          {unavailable}
        </Text>
      ) : (
        <>
          <Text variant="callout" color="textMuted" style={styles.note}>
            One tap sends a fixed text from URAFRO, so your own number stays off it. Only &quot;Can&apos;t find the
            address&quot; passes on your number, so the customer can call you back.
          </Text>
          <View style={styles.chipRow}>
            {items.map((item) => {
              const s = state[item.template];
              const locked = s === 'sending' || s === 'sent';
              return (
                <Pressable
                  key={item.template}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: locked || sending, busy: s === 'sending' }}
                  style={[styles.chip, s === 'sent' && styles.chipSent, (locked || sending) && styles.chipDim]}
                  disabled={locked || sending}
                  onPress={() => send(item.template, item.label)}
                >
                  <View style={styles.chipInner}>
                    {s === 'sending' ? (
                      <ActivityIndicator size="small" color={colors.textPrimary} />
                    ) : (
                      <Feather
                        name={s === 'sent' ? 'check' : s === 'failed' ? 'alert-circle' : item.icon}
                        size={iconSize.sm}
                        color={s === 'sent' ? colors.success : s === 'failed' ? colors.danger : colors.textPrimary}
                        aria-hidden
                      />
                    )}
                    <Text variant="callout" color={s === 'sent' ? 'textMuted' : 'textPrimary'}>
                      {s === 'sending' ? 'Sending…' : s === 'sent' ? `Sent: ${item.label}` : item.label}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {error ? (
            <Text variant="bodyStrong" color="danger" style={styles.note}>
              {error}
            </Text>
          ) : null}
        </>
      )}

      {phone ? (
        <>
          <View style={styles.divider} />
          <Text variant="callout" color="textFaint">
            Or message them yourself on WhatsApp. That one shows the customer your number.
          </Text>
          <View style={styles.chipRow}>
            {QUICK_REPLIES.map((m) => (
              <Pressable
                key={m}
                accessibilityRole="button"
                style={styles.waChip}
                onPress={() => void Linking.openURL(waUrl(phone, m))}
              >
                <View style={styles.chipInner}>
                  <Feather name="message-circle" size={iconSize.sm} color={colors.textPrimary} aria-hidden />
                  <Text variant="callout" color="textPrimary">
                    {m}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    ...shadow.card,
  },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 1 },
  note: { marginTop: space.sm },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  // The platform-sent templates lead: a filled chip, 48pt tall for a one-handed tap.
  chip: {
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: PILL,
    paddingHorizontal: space.md,
  },
  chipSent: { backgroundColor: colors.successBg },
  chipDim: { opacity: 0.6 },
  // The WhatsApp fallback is quieter than the templates above it: an outline, not a fill.
  waChip: {
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderRadius: PILL,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
  },

  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: space.lg },
});
