/**
 * e2e-public-api-server.ts — Minimal standalone server that mounts ONLY the public
 * API routes against a real DB. Used to prove the Go scraper's crmclient can push
 * to the real bulk endpoint cross-language, without booting the full ZaloCRM stack
 * (redis/minio/socket.io). Seeds an org + api key, prints them, and listens.
 *
 *   DATABASE_URL=... PORT=3999 API_KEY=e2e-go-key npx tsx scripts/e2e-public-api-server.ts
 *
 * Prints a line "E2E_READY orgId=<id> port=<n>" once listening.
 */
import Fastify from 'fastify';
import { prisma } from '../src/shared/database/prisma-client.js';
import { publicApiRoutes } from '../src/modules/api/public-api-routes.js';

const PORT = Number(process.env.PORT ?? 3999);
const API_KEY = process.env.API_KEY ?? 'e2e-go-key';

async function main() {
  const org = await prisma.organization.create({ data: { name: 'E2E Go Org' } });
  await prisma.appSetting.create({
    data: { orgId: org.id, settingKey: 'public_api_key', valuePlain: API_KEY },
  });

  const app = Fastify();
  await app.register(publicApiRoutes);
  await app.listen({ port: PORT, host: '127.0.0.1' });

  // Single machine-readable line the Go test waits for.
  console.log(`E2E_READY orgId=${org.id} port=${PORT}`);

  const shutdown = async () => {
    try {
      await prisma.contact.deleteMany({ where: { orgId: org.id } });
      await prisma.appSetting.deleteMany({ where: { orgId: org.id } });
      await prisma.organization.deleteMany({ where: { id: org.id } });
    } catch {
      // best-effort cleanup
    }
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('E2E_SERVER_ERROR', err);
  process.exit(1);
});
