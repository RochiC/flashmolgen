// api/smiles.ts
// Next.js (Node) serverless en Vercel

import type { VercelRequest, VercelResponse } from '@vercel/node';

// === Post-procesos portados de tu script ===
const SPECIAL_TOKENS = new Set([
"[CLS]", "[SEP]", "[PAD]", "[UNK]", "[BOS]", "[EOS]", "[MASK]"
]);


function decodificarTokens(tokens: string[]): string {
const mol: string[] = [];
for (const tok of tokens) {
    if (SPECIAL_TOKENS.has(tok)) continue;

    if (tok.startsWith("[") && tok.endsWith("]")) {
    const contenido = tok.slice(1, -1);
    if (/^[A-Za-z0-9@=#+\\\/-]+$/.test(contenido)) {
        mol.push(contenido);
    } else {
        mol.push(tok);
    }
    } else {
    mol.push(tok);
    }
}
return mol.join("");
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

    if (tok.startsWith("[Branch")) {
        result.push("(");
        branchStack.push(")");
    } else if (tok.startsWith("[Ring")) {
        const num = tok.match(/\d+/);
        if (num) {
        const n = num[0];
        if (!ringOpen[n]) {
            ringOpen[n] = true; // apertura
        } else {
            delete ringOpen[n]; // cierre
        }
        result.push(n);
        }
    } else {
        result.push(tok);
    }
    }
}

while (branchStack.length) {
    result.push(branchStack.pop() as string);
}

return result.join("");
}

// === Handler principal ===
export default async function handler(req: VercelRequest, res: VercelResponse) {
if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
}

try {
    const { input, max_length = 60, top_k = 50, top_p = 0.95, temperature = 1.0 } = req.body || {};
    if (typeof input !== 'string' || !input.trim()) {
    return res.status(400).json({ error: 'Falta "input" (string SMILES de entrada).' });
    }

    const HF_TOKEN = process.env.HF_TOKEN;
    if (!HF_TOKEN) {
    return res.status(500).json({ error: 'Falta HF_TOKEN en variables de entorno' });
    }

    // Llamada a Hugging Face Inference API (text-generation)
    // Modelo: ncfrey/ChemGPT-4.7M
    const resp = await fetch('https://api-inference.huggingface.co/models/ncfrey/ChemGPT-4.7M', {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        inputs: input,
        parameters: {
          max_new_tokens: Math.max(1, Math.min(256, max_length)), // tope prudente
        do_sample: true,
        top_k,
        top_p,
        temperature,
          // La API devuelve texto plano; si algún día migrás a endpoint custom que devuelva tokens, abajo ya tenemos decode
        }
    })
    });

    if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    return res.status(502).json({ error: 'Fallo llamando a HuggingFace', details: txt });
    }

    const data = await resp.json();

    // La Inference API (text-generation) suele devolver [{ generated_text: "..." }]
    // O bien strings. Tomamos el primer caso usable.
    let generatedRaw = '';
    if (Array.isArray(data) && data.length && typeof data[0]?.generated_text === 'string') {
    generatedRaw = data[0].generated_text;
    } else if (typeof data === 'string') {
    generatedRaw = data;
    } else {
      // fallback
    generatedRaw = JSON.stringify(data);
    }

    // Si en algún momento devolvés tokens en vez de string,
    // podrías mapear a decodificarTokens([...]) y luego postprocesar.
    // Con generatedRaw como string aplicamos solo post-proceso "ligero".
    const smilesPost = postprocesarSmiles(generatedRaw);

    return res.status(200).json({
    input,
      output: smilesPost,          // <- tu front lee este string
      raw: generatedRaw            // opcional: útil para debug
    });

} catch (err: any) {
    return res.status(500).json({ error: 'Error interno', details: err?.message || String(err) });
}
}
