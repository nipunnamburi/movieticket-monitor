import { EventEmitter } from 'events';
import { FastifyReply } from 'fastify';
import { LiveEventPayload } from '@bms/shared';

class EventHub extends EventEmitter {
  private clients: Set<FastifyReply> = new Set();

  constructor() {
    super();
  }

  addClient(reply: FastifyReply) {
    this.clients.add(reply);

    // Initial heartbeat
    const initial: LiveEventPayload = {
      type: 'HEARTBEAT',
      timestamp: new Date().toISOString(),
      message: 'Connected to live BMS Monitor SSE stream',
    };
    reply.raw.write(`data: ${JSON.stringify(initial)}\n\n`);

    reply.raw.on('close', () => {
      this.clients.delete(reply);
    });
  }

  broadcast(event: LiveEventPayload) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const reply of this.clients) {
      try {
        reply.raw.write(payload);
      } catch {
        this.clients.delete(reply);
      }
    }
  }
}

export const eventHub = new EventHub();
