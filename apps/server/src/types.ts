import '@fastify/jwt';
import type { FastifyRequest } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: string };
    user: { sub: string; role: string };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Resolved principal, or null for anonymous callers.
     *
     * Kept separate from `request.user` because @fastify/jwt types that as
     * always-present; this property honestly models "no token supplied".
     */
    principal: { sub: string; role: string } | null;
  }
}

export type AuthedRequest = FastifyRequest & { principal: { sub: string; role: string } };
