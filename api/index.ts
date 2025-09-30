import type { VercelRequest, VercelResponse } from '@vercel/node';
import express from 'express';

const app = express();
app.use(express.json());

// --- CORS ---
app.use((_, res, next) => {
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
next();
});
app.options('*', (_req, res) => res.status(200).end());

// --- Utilidades SMILES ---
const SPECIAL_TOKENS = new Set(["[CLS]","[SEP]","[PAD]","[UNK]","[BOS]","[EOS]","[MASK]"]);

function decodificarTokens(tokens: string[]): string {
const mol: string[] = [];
for (const tok of tokens) {
    if (SPECIAL_TOKENS.has(tok)) continue;
    if (tok.startsWith('[') && tok.endsWith(']')) {
    const contenido = tok.slice(1, -1);
    if (/^[A-Za-z0-9@=#+\\\/-]+$/.test(contenido)) mol.push(contenido);
    else mol.push(tok);
    } else mol.push(tok);
}
return mol.join('');
}

function postprocesarSmiles(tokensString: string): string {
const pattern = /\[.*?\]/g;
const tokensFuera = tokensString.split(pattern);
const matches = tokensString.match(pattern) || [];
const result: string[] = [];
const branchStack: string[] = [];
const ringOpen: Record<string, boolean> = {};

for (let i = 0; i < tokensFuera.length; i++) {
    result.push(tokensFuera[i]);
    if (i < matches.length) {
    const tok = matches[i];
    if (tok.startsWith('[Branch')) {
        result.push('(');
        branchStack.push(')');
    } else if (tok.startsWith('[Ring')) {
        const num = tok.match(/\d+/);
        if (num) {
        const n = num[0];
        if (!ringOpen[n]) ringOpen[n] = true; else delete ringOpen[n];
        result.push(n);
        }
    } else {
        result.push(tok);
    }
    }
}
while (branchStack.length) result.push(branchStack.pop() as string);
return result.join('');
}

// --- Rutas ---
app.get('/health', (_req, res) => {
res.status(200).json({ ok: true, hasHFToken: Boolean(process.env.HF_TOKEN) });
});

app.post('/smiles', async (req, res) => {
try {
    const { input, max_length = 60, top_k = 50, top_p = 0.95, temperature = 1.0 } = req.body || {};
    if (typeof input !== 'string' || !input.trim()) {
    return res.status(400).json({ error: 'Falta "input" (string SMILES de entrada).' });
    }
    const HF_TOKEN = process.env.HF_TOKEN;
    if (!HF_TOKEN) {
    console.error('SMILES_ERROR: falta HF_TOKEN');
    return res.status(500).json({ error: 'Falta HF_TOKEN en variables de entorno' });
    }

    const resp = await fetch('https://api-inference.huggingface.co/models/ncfrey/ChemGPT-4.7M', {
    method: 'POST',
    headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        inputs: input,
        parameters: {
        max_new_tokens: Math.max(1, Math.min(256, max_length)),
        do_sample: true,
        top_k,
        top_p,
        temperature
        }
    })
    });

    if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    console.error('SMILES_HF_ERROR', resp.status, txt);
    return res.status(502).json({ error: 'Fallo llamando a HuggingFace', details: txt });
    }

    const data = await resp.json();
    let generatedRaw = '';
    if (Array.isArray(data) && data.length && typeof data[0]?.generated_text === 'string') {
    generatedRaw = data[0].generated_text;
    } else if (typeof data === 'string') {
    generatedRaw = data;
    } else {
    generatedRaw = JSON.stringify(data);
    }

    const smilesPost = postprocesarSmiles(generatedRaw);
    return res.status(200).json({ input, output: smilesPost, raw: generatedRaw });
} catch (err: any) {
    console.error('SMILES_ERROR', err);
    return res.status(500).json({ error: 'Error interno', details: err?.message || String(err) });
}
});

// ⚠️ Exportá el app como handler para Vercel
export default function handler(req: VercelRequest, res: VercelResponse) {
  // Express es un handler (req,res) compatible, se puede invocar directo
    return (app as any)(req, res);
}
