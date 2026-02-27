import { create, insert, searchVector } from '@orama/orama';
import { embedText } from './embed.js';
import embeddingsData from './static/constitution.json';

let db = null;

async function getDatabase() {
    if (db) return db;

    db = await create({
        schema: {
            text: 'string',
            embedding: 'vector[384]',
        },
    });

    // Insert all documents from your embeddings.json
    for (const entry of embeddingsData) {
        await insert(db, {
            text: entry.text,
            embedding: entry.embedding,
        });
    }

    return db;
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