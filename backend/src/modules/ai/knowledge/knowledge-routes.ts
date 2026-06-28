// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { resolveProviderApiKey, getProviderBaseUrl } from '../provider-registry.js';
import { logger } from '../../../shared/utils/logger.js';
import { generateEmbedding } from './embedding.js';
import { ingestDocument, searchKnowledge, type EmbedConfig, type IngestDeps } from './knowledge-service.js';

const deps: IngestDeps = { prisma: prisma as unknown as IngestDeps['prisma'], embed: generateEmbedding };

/**
 * Build the embedding config for an org from AiConfig. For non-local providers the
 * API key + base URL come from the provider registry (same source as the LLM key);
 * 'local' (Ollama) needs neither.
 */
async function embedConfigForOrg(orgId: string): Promise<EmbedConfig> {
  const cfg = await prisma.aiConfig.findUnique({ where: { orgId } });
  const provider = cfg?.embedProvider ?? 'local';
  const model = cfg?.embedModel ?? 'bge-m3';
  let baseUrl = cfg?.embedBaseUrl ?? 'http://localhost:11434/v1';
  let apiKey: string | undefined;
  if (provider !== 'local') {
    apiKey = (await resolveProviderApiKey(orgId, provider)) ?? undefined;
    baseUrl = (await getProviderBaseUrl(orgId, provider)) || baseUrl;
  }
  return { provider, model, apiKey, baseUrl };
}

/** Registers /api/v1/ai/knowledge routes. Call from aiRoutes(app). */
export function registerKnowledgeRoutes(app: FastifyInstance): void {
  app.post('/api/v1/ai/knowledge', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = request.user!.orgId;
    const body = request.body as { title?: string; source?: string; content?: string };
    if (!body?.title || !body?.content) {
      return reply.status(400).send({ error: 'title and content are required' });
    }
    try {
      const cfg = await embedConfigForOrg(orgId);
      return await ingestDocument(deps, orgId, { title: body.title, source: body.source, content: body.content }, cfg);
    } catch (err) {
      logger.error({ err }, '[ai/kb] ingest failed');
      return reply.status(500).send({ error: 'ingest failed' });
    }
  });

  app.get('/api/v1/ai/knowledge', async (request: FastifyRequest) => {
    const orgId = request.user!.orgId;
    const documents = await prisma.knowledgeDocument.findMany({
      where: { orgId },
      select: { id: true, title: true, source: true, createdAt: true, _count: { select: { chunks: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { documents };
  });

  app.delete('/api/v1/ai/knowledge/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = request.user!.orgId;
    const { id } = request.params as { id: string };
    await prisma.knowledgeDocument.deleteMany({ where: { id, orgId } });
    return reply.status(204).send();
  });
}

// Re-export searchKnowledge for flow A (suggestion enrichment) convenience.
export { searchKnowledge };
