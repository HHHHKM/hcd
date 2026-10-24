import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
export const requestActors = new WeakMap<FastifyRequest, string>();
const secrets = new WeakMap<FastifyInstance, Buffer>();
function secret(app: FastifyInstance): Buffer {
  let value = secrets.get(app);
  if (!value) { value = randomBytes(32); secrets.set(app, value); }
  return value;
}
export function internalRequestHeaders(app: FastifyInstance): Record<string, string> {
  return { 'x-hcd-internal': secret(app).toString('hex') };
}
export function isInternalRequest(app: FastifyInstance, request: FastifyRequest): boolean {
  const supplied = request.headers['x-hcd-internal'];
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied, 'hex'), secret(app));
}
