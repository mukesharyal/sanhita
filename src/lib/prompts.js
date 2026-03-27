export const layerOnePrompt = `Generate 5 semantic search query variations for a Nepali legal document retrieval system.
Rules: strip conversational language, no question marks or pronouns, use noun phrases, formal legal language, do not invent act names or article numbers.
Angle each variation differently: core concept, action/process, parties involved, broader context, keywords combined.
Return ONLY a valid JSON array of 5 strings.
Example input: "Do daughters and sons have equal property rights?"
Example output: ["equal inheritance rights property division","property succession gender equality","women property entitlement legal provision","family property distribution rights","inheritance equal rights male female"]
Query: `;

export const layerTwoPrompt = (userQuery, chunks) =>
    `You are a Nepali legal assistant. Answer the question using ONLY the passages below.
If the passages lack sufficient information, reply with only: INSUFFICIENT_CONTEXT

Question: "${userQuery}"

${chunks.map((chunk, i) => `[${i + 1}] ${chunk}`).join("\n\n")}`;

export const sectionPickerPrompt = (userQuery, sections) =>
    `Pick the indices of sections most likely to answer this question: "${userQuery}"

${sections.map((s, i) => `[${i}] ${s.title} (pp.${s.pages[0]}-${s.pages[1]}): ${s.description}`).join("\n")}

Return ONLY a valid JSON array of integers. Example: [2,5,8]`;

export const documentPickerPrompt = (userQuery, documents) =>
    `Pick the SINGLE most likely document index that should be searched first for this legal question.

Question: "${userQuery}"

Documents:
${documents.map((d, i) => `[${i}] ${d.name} (${d.file}): ${d.description}`).join("\n")}

Return ONLY a valid JSON integer. Example: 2`;

export const documentSectionPickerPrompt = (userQuery, documents) =>
    `You are selecting the BEST source location for a Nepali legal question.
Pick exactly ONE document and exactly ONE section/chapter inside that document that is most likely to contain the answer.
Also provide a confidence score from 0 to 1 for your primary pick.
If confidence is below 0.6, provide one alternate section index from the SAME document.

Question: "${userQuery}"

Documents and sections:
${documents.map((d, i) => `[${i}] ${d.name} (${d.file}): ${d.description}\n${(d.contents || []).map((s, j) => `  - [${j}] ${s.title} (pp.${s.pages[0]}-${s.pages[1]}): ${s.description}`).join("\n")}`).join("\n\n")}

Return ONLY a valid JSON object with this exact shape:
{"documentIndex": 0, "sectionIndex": 0, "confidence": 0.82, "alternateSectionIndex": 1}

Rules:
- Keep alternateSectionIndex equal to sectionIndex when confidence is 0.6 or above.
- Never pick a section index that does not exist in the selected document.

Do not return markdown or explanation.`;

export const layerThreePrompt = (userQuery, rawText) =>
    `You are a Nepali legal assistant. Answer the question using ONLY the text below.
You may count or aggregate across the text. Be specific. Cite articles where relevant.
If the text lacks sufficient information, reply with only: INSUFFICIENT_CONTEXT

Question: "${userQuery}"

${rawText}`;