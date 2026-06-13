import { colors } from '../theme';

// Shared job vocabulary for the Jobs tab (the list + the detail sheet), so the two
// surfaces never drift on status labels/colours or failure-reason wording.

export const REASON_LABEL: Record<string, string> = {
  customer_unreachable: 'Customer unreachable',
  wrong_address: 'Wrong address',
  customer_refused: 'Customer refused',
  cash_refused: "Couldn't collect cash",
  vehicle_problem: 'Vehicle problem',
  other: 'Other',
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  delivered: { label: 'Delivered', color: colors.success },
  failed: { label: 'Failed', color: colors.danger },
  cancelled: { label: 'Cancelled', color: colors.textMuted },
  assigned: { label: 'In progress', color: colors.info },
  picked_up: { label: 'In progress', color: colors.info },
  in_transit: { label: 'In progress', color: colors.info },
};

export function statusMeta(status: string | null | undefined): { label: string; color: string } {
  return STATUS_META[status ?? ''] ?? { label: status ?? '—', color: colors.textMuted };
}

/** A mid-flight job routes back to the Shift tab to ACT on it (one action surface);
 *  only terminal jobs open the read-only detail. */
export function isActiveJob(status: string | null | undefined): boolean {
  return status === 'assigned' || status === 'picked_up' || status === 'in_transit';
}
