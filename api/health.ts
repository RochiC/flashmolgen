import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function health(_req: VercelRequest, res: VercelResponse) {
res.status(200).json({ ok: true, hasHFToken: Boolean(process.env.HF_TOKEN) });
}
