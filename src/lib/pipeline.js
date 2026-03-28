import Groq from "groq-sdk";
import { searchWithQueries } from "$lib/search.js";
import { loadPDFByFile, extractPages, resolvePdfFileName } from "$lib/pdf.js";
import { layerOnePrompt, layerTwoPrompt, layerThreePrompt, documentSectionPickerPrompt } from "$lib/prompts.js";
import documentIndex from "$lib/static/index.json";

const groq = new Groq({
    apiKey: import.meta.env.VITE_GROQ_API_KEY,
    dangerouslyAllowBrowser: true,
});

const MODEL = "llama-3.3-70b-versatile";

const DEBUG_PIPELINE = true;

function createTraceId() {
    return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function truncate(value, max = 220) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max)}...` : text;
}

function debugSection(traceId, title, details = null) {
    if (!DEBUG_PIPELINE) return;
    console.group(`[Sanhita Pipeline][${traceId}] ${title}`);
    if (details !== null) {
        if (typeof details === "string") {
            console.log(details);
        } else {
            console.log(details);
        }
    }
    console.groupEnd();
}

function debugTable(traceId, title, rows) {
    if (!DEBUG_PIPELINE) return;
    console.group(`[Sanhita Pipeline][${traceId}] ${title}`);
    if (Array.isArray(rows) && rows.length > 0) {
        console.table(rows);
    } else {
        console.log("(no rows)");
    }
    console.groupEnd();
}

function debugLLMExchange(traceId, stepLabel, prompt, response) {
    if (!DEBUG_PIPELINE) return;
    console.groupCollapsed(`[Sanhita Pipeline][${traceId}] ${stepLabel} - LLM Exchange`);
    console.log("Prompt length:", (prompt || "").length);
    console.log("Prompt sent to LLM:\n", prompt || "");
    console.log("Response length:", (response || "").length);
    console.log("Response from LLM:\n", response || "");
    console.groupEnd();
}

function tokenizeForMatch(text) {
    return (text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 3);
}

function overlapScore(candidateText, referenceText) {
    const candidateTokens = tokenizeForMatch(candidateText);
    const referenceTokens = tokenizeForMatch(referenceText);
    if (candidateTokens.length === 0 || referenceTokens.length === 0) return 0;

    const candidateSet = new Set(candidateTokens);
    let hits = 0;
    for (const token of referenceTokens) {
        if (candidateSet.has(token)) hits += 1;
    }
    return hits;
}

function pickBestSemanticSupport(answer, searchResults) {
    const hits = Array.isArray(searchResults) ? searchResults : [];
    let best = null;
    let bestScore = -1;

    for (const hit of hits) {
        const text = hit?.document?.text || "";
        const score = overlapScore(answer, text);
        if (score > bestScore) {
            bestScore = score;
            best = hit;
        }
    }

    if (!best) return null;
    return {
        hit: best,
        snippet: truncate(best?.document?.text || "", 450),
        metadata: parseJsonSafe(best?.document?.metadata, {}),
        overlap: bestScore,
    };
}

function pickBestFallbackSupport(answer, rawText) {
    const text = rawText || "";
    const segments = text
        .split(/\n\n(?=\[Page\s+\d+\])/)
        .map((segment) => segment.trim())
        .filter(Boolean);

    if (segments.length === 0) {
        return {
            snippet: truncate(text, 450),
            overlap: 0,
        };
    }

    let bestSegment = segments[0];
    let bestScore = overlapScore(answer, bestSegment);
    for (let i = 1; i < segments.length; i += 1) {
        const score = overlapScore(answer, segments[i]);
        if (score > bestScore) {
            bestScore = score;
            bestSegment = segments[i];
        }
    }

    return {
        snippet: truncate(bestSegment, 450),
        overlap: bestScore,
    };
}

async function chat(prompt) {
    const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: MODEL,
    });
    return completion.choices[0]?.message?.content?.trim() || "";
}

function parseJsonSafe(value, fallback = null) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function pickValidDocumentIndex(rawValue, totalDocs) {
    const parsed = typeof rawValue === "number" ? rawValue : parseJsonSafe(rawValue, null);
    const index = Number(parsed);
    if (Number.isFinite(index) && index >= 0 && index < totalDocs) {
        return index;
    }
    return 0;
}

function pickValidSectionIndex(rawValue, maxIndex) {
    const sectionIndex = Number(rawValue);
    if (Number.isFinite(sectionIndex) && sectionIndex >= 0 && sectionIndex < maxIndex) {
        return sectionIndex;
    }
    return 0;
}

function pickConfidence(rawValue) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return 0.5;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function pickDocumentAndSection(rawValue, docs) {
    const parsed = typeof rawValue === "object" ? rawValue : parseJsonSafe(rawValue, null);
    const docIndex = pickValidDocumentIndex(parsed?.documentIndex, docs.length);
    const selectedDoc = docs[docIndex] || docs[0];
    const sections = selectedDoc?.contents || [];
    const sectionIndex = pickValidSectionIndex(parsed?.sectionIndex, sections.length);
    const alternateSectionIndex = pickValidSectionIndex(parsed?.alternateSectionIndex, sections.length);
    const confidence = pickConfidence(parsed?.confidence);
    const selectedSection = sections[sectionIndex] || sections[0] || null;
    const alternateSection = sections[alternateSectionIndex] || selectedSection;

    return {
        docIndex,
        sectionIndex,
        alternateSectionIndex,
        confidence,
        selectedDoc,
        selectedSection,
        alternateSection,
    };
}

function buildFallbackPreviewResult(selectedDoc, selectedSection, rawText, resolvedFileName) {
    if (!selectedDoc || !selectedSection) return null;

    const primaryPage = Array.isArray(selectedSection.pages) ? selectedSection.pages[0] : 1;
    const snippet = (rawText || "").slice(0, 1200) || `Section: ${selectedSection.title}`;

    return {
        score: 0.99,
        document: {
            text: snippet,
            metadata: JSON.stringify({
                source: resolvedFileName || selectedDoc.file || "constitution.pdf",
                primary_page: primaryPage,
                highlight_rects: [],
                page_dimensions: {},
                retrieval_mode: "fallback",
            }),
        },
    };
}

function tagPreviewResultFlow(previewResult, mode) {
    if (!previewResult?.document) return previewResult;

    const parsed = parseJsonSafe(previewResult.document.metadata, {});
    const metadata = parsed && typeof parsed === "object" ? parsed : {};

    return {
        ...previewResult,
        document: {
            ...previewResult.document,
            metadata: JSON.stringify({
                ...metadata,
                retrieval_mode: mode,
            }),
        },
    };
}

export async function runPipeline(userQuery, onStatus) {
    const traceId = createTraceId();
    debugSection(traceId, "START", {
        model: MODEL,
        query: userQuery,
    });

    // ── Step 1: Generate 5 query variations ──
    onStatus("processing", "Optimizing your query...");
    const step1Prompt = layerOnePrompt + userQuery;
    const queryGenerationRaw = await chat(step1Prompt);
    debugLLMExchange(traceId, "STEP 1", step1Prompt, queryGenerationRaw);
    debugSection(traceId, "STEP 1 - Query Variations (raw LLM output)", queryGenerationRaw);
    const queries = JSON.parse(queryGenerationRaw);
    debugTable(
        traceId,
        "STEP 1 - Query Variations (parsed)",
        (Array.isArray(queries) ? queries : []).map((q, index) => ({
            index,
            query: q,
        }))
    );

    // ── Step 2: Semantic search across all 5 queries ──
    onStatus("searching", "Searching legal documents...");
    const searchResults = await searchWithQueries(queries);
    debugSection(traceId, "STEP 2 - Semantic Search Summary", {
        totalResults: searchResults.length,
    });
    debugTable(
        traceId,
        "STEP 2 - Top Semantic Hits",
        searchResults.slice(0, 5).map((hit, idx) => {
            const parsedMetadata = parseJsonSafe(hit?.document?.metadata, {});
            return {
                rank: idx + 1,
                score: Number(hit?.score || 0).toFixed(4),
                source: parsedMetadata?.source || "unknown",
                primaryPage: parsedMetadata?.primary_page || "n/a",
                snippet: truncate(hit?.document?.text || "", 120),
            };
        })
    );
    const topChunks = searchResults.slice(0, 5).map((hit) => hit.document.text);

    // ── Step 3: Try answering from semantic results ──
    onStatus("answering", "Generating answer from search results...");
    let finalAnswer = null;
    let usedFallback = false;
    let previewResult = searchResults[0] || null;
    let supportingSnippet = null;
    let supportingMetadata = null;

    if (topChunks.length > 0) {
        const step3Prompt = layerTwoPrompt(userQuery, topChunks);
        debugTable(
            traceId,
            "STEP 3 - Context Chunks Sent To LLM",
            topChunks.map((chunk, index) => ({
                index: index + 1,
                length: (chunk || "").length,
                chunk,
            }))
        );
        const candidate = await chat(step3Prompt);
        debugLLMExchange(traceId, "STEP 3", step3Prompt, candidate);
        debugSection(traceId, "STEP 3 - Semantic Answer Candidate", {
            verdict: candidate && !candidate.includes("INSUFFICIENT_CONTEXT") ? "accepted" : "insufficient_context",
            preview: truncate(candidate, 400),
        });
        if (candidate && !candidate.includes("INSUFFICIENT_CONTEXT")) {
            finalAnswer = candidate;
            const semanticSupport = pickBestSemanticSupport(finalAnswer, searchResults);
            if (semanticSupport?.hit) {
                previewResult = semanticSupport.hit;
            }
            supportingSnippet = semanticSupport?.snippet || null;
            supportingMetadata = semanticSupport?.metadata || null;
            debugSection(traceId, "STEP 3 - Semantic Supporting Snippet", {
                overlapScore: semanticSupport?.overlap || 0,
                snippet: supportingSnippet,
                metadata: supportingMetadata,
                previewUsesSupportingHit: Boolean(semanticSupport?.hit),
            });
        }
    } else {
        debugSection(traceId, "STEP 3 - Semantic Answer Candidate", "Skipped because no semantic chunks were returned.");
    }

    // ── Step 4: PDF fallback — only reached if semantic search failed ──
    if (!finalAnswer) {
        usedFallback = true;
        onStatus("extracting", "Selecting the most likely document and chapter...");
        debugSection(traceId, "STEP 4 - Entering Fallback", "Semantic context was insufficient. Running document+section picker.");

        const docsForPrompt = documentIndex.map((doc) => ({
            name: doc.name,
            file: doc.file,
            description: doc.description,
            contents: doc.contents || [],
        }));

        const step4PickerPrompt = documentSectionPickerPrompt(userQuery, docsForPrompt);
        const pickedDocSectionRaw = await chat(step4PickerPrompt);
        debugLLMExchange(traceId, "STEP 4 (Document+Section Picker)", step4PickerPrompt, pickedDocSectionRaw);
        debugSection(traceId, "STEP 4 - Fallback Picker (raw LLM output)", pickedDocSectionRaw);
        const { selectedDoc, selectedSection, alternateSection, confidence } = pickDocumentAndSection(pickedDocSectionRaw, documentIndex);
        debugSection(traceId, "STEP 4 - Fallback Picker (parsed decision)", {
            selectedDocument: selectedDoc?.name || "n/a",
            selectedFile: selectedDoc?.file || "n/a",
            selectedSection: selectedSection?.title || "n/a",
            selectedPages: selectedSection?.pages || [],
            alternateSection: alternateSection?.title || "n/a",
            alternatePages: alternateSection?.pages || [],
            confidence,
        });

        if (!selectedDoc || !selectedSection) {
            finalAnswer = "The system could not find a relevant document section for your question.";
            debugSection(traceId, "STEP 4 - Fallback Failed", finalAnswer);
        } else {
            const useAlternateSection = confidence < 0.6 && alternateSection && alternateSection.title !== selectedSection.title;
            const selectedLabel = useAlternateSection
                ? `${selectedSection.title} (+ alternate: ${alternateSection.title})`
                : selectedSection.title;

            onStatus("extracting", `Reading ${selectedLabel} in ${selectedDoc.name}...`);

            // Default path extracts one chapter; on low confidence we include one alternate chapter.
            const pageRanges = useAlternateSection
                ? [selectedSection.pages, alternateSection.pages]
                : [selectedSection.pages];
            const resolvedFileName = resolvePdfFileName(selectedDoc?.file, "constitution.pdf");
            debugSection(traceId, "STEP 4 - Fallback Extraction Plan", {
                useAlternateSection,
                selectedLabel,
                pageRanges,
                resolvedFileName,
            });
            const pdfDoc = await loadPDFByFile(resolvedFileName);
            const rawText = await extractPages(pdfDoc, pageRanges);
            debugSection(traceId, "STEP 4 - Extracted Text Summary", {
                characters: rawText.length,
                preview: truncate(rawText, 300),
            });

            previewResult = buildFallbackPreviewResult(selectedDoc, selectedSection, rawText, resolvedFileName) || previewResult;

            // Final LLM attempt with the extracted raw text
            onStatus("answering", "Generating answer from document text...");
            const step5Prompt = layerThreePrompt(userQuery, rawText);
            const candidate = await chat(step5Prompt);
            debugLLMExchange(traceId, "STEP 5", step5Prompt, candidate);
            debugSection(traceId, "STEP 5 - Fallback Answer Candidate", {
                verdict: candidate && !candidate.includes("INSUFFICIENT_CONTEXT") ? "accepted" : "insufficient_context",
                preview: truncate(candidate, 400),
            });

            if (candidate && !candidate.includes("INSUFFICIENT_CONTEXT")) {
                finalAnswer = candidate;
                const fallbackSupport = pickBestFallbackSupport(finalAnswer, rawText);
                supportingSnippet = fallbackSupport?.snippet || null;
                supportingMetadata = {
                    source: resolvedFileName,
                    section: selectedSection?.title || "Unknown",
                    pages: selectedSection?.pages || [],
                    overlapScore: fallbackSupport?.overlap || 0,
                };
                debugSection(traceId, "STEP 5 - Fallback Supporting Snippet", {
                    snippet: supportingSnippet,
                    metadata: supportingMetadata,
                });
            } else {
                finalAnswer = "The answer could not be found in the selected chapter of the document.";
            }
        }
    }

    if (!usedFallback && previewResult) {
        previewResult = tagPreviewResultFlow(previewResult, "semantic");
    }

    debugSection(traceId, "END", {
        usedFallback,
        finalAnswerPreview: truncate(finalAnswer, 320),
        previewFlow: parseJsonSafe(previewResult?.document?.metadata, {})?.retrieval_mode || "unknown",
        supportingSnippet,
        supportingMetadata,
    });

    return { answer: finalAnswer, queries, usedFallback, searchResults, previewResult };
}