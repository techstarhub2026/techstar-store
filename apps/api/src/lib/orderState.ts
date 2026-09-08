import { InvalidStateTransitionError } from './errors.js';

/**
 * Order lifecycle. Three independent axes (spec §12.7): this is the lifecycle
 * one. Payment and fulfilment move on their own.
 *
 * Nothing anywhere may write orders.status directly — every change goes
 * through assertTransition, and every accepted change writes an order_events
 * row. The state machine is the only door.
 */
export const ORDER_STATES = [
  'awaiting_payment',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
  'expired',
  'refunded',
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

const TRANSITIONS: Record<OrderState, OrderState[]> = {
  awaiting_payment: ['confirmed', 'cancelled', 'expired'],
  confirmed: ['processing', 'shipped', 'cancelled', 'refunded'],
  processing: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['completed', 'refunded'],
  completed: ['refunded'],
  cancelled: [],
  expired: [],
  refunded: [],
};

export const TERMINAL: OrderState[] = ['completed', 'cancelled', 'expired', 'refunded'];

export function canTransition(from: string, to: string): boolean {
  const list = TRANSITIONS[from as OrderState];
  return Boolean(list?.includes(to as OrderState));
}

export function assertTransition(from: string, to: string): void {
  if (!canTransition(from, to)) throw new InvalidStateTransitionError(from, to);
}

export function nextStates(from: string): OrderState[] {
  return TRANSITIONS[from as OrderState] ?? [];
}

export const PAYMENT_STATES = [
  'unpaid',
  'pending_verification',
  'paid',
  'partially_refunded',
  'refunded',
  'failed',
] as const;

export const FULFILMENT_STATES = [
  'unfulfilled',
  'processing',
  'shipped',
  'delivered',
  'returned',
] as const;

/** Customer-facing wording for each lifecycle state. */
export const STATE_LABELS: Record<OrderState, string> = {
  awaiting_payment: 'Awaiting payment',
  confirmed: 'Confirmed',
  processing: 'Being prepared',
  shipped: 'On the way',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
  refunded: 'Refunded',
};

/** The tone a status pill uses, matching the design tokens in spec §5.2.3. */
export const STATE_TONES: Record<OrderState, string> = {
  awaiting_payment: 'warning',
  confirmed: 'info',
  processing: 'info',
  shipped: 'primary',
  delivered: 'success',
  completed: 'success',
  cancelled: 'danger',
  expired: 'danger',
  refunded: 'danger',
};
