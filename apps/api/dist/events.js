import { EventEmitter } from 'events';
class EventHub extends EventEmitter {
    clients = new Set();
    constructor() {
        super();
    }
    addClient(reply) {
        this.clients.add(reply);
        // Initial heartbeat
        const initial = {
            type: 'HEARTBEAT',
            timestamp: new Date().toISOString(),
            message: 'Connected to live BMS Monitor SSE stream',
        };
        reply.raw.write(`data: ${JSON.stringify(initial)}\n\n`);
        reply.raw.on('close', () => {
            this.clients.delete(reply);
        });
    }
    broadcast(event) {
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        for (const reply of this.clients) {
            try {
                reply.raw.write(payload);
            }
            catch {
                this.clients.delete(reply);
            }
        }
    }
}
export const eventHub = new EventHub();
//# sourceMappingURL=events.js.map