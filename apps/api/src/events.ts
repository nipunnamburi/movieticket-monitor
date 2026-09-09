import { EventEmitter } from 'events';
import { FastifyReply } from 'fastify';
import { LiveEventPayload } from '@bms/shared';

class EventHub extends EventEmitter {
  private clients: Map<FastifyReply, string | undefined> = new Map();

  constructor() {
    super();
  }

  addClient(reply: FastifyReply, clientId?: string) {
    this.clients.set(reply, clientId);

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

  broadcast(event: LiveEventPayload) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const [reply, clientToken] of this.clients.entries()) {
      // If event is scoped to a client, only deliver to matching client
      if (event.clientId && clientToken && event.clientId !== clientToken) {
        continue;
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
