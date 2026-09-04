import { EventEmitter } from 'events';
import { FastifyReply } from 'fastify';
import { LiveEventPayload } from '@bms/shared';
declare class EventHub extends EventEmitter {
    private clients;
    constructor();
    addClient(reply: FastifyReply): void;
    broadcast(event: LiveEventPayload): void;
}
export declare const eventHub: EventHub;
export {};
