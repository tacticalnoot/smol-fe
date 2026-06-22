import type { APIRoute } from 'astro';
import { generateMixtapeAutoPlan } from '../../lib/mixtapeAuto.mjs';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });

export const GET: APIRoute = async () => {
  return json({
    name: 'Mixtape Auto',
    route: '/api/mixtape-auto.json',
    status: 'online-scaffold',
    mode: 'local-testnet-prototype',
    accepts: {
      method: 'POST',
      json: {
        theme: 'string',
        style: 'string',
        audience: 'string',
        tempo: 'number',
        rail: 'string'
      }
    },
    safety: {
      livePayments: false,
      mainnet: false,
      secretsRequired: false
    }
  });
};

export const POST: APIRoute = async ({ request }) => {
  let input: Record<string, unknown> = {};

  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      input = await request.json();
    }
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  return json(generateMixtapeAutoPlan(input));
};
