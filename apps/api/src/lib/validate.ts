import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodSchema } from 'zod';

export function parseBody<T>(
  schema: ZodSchema<T>,
  body: unknown,
  reply: FastifyReply,
): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    reply.status(400).send({
      error: {
        message: 'Validation failed',
        statusCode: 400,
        details: result.error.flatten(),
      },
    });
    return null;
  }
  return result.data;
}

export function parseQuery<T>(
  schema: ZodSchema<T>,
  query: FastifyRequest['query'],
  reply: FastifyReply,
): T | null {
  const result = schema.safeParse(query);
  if (!result.success) {
    reply.status(400).send({
      error: {
        message: 'Validation failed',
        statusCode: 400,
        details: result.error.flatten(),
      },
    });
    return null;
  }
  return result.data;
}
