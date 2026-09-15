import { EventEmitter } from 'events';
import { FastifyReply } from 'fastify';
import { LiveEventPayload } from '@bms/shared';

interface ClientSubscription {
  clientId?: string;
  userId?: string;
}

class EventHub extends EventEmitter {
  private clients: Map<FastifyReply, ClientSubscription> = new Map();

  constructor() {
    super();
  }

  addClient(reply: FastifyReply, clientId?: string, userId?: string) {
    this.clients.set(reply, { clientId, userId });

    // Initial heartbeat
    const initial: LiveEventPayload = {
      type: 'HEARTBEAT',
      clientId,
      timestamp: new Date().toISOString(),
      message: 'Connected to private BMS Monitor SSE stream',
    };
    reply.raw.write(`data: ${JSON.stringify(initial)}\n\n`);

    reply.raw.on('close', () => {
      this.clients.delete(reply);
    });
  }

  broadcast(event: LiveEventPayload & { userId?: string }) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const [reply, sub] of this.clients.entries()) {
      // If event has userId and subscriber has userId, match on that
      if (event.userId && sub.userId) {
        if (event.userId !== sub.userId) continue;
      } else if (event.clientId && sub.clientId) {
        if (event.clientId !== sub.clientId) continue;
      }
      try {
        reply.raw.write(payload);
      } catch {
        this.clients.delete(reply);
      }
    }
  }
}

export const eventHub = new EventHub();
