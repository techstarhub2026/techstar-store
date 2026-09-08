import { prisma } from '../lib/prisma.js';
import { config } from '../config/index.js';

/**
 * Scheduled work. In production these belong on a queue with a real scheduler
 * (spec §17.5); an in-process interval is the right size for a single-node
 * deployment and keeps the development experience to one command.
 */

/**
 * Releases reservations for orders that were never paid. Reserved goods are
 * still on the shelf but not sellable — holding them indefinitely is how a
 * catalogue quietly runs out of stock it actually has. (Spec §12.4)
 */
export async function expireUnpaidReservations() {
  const now = new Date();
  const due = await prisma.order.findMany({
    where: {
      status: 'awaiting_payment',
      reservationExpiresAt: { not: null, lte: now },
    },
    include: { items: true },
    take: 100,
  });

  for (const order of due) {
    try {
      await prisma.$transaction(async (tx) => {
        for (const item of order.items) {
          if (!item.productVariantId) continue;
          await tx.productVariant.update({
            where: { id: item.productVariantId },
            data: { reservedQuantity: { decrement: item.quantity } },
          });
          await tx.stockMovement.create({
            data: {
              productVariantId: item.productVariantId,
              delta: 0,
              balanceAfter: 0,
              reason: 'release',
              referenceType: 'order',
              referenceId: order.id,
              note: `Reservation expired — ${order.orderNumber}`,
            },
          });
        }
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'expired', reservationExpiresAt: null },
        });
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: 'expired',
            fromValue: 'awaiting_payment',
            toValue: 'expired',
            actorType: 'system',
            message: `No payment received within ${config.RESERVATION_HOURS} hours`,
          },
        });
      });
      console.log(`[scheduler] expired ${order.orderNumber}`);
    } catch (e) {
      console.error(`[scheduler] failed to expire ${order.orderNumber}`, e);
    }
  }
  return due.length;
}

/** Auto-completes delivered orders after the review window. */
export async function completeDeliveredOrders() {
  const cutoff = new Date(Date.now() - 7 * 86_400_000);
  const due = await prisma.order.findMany({
    where: { status: 'delivered', deliveredAt: { lte: cutoff } },
    take: 100,
  });
  for (const order of due) {
    await prisma.$transaction([
      prisma.order.update({ where: { id: order.id }, data: { status: 'completed' } }),
      prisma.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: 'status_changed',
          fromValue: 'delivered',
          toValue: 'completed',
          actorType: 'system',
          message: 'Automatically completed after 7 days',
        },
      }),
    ]);
  }
  return due.length;
}

/** Removes guest carts that have been idle for 30 days. */
export async function purgeAbandonedGuestCarts() {
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  const result = await prisma.cart.deleteMany({
    where: { userId: null, lastActivityAt: { lt: cutoff } },
  });
  return result.count;
}

export function startScheduler() {
  const run = async () => {
    try {
      await expireUnpaidReservations();
      await completeDeliveredOrders();
    } catch (e) {
      console.error('[scheduler] tick failed', e);
    }
  };

  // First pass shortly after boot, then every five minutes.
  const kickoff = setTimeout(run, 15_000);
  const tick = setInterval(run, 5 * 60_000);
  const daily = setInterval(() => void purgeAbandonedGuestCarts(), 24 * 60 * 60_000);

  return () => {
    clearTimeout(kickoff);
    clearInterval(tick);
    clearInterval(daily);
  };
}
