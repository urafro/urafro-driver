// The shared UI-primitive layer (UX redesign). Screens consume feedback, steppers,
// alerts, and transitions from HERE — never re-implement them. See docs/design-system.md.
export { Text, type AppTextProps } from './Text';
export { ToastProvider, useToast, type ToastKind, type ToastOptions, type ToastApi } from './Toast';
export { Stepper, type StepperProps } from './Stepper';
export { Skeleton, SkeletonText, type SkeletonProps, type SkeletonTextProps } from './Skeleton';
export { OfflineBanner, type OfflineBannerProps } from './OfflineBanner';
export { Transition, type TransitionProps, type TransitionIntensity } from './Transition';
export { OfferAlert, type OfferAlertData, type OfferAlertProps } from './OfferAlert';
