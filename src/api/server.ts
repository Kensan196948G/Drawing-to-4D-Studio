import { existsSync } from 'node:fs';
import { fileURLToPath, URL, pathToFileURL } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { createDatabasePool } from './db.js';
import { ApiError } from './errors.js';
import { StudioRepository } from './repository.js';
import { CaseCodeSchema, CasePayloadSchema, LearnTermSchema } from './schema.js';

export interface BuildServerOptions {
  databaseUrl: string;
  appToken?: string;
  staticRoot?: string;
  logger?: boolean;
}

const DEFAULT_STATIC_ROOT = fileURLToPath(new URL('../../dist/web', import.meta.url));
const VERSION = '0.1.0';

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 12 * 1024 * 1024,
  });
  const pool = createDatabasePool(options.databaseUrl);
  const repository = new StudioRepository(pool);
  app.addHook('onClose', async () => {
    await pool.end();
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!options.appToken) return;
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
    if (!request.url.startsWith('/api/')) return;
    const provided = request.headers['x-app-token'];
    if (provided !== options.appToken) {
      await reply.code(401).send({
        error: { code: 'ERR-401', message: 'この操作にはアクセストークンが必要です。' },
      });
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
      const message = error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join(' / ');
      return reply.code(400).send({ error: { code: 'ERR-422', message } });
    }
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (statusCode === 413) {
      return reply
        .code(413)
        .send({ error: { code: 'ERR-413', message: '送信データが大きすぎます。図面を分割してください。' } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'ERR-500', message: 'サーバ内部でエラーが発生しました。' } });
  });

  app.get('/healthz', async (_request, reply) => {
    const dbOk = await repository.health();
    const body = {
      status: dbOk ? 'ok' : 'degraded',
      version: VERSION,
      env: process.env.APP_ENV ?? 'development',
      db: { ok: dbOk },
      timestamp: new Date().toISOString(),
    };
    return reply.code(dbOk ? 200 : 503).send(body);
  });

  app.get('/api/catalog/work-types', async () => {
    const workTypes = await repository.listWorkTypes();
    return { workTypes };
  });

  app.get('/api/catalog/dictionary', async () => {
    const terms = await repository.listDictionary();
    return { terms };
  });

  app.post('/api/dictionary/learn', async (request, reply) => {
    const input = LearnTermSchema.parse(request.body ?? {});
    const term = await repository.learnTerm(input);
    return reply.code(201).send({ term });
  });

  app.get('/api/cases', async () => {
    const cases = await repository.listCases();
    return { cases };
  });

  app.get<{ Params: { code: string } }>('/api/cases/:code', async (request) => {
    const code = CaseCodeSchema.safeParse(request.params.code);
    if (!code.success) {
      throw new ApiError(400, 'ERR-422', '案件コードの形式が不正です。');
    }
    const record = await repository.getCase(code.data);
    if (!record) throw new ApiError(404, 'ERR-404', `案件が見つかりません: ${code.data}`);
    return { case: record };
  });

  app.put<{ Params: { code: string } }>('/api/cases/:code', async (request, reply) => {
    const code = CaseCodeSchema.safeParse(request.params.code);
    if (!code.success) {
      throw new ApiError(400, 'ERR-422', '案件コードの形式が不正です。');
    }
    const payload = CasePayloadSchema.parse(request.body ?? {});
    const saved = await repository.putCase(code.data, payload);
    return reply.code(200).send({ case: saved });
  });

  const staticRoot = options.staticRoot ?? DEFAULT_STATIC_ROOT;
  if (existsSync(staticRoot)) {
    await app.register(fastifyStatic, { root: staticRoot, prefix: '/', index: ['index.html'] });
    app.setNotFoundHandler((request, reply) => {
      if (
        request.method === 'GET' &&
        !request.url.startsWith('/api/') &&
        !request.url.startsWith('/healthz')
      ) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: { code: 'ERR-404', message: '見つかりません。' } });
    });
  } else {
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({ error: { code: 'ERR-404', message: '見つかりません。' } }),
    );
  }

  return app;
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8790);
  const host = process.env.HOST ?? '127.0.0.1';
  const databaseUrl = process.env.DATABASE_URL ?? 'postgresql:///d4d_studio?host=/var/run/postgresql';
  const app = await buildServer({
    databaseUrl,
    appToken: process.env.APP_TOKEN,
    staticRoot: process.env.STATIC_ROOT,
    logger: process.env.NODE_ENV !== 'test',
  });
  await app.listen({ port, host });
  app.log.info(`Drawing-to-4D Studio API listening on http://${host}:${port}`);

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, closing`);
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(`api: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
