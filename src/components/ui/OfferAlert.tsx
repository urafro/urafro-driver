// The flagship B1 primitive: a NEW-OFFER alert that never hijacks the road.
//
// Salience is primary + non-visual: on arrival it fires a distinct heavy haptic
// and an in-app chime (the OS notification is suppressed mid-run), then drops a
// small, dismissible banner at the top — it does NOT take over the screen and does
// NOT auto-expand. The rich accept/counter/pass card is gated behind the vehicle
// being STOPPED: while moving, tapping the banner shows a "pull over to respond"
// state with no interactive buttons, so the offer can never pull the driver's
// hands/eyes off the road. Fare/COD stay glanceable throughout.
//
// Alert semantics: haptic + chime fire exactly ONCE per offer id. Dismissing the
// banner silences that id for this component's lifetime; a genuinely new id (or a
// re-mount) re-alerts and re-animates in.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, duration, iconSize, PILL, radius, shadow, space, typography } from '../../theme';
import Text from './Text';
import { money } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { playOfferChime } from '../../lib/sound';
import { useReducedMotion } from '../../lib/reduce-motion';

export type OfferAlertData = {
  id: string;
  title?: string;
  fareMinor: number;
  codMinor?: number | null;
  stops?: number | null;
  distanceKm?: number | null;
  expiresInSec?: number | null;
};

export type OfferAlertProps = {
  offer: OfferAlertData | null;
  /** From useIsStopped — while true, the interactive card is gated. */
  moving: boolean;
  onAccept: () => void;
  /** Called with the driver's counter fare in MINOR units (cents), never dollars. */
  onCounter: (amountMinor: number) => void;
  onPass: () => void;
  /** Hide the banner. The offer stays claimable from the list/board. */
  onDismiss: () => void;
};

// Isolated ticking leaf so the per-second countdown re-renders ONLY this text, not
// the whole alert (its Pressables and the counter TextInput).
function Countdown({ seconds, onExpire }: { seconds: number | null; onExpire: () => void }) {
  const [remaining, setRemaining] = useState<number | null>(seconds);
  const fired = useRef(false);

  useEffect(() => {
    setRemaining(seconds);
    fired.current = false;
    if (seconds == null || seconds <= 0) return;
    const iv = setInterval(() => setRemaining((r) => (r == null ? r : Math.max(0, r - 1))), 1000);
    return () => clearInterval(iv);
  }, [seconds]);

  useEffect(() => {
    if (remaining === 0 && !fired.current) {
      fired.current = true;
      onExpire();
    }
  }, [remaining, onExpire]);

  if (remaining == null) return null;
  return (
    <Text variant="caption" color={remaining <= 10 ? 'danger' : 'textFaint'}>
      {remaining}s
    </Text>
  );
}

export function OfferAlert({ offer, moving, onAccept, onCounter, onPass, onDismiss }: OfferAlertProps) {
  const [render, setRender] = useState<OfferAlertData | null>(offer);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'buttons' | 'counter'>('buttons');
  const [counterText, setCounterText] = useState('');
  const [expired, setExpired] = useState(false);
  const enter = useRef(new Animated.Value(0)).current;
  const alertedId = useRef<string | null>(null);
  const mounted = useRef(true);
  const reduce = useReducedMotion();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      enter.stopAnimation();
    };
  }, [enter]);

  // Enter / exit + fire the alert channels once per new offer id.
  useEffect(() => {
    if (offer) {
      setRender(offer);
      if (alertedId.current !== offer.id) {
        alertedId.current = offer.id;
        setExpanded(false);
        setMode('buttons');
        setCounterText('');
        setExpired(false);
        enter.setValue(0); // a genuinely-new offer animates IN even if one was already showing
        haptics.offer();
        void playOfferChime();
      }
      if (reduce) enter.setValue(1);
      else Animated.spring(enter, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 180 }).start();
    } else if (reduce) {
      enter.setValue(0);
      if (mounted.current) {
        setRender(null);
        setExpanded(false);
      }
    } else {
      Animated.timing(enter, { toValue: 0, duration: duration.fast, useNativeDriver: true }).start(({ finished }) => {
        if (finished && mounted.current) {
          setRender(null);
          setExpanded(false);
        }
      });
    }
  }, [offer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExpire = useCallback(() => setExpired(true), []);

  if (!render) return null;

  const submitCounter = () => {
    // Number() (not parseFloat) rejects malformed input like "1.2.3" → NaN rather
    // than silently taking a prefix; the server is still authoritative on the fare.
    const dollars = Number(counterText.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(dollars) || dollars <= 0) return;
    onCounter(Math.round(dollars * 100));
  };

  const meta = [
    render.stops && render.stops > 1 ? `${render.stops} stops` : null,
    render.distanceKm != null ? `${render.distanceKm.toFixed(1)} km` : null,
    render.codMinor ? `${money(render.codMinor)} COD` : null,
  ].filter(Boolean);

  return (
    <View pointerEvents="box-none" style={styles.host}>
      <Animated.View
        style={[
          styles.card,
          shadow.card,
          {
            opacity: enter,
            transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
          },
        ]}
      >
        <View style={[styles.accent, { backgroundColor: colors.btnPrimaryBg }]} />

        {/* Header row: tappable title area + a SIBLING dismiss (not nested, so a
            screen reader can reach "dismiss" independently of "expand"). */}
        <View style={styles.header}>
          <Pressable
            onPress={() => setExpanded((e) => !e)}
            accessibilityRole="button"
            accessibilityLabel={`New run offer, ${money(render.fareMinor)}. ${expanded ? 'Collapse' : 'Expand'}`}
            style={styles.headerMain}
          >
            <View style={styles.bell}>
              <Feather name="bell" size={iconSize.md} color={colors.btnPrimaryText} />
            </View>
            {/* Only this block is an assertive live region — announces once on
                arrival (fare/title change per new id), not on expand or each tick. */}
            <View style={styles.headText} accessibilityLiveRegion="assertive">
              <Text variant="label" color="textMuted">
                {render.title ?? 'New run offer'}
              </Text>
              <Text variant="heading" color="textPrimary">
                {money(render.fareMinor)}
              </Text>
            </View>
            <View style={styles.metaCol}>
              {meta.length > 0 ? (
                <Text variant="caption" color="textFaint" numberOfLines={1} style={styles.metaLine}>
                  {meta.join(' · ')}
                </Text>
              ) : null}
              <Countdown seconds={render.expiresInSec ?? null} onExpire={handleExpire} />
            </View>
            <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={iconSize.md} color={colors.textFaint} />
          </Pressable>
          <Pressable
            style={styles.dismiss}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss offer alert"
          >
            <Feather name="x" size={iconSize.sm} color={colors.textFaint} />
          </Pressable>
        </View>

        {/* Expanded body — one motion gate: `moving` short-circuits before any action. */}
        {expanded ? (
          <View style={styles.body}>
            {moving ? (
              <View style={styles.notice} accessibilityLiveRegion="polite">
                <Feather name="navigation" size={iconSize.md} color={colors.info} />
                <Text variant="callout" color="textSecondary" style={styles.noticeText}>
                  You're moving — pull over to accept, counter or pass. The offer is held.
                </Text>
              </View>
            ) : expired ? (
              <View style={styles.notice}>
                <Feather name="clock" size={iconSize.md} color={colors.textFaint} />
                <Text variant="callout" color="textFaint" style={styles.noticeText}>
                  This offer has expired.
                </Text>
                <Pressable onPress={onDismiss} style={styles.btnGhost} accessibilityRole="button">
                  <Text variant="label" color="textMuted">
                    Dismiss
                  </Text>
                </Pressable>
              </View>
            ) : mode === 'counter' ? (
              <View style={styles.counterRow}>
                <View style={styles.counterInputWrap}>
                  <Text variant="body" color="textMuted">
                    $
                  </Text>
                  <TextInput
                    value={counterText}
                    onChangeText={setCounterText}
                    keyboardType="numeric"
                    autoFocus
                    placeholder="0.00"
                    placeholderTextColor={colors.placeholder}
                    style={styles.counterInput}
                    accessibilityLabel="Your counter fare in dollars"
                    onSubmitEditing={submitCounter}
                    returnKeyType="send"
                  />
                </View>
                <Pressable onPress={submitCounter} style={[styles.btn, styles.btnPrimary]} accessibilityRole="button">
                  <Text variant="label" color="btnPrimaryText">
                    Send
                  </Text>
                </Pressable>
                <Pressable onPress={() => setMode('buttons')} style={styles.btnGhost} accessibilityRole="button">
                  <Text variant="label" color="textMuted">
                    Back
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.actions}>
                <Pressable onPress={onAccept} style={[styles.btn, styles.btnPrimary, styles.grow]} accessibilityRole="button">
                  <Text variant="label" color="btnPrimaryText">
                    Accept · {money(render.fareMinor)}
                  </Text>
                </Pressable>
                <Pressable onPress={() => setMode('counter')} style={[styles.btn, styles.btnSecondary]} accessibilityRole="button">
                  <Text variant="label" color="textPrimary">
                    Counter
                  </Text>
                </Pressable>
                <Pressable onPress={onPass} style={styles.btnGhost} accessibilityRole="button">
                  <Text variant="label" color="textFaint">
                    Pass
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', top: 44, left: 0, right: 0, alignItems: 'center' },
  card: {
    width: '94%',
    maxWidth: 560,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    paddingVertical: space.md,
    overflow: 'hidden',
  },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  header: { flexDirection: 'row', alignItems: 'center' },
  headerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  bell: {
    width: 36,
    height: 36,
    borderRadius: PILL,
    backgroundColor: colors.btnPrimaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: { flexShrink: 0 },
  metaCol: { flex: 1, alignItems: 'flex-end' },
  metaLine: { textAlign: 'right' },
  dismiss: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  body: { marginTop: space.md, paddingRight: space.md },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: space.md,
  },
  noticeText: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
  btn: { height: 44, borderRadius: PILL, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  btnPrimary: { backgroundColor: colors.btnPrimaryBg },
  btnSecondary: { backgroundColor: colors.btnSecondaryBg },
  btnGhost: { height: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  counterInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 44,
    paddingHorizontal: space.md,
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  counterInput: { flex: 1, color: colors.textPrimary, fontSize: typography.subheading.fontSize, padding: 0 },
});

export default OfferAlert;
