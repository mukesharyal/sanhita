import { env, pipeline } from '@xenova/transformers';

// In static SPA hosting, unknown paths often resolve to index.html.
// Disabling local model lookup avoids JSON.parse failures from HTML fallbacks.
env.allowLocalModels = false;

let embedder = null;
let embedderPromise = null;
let embedderStatus = 'idle';

async function getEmbedder() {
    if (embedder) return embedder;

    if (!embedderPromise) {
        embedderStatus = 'loading';
        embedderPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
            .then((instance) => {
                embedder = instance;
                embedderStatus = 'ready';
                return instance;
            })
            .catch((error) => {
                embedderStatus = 'error';
                embedderPromise = null;
                throw error;
            });
    }

    return embedderPromise;
}

export function getEmbedderStatus() {
    return embedderStatus;
}

export async function preloadEmbedder() {
    return getEmbedder();
}

export async function embedText(text) {
    const embedder = await getEmbedder();
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}