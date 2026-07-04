// Snackbar / toast — the shared acknowledgment channel. Every "that worked"
// (order collected, saved, counter sent) and every soft failure routes through
// here instead of a per-screen inline <Text>. Non-blocking: it floats above
// content, only the toast itself is touchable (the rest of the screen stays live),
// and it auto-dismisses. One is shown at a time; extras queue. Firing a toast also
// fires the matching haptic, so an ack is felt as well as seen.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, iconSize, radius, shadow, space } from '../../theme';
import Text from './Text';
import { haptics } from '../../lib/haptics';
import { useReducedMotion } from '../../lib/reduce-motion';

export type ToastKind = 'success' | 'error' | 'warning' | 'info' | 'offline';

export type ToastOptions = {
  kind?: ToastKind;
  message: string;
  action?: { label: string; onPress: () => void };
  /** ms visible; 0 = sticky until dismissed (superseded when a new toast arrives). Defaults per kind. */
  duration?: number;
};

export type ToastApi = {
  show: (o: ToastOptions) => void;
  success: (message: string, o?: Partial<ToastOptions>) => void;
  error: (message: string, o?: Partial<ToastOptions>) => void;
  warning: (message: string, o?: Partial<ToastOptions>) => void;
  info: (message: string, o?: Partial<ToastOptions>) => void;
  dismiss: () => void;
};

type InternalToast = { id: number; kind: ToastKind; message: string; duration: number; action?: ToastOptions['action'] };

const META: Record<
  ToastKind,
  { icon: keyof typeof Feather.glyphMap; accent: keyof typeof colors; haptic: () => void; live: 'polite' | 'assertive' }
> = {
  success: { icon: 'check-circle', accent: 'success', haptic: haptics.success, live: 'polite' },
  error: { icon: 'alert-circle', accent: 'danger', haptic: haptics.error, live: 'assertive' },
  warning: { icon: 'alert-triangle', accent: 'warning', haptic: haptics.warning, live: 'polite' },
  info: { icon: 'info', accent: 'info', haptic: haptics.tap, live: 'polite' },
  offline: { icon: 'wifi-off', accent: 'textSecondary', haptic: haptics.warning, live: 'polite' },
};

const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 2600,
  error: 4200,
  warning: 3600,
  info: 3000,
  offline: 4000, // persistent offline STATUS is the OfflineBanner's job — a toast is transient
};

const NOOP: ToastApi = {
  show: () => {},
  success: () => {},
  error: () => {},
  warning: () => {},
  info: () => {},
  dismiss: () => {},
};

const ToastContext = createContext<ToastApi | null>(null);

// Access the toast API. Returns no-ops (never crashes) if no provider is mounted,
// but warns in dev so a forgotten <ToastProvider> doesn't silently swallow acks.
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx && __DEV__) {
    console.warn('useToast() called with no <ToastProvider> ancestor — toasts are no-ops.');
  }
  return ctx ?? NOOP;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<InternalToast[]>([]);
  const [visible, setVisible] = useState(false);
  const idRef = useRef(0);
  const current = queue[0] ?? null;
  // Mirror the visible head's duration so `show` can supersede a sticky head.
  const headDurationRef = useRef<number | null>(null);
  headDurationRef.current = current ? current.duration : null;

  const show = useCallback((o: ToastOptions) => {
    const kind = o.kind ?? 'info';
    const t: InternalToast = {
      id: ++idRef.current,
      kind,
      message: o.message,
      duration: o.duration ?? DEFAULT_DURATION[kind],
      action: o.action,
    };
    // A sticky (duration 0) head would block the queue forever — dismiss it so this
    // fresh toast still gets shown.
    if (headDurationRef.current === 0) setVisible(false);
    setQueue((q) => [...q, t]);
  }, []);

  const dismiss = useCallback(() => setVisible(false), []);
  const onExited = useCallback(() => setQueue((q) => q.slice(1)), []);

  // A newly-arrived head becomes visible.
  useEffect(() => {
    if (current) setVisible(true);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message, o) => show({ ...o, kind: 'success', message }),
      error: (message, o) => show({ ...o, kind: 'error', message }),
      warning: (message, o) => show({ ...o, kind: 'warning', message }),
      info: (message, o) => show({ ...o, kind: 'info', message }),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastHost toast={current} visible={visible} onDismiss={dismiss} onExited={onExited} />
    </ToastContext.Provider>
  );
}

function ToastHost({
  toast,
  visible,
  onDismiss,
  onExited,
}: {
  toast: InternalToast | null;
  visible: boolean;
  onDismiss: () => void;
  onExited: () => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const hapticedId = useRef<number | null>(null);
  const mounted = useRef(true);
  const reduce = useReducedMotion();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      anim.stopAnimation();
    };
  }, [anim]);

  useEffect(() => {
    if (visible && toast) {
      if (hapticedId.current !== toast.id) {
        hapticedId.current = toast.id;
        META[toast.kind].haptic();
      }
      if (reduce) anim.setValue(1);
      else Animated.spring(anim, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 200 }).start();
      if (toast.duration > 0) {
        const id = setTimeout(onDismiss, toast.duration);
        return () => clearTimeout(id);
      }
      return;
    }
    if (reduce) {
      anim.setValue(0);
      if (mounted.current) onExited();
      return;
    }
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
      if (finished && mounted.current) onExited();
    });
  }, [visible, toast?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!toast) return null;
  const m = META[toast.kind];
  return (
    <View pointerEvents="box-none" style={styles.host}>
      <Animated.View
        accessibilityLiveRegion={m.live}
        accessibilityRole="alert"
        style={[
          styles.toast,
          shadow.card,
          {
            opacity: anim,
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
          },
        ]}
      >
        <View style={[styles.accent, { backgroundColor: colors[m.accent] }]} />
        <Feather name={m.icon} size={iconSize.md} color={colors[m.accent]} />
        <Text variant="callout" color="textPrimary" style={styles.msg} numberOfLines={3}>
          {toast.message}
        </Text>
        {toast.action ? (
          <Pressable
            style={styles.tapTarget}
            onPress={() => {
              toast.action?.onPress();
              onDismiss();
            }}
            accessibilityRole="button"
          >
            <Text variant="label" color="tabActive">
              {toast.action.label}
            </Text>
          </Pressable>
        ) : (
          <Pressable style={styles.tapTarget} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss">
            <Feather name="x" size={iconSize.sm} color={colors.textFaint} />
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // box-none so touches pass through the wrapper; only the toast card is touchable.
  // bottom offset clears a typical bottom tab bar; tuned per screen when wired.
  host: { position: 'absolute', left: 0, right: 0, bottom: 84, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    maxWidth: 520,
    width: '92%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    overflow: 'hidden',
  },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  msg: { flex: 1, paddingVertical: space.xs },
  // 44x44 minimum touch target for one-handed, possibly-moving use.
  tapTarget: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
});

export default ToastProvider;
