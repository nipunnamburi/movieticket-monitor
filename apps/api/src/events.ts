import { EventEmitter } from 'events';
import { FastifyReply } from 'fastify';
import { LiveEventPayload } from '@bms/shared';

interface ClientSubscription {
  clientId?: string;
  userId?: string;
}

class EventHub extends EventEmitter {
  private clients: Map<FastifyReply, ClientSubscription> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.startHeartbeat();
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.clients.size === 0) return;
      const ping = `: ping - ${new Date().toISOString()}\n\n`;
      for (const [reply] of this.clients.entries()) {
        try {
          reply.raw.write(ping);
        } catch {
          this.removeClient(reply);
        }
      }
    }, 15000);
  }

  addClient(reply: FastifyReply, clientId?: string, userId?: string) {
    this.clients.set(reply, { clientId, userId });

    // Initial heartbeat payload
    const initial: LiveEventPayload = {
      type: 'HEARTBEAT',
      clientId,
      timestamp: new Date().toISOString(),
      message: 'Connected to private BMS Monitor SSE stream',
    };

    try {
      reply.raw.write(`data: ${JSON.stringify(initial)}\n\n`);
    } catch {
      this.removeClient(reply);
      return;
    }

    reply.raw.on('close', () => {
      this.removeClient(reply);
    });

    reply.raw.on('error', () => {
      this.removeClient(reply);
    });
  }

  removeClient(reply: FastifyReply) {
    this.clients.delete(reply);
    try {
      if (!reply.raw.destroyed) {
        reply.raw.end();
      }
    } catch {
      // ignore
    }
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
        this.removeClient(reply);
      }
    }
  }
}

export const eventHub = new EventHub();
