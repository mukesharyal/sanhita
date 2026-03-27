import { create, insert, searchVector } from '@orama/orama';
import { embedText } from './embed.js';

let db = null;
let dbPromise = null;
let sourceStatus = 'idle';
let sourceProgress = 0;

async function fetchJson(path) {
    const response = await fetch(path, { cache: 'force-cache' });
    if (!response.ok) {
        throw new Error(`Failed to fetch ${path}: ${response.status}`);
    }
    return response.json();
}

async function loadEmbeddingsData(onStatus) {
    reportSourceStatus(onStatus, 'loading', 'Loading embedding manifest...', 8);
    const manifest = await fetchJson('/embeddings/manifest.json');
    const fileEntries = Array.isArray(manifest?.files) ? manifest.files : [];

    if (fileEntries.length === 0) {
        throw new Error('Embedding manifest has no chunk files.');
    }

    const chunks = [];
    const totalFiles = fileEntries.length;

    for (let i = 0; i < fileEntries.length; i += 1) {
        const fileInfo = fileEntries[i];
        const fileName = typeof fileInfo === 'string' ? fileInfo : fileInfo?.file;
        if (!fileName) continue;

        const progress = 10 + Math.round(((i + 1) / totalFiles) * 15);
        reportSourceStatus(onStatus, 'loading', `Loading embeddings chunk ${i + 1}/${totalFiles}...`, progress);

        const chunk = await fetchJson(`/embeddings/${fileName}`);
        if (Array.isArray(chunk)) {
            chunks.push(...chunk);
        }

        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return chunks;
}

function reportSourceStatus(onStatus, state, message, progress = sourceProgress) {
    sourceStatus = state;
    sourceProgress = progress;
    if (onStatus) {
        onStatus({ state, message, progress });
    }
}

export function getSourceStatus() {
    return { state: sourceStatus, progress: sourceProgress };
}

async function getDatabase(onStatus) {
    if (db) return db;
    if (dbPromise) return dbPromise;

    dbPromise = (async () => {
        reportSourceStatus(onStatus, 'loading', 'Loading legal source embeddings...', 6);
        const embeddingsData = await loadEmbeddingsData(onStatus);

        reportSourceStatus(onStatus, 'loading', 'Building searchable source index...', 25);
        const createdDb = await create({
            schema: {
                text: 'string',
                embedding: 'vector[384]',
                metadata: 'string',
            },
        });

        const total = embeddingsData.length || 1;
        for (let i = 0; i < embeddingsData.length; i += 1) {
            const entry = embeddingsData[i];
            await insert(createdDb, {
                text: entry.text,
                embedding: entry.embedding,
                metadata: JSON.stringify(entry.metadata),
            });

            if ((i + 1) % 200 === 0 || i === embeddingsData.length - 1) {
                const progress = 25 + Math.round(((i + 1) / total) * 75);
                reportSourceStatus(onStatus, 'loading', `Preparing source index (${i + 1}/${total})...`, progress);
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        db = createdDb;
        reportSourceStatus(onStatus, 'ready', 'Legal source index ready.', 100);
        return createdDb;
    })().catch((error) => {
        reportSourceStatus(onStatus, 'error', 'Failed to load legal source index.', sourceProgress);
        dbPromise = null;
        throw error;
    });

    return dbPromise;
}

export async function preloadSearchIndex(onStatus) {
    return getDatabase(onStatus);
}

export async function searchWithQueries(queries) {
    const db = await getDatabase();

    // Embed all 5 queries in parallel
    const queryEmbeddings = await Promise.all(queries.map(embedText));

    // Search for each query and collect results
    const allResults = await Promise.all(
        queryEmbeddings.map((embedding) =>
            searchVector(db, {
                vector: {
                    value: embedding,
                    property: 'embedding',
                },
                similarity: 0.5,  // minimum similarity threshold, adjust as needed
                limit: 5,
            })
        )
    );

    // Flatten, deduplicate by text, and sort by score
    const seen = new Set();
    const merged = allResults
        .flatMap((result) => result.hits)
        .filter((hit) => {
            if (seen.has(hit.document.text)) return false;
            seen.add(hit.document.text);
            return true;
        })
        .sort((a, b) => b.score - a.score);

    return merged;
}