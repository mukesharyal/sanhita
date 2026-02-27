<script>
    import { runPipeline } from "$lib/pipeline.js";

    let queryInput;
    let answer = "";
    let status = "idle";
    let statusMessage = "";
    let generatedQueries = [];
    let usedFallback = false;

    function onStatus(newStatus, message) {
        status = newStatus;
        statusMessage = message;
    }

    async function startQueryProcessing(event) {
        event.preventDefault();
        const userQuery = queryInput.value.trim();
        if (!userQuery) return;

        answer = "";
        generatedQueries = [];
        usedFallback = false;

        try {
            const result = await runPipeline(userQuery, onStatus);
            answer = result.answer;
            generatedQueries = result.queries;
            usedFallback = result.usedFallback;
            status = "done";
            statusMessage = "";
        } catch (err) {
            console.error(err);
            status = "error";
            statusMessage = "Something went wrong. Please try again.";
        }
    }
</script>

<svelte:head>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Source+Serif+4:ital,wght@0,300;0,400;1,300&display=swap" rel="stylesheet" />
</svelte:head>

<div class="app">
    <div class="background">
        <div class="grid-overlay"></div>
    </div>

    <main>
        <header>
            <div class="emblem">⚖</div>
            <h1>Nepal Legal Assistant</h1>
            <p class="subtitle">Constitutional & Legal Document Search</p>
        </header>

        <section class="search-section">
            <form onsubmit={startQueryProcessing} method="post">
                <div class="input-wrapper">
                    <textarea
                        bind:this={queryInput}
                        placeholder="Ask a legal question about Nepali law…"
                        name="query"
                        autocomplete="off"
                        rows="3"
                    ></textarea>
                    <button
                        type="submit"
                        disabled={status === "processing" || status === "searching" || status === "extracting" || status === "answering"}
                    >
                        {#if status !== "idle" && status !== "done" && status !== "error"}
                            <span class="spinner"></span>
                        {:else}
                            <span>Ask</span>
                        {/if}
                    </button>
                </div>
            </form>
        </section>

        {#if statusMessage}
            <div class="status-bar">
                <span class="status-dot"></span>
                {statusMessage}
            </div>
        {/if}

        {#if generatedQueries.length > 0}
            <section class="queries-section">
                <h2 class="section-label">Search Variations</h2>
                <ul class="query-list">
                    {#each generatedQueries as query, i}
                        <li>
                            <span class="query-index">{i + 1}</span>
                            <span class="query-text">{query}</span>
                        </li>
                    {/each}
                </ul>
            </section>
        {/if}

        {#if answer}
            <section class="answer-section">
                <div class="answer-header">
                    <h2 class="section-label">Legal Answer</h2>
                    {#if usedFallback}
                        <span class="fallback-badge">PDF Fallback Used</span>
                    {:else}
                        <span class="semantic-badge">Semantic Search</span>
                    {/if}
                </div>
                <div class="answer-card">
                    <div class="answer-body">{answer}</div>
                </div>
            </section>
        {/if}

        {#if status === "error"}
            <div class="error-message">{statusMessage}</div>
        {/if}
    </main>
</div>

<style>
    :global(*) {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }

    :global(body) {
        background: #0d0d0f;
        color: #e8e0d0;
        font-family: 'Source Serif 4', Georgia, serif;
    }

    .app {
        min-height: 100vh;
        position: relative;
        overflow-x: hidden;
    }

    .background {
        position: fixed;
        inset: 0;
        background: radial-gradient(ellipse at 20% 20%, #1a1208 0%, #0d0d0f 60%);
        z-index: 0;
    }

    .grid-overlay {
        position: absolute;
        inset: 0;
        background-image:
            linear-gradient(rgba(180, 140, 60, 0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(180, 140, 60, 0.04) 1px, transparent 1px);
        background-size: 60px 60px;
    }

    main {
        position: relative;
        z-index: 1;
        max-width: 780px;
        margin: 0 auto;
        padding: 60px 24px 100px;
    }

    header {
        text-align: center;
        margin-bottom: 56px;
    }

    .emblem {
        font-size: 2.8rem;
        display: block;
        margin-bottom: 16px;
        filter: drop-shadow(0 0 20px rgba(180, 140, 60, 0.5));
    }

    h1 {
        font-family: 'Playfair Display', Georgia, serif;
        font-size: clamp(2rem, 5vw, 3rem);
        font-weight: 700;
        color: #f0e6c8;
        letter-spacing: -0.02em;
        line-height: 1.1;
    }

    .subtitle {
        margin-top: 10px;
        font-size: 0.9rem;
        color: #8a7d5a;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        font-weight: 300;
    }

    .search-section {
        margin-bottom: 28px;
    }

    .input-wrapper {
        display: flex;
        gap: 12px;
        align-items: flex-end;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(180, 140, 60, 0.2);
        border-radius: 4px;
        padding: 16px;
        transition: border-color 0.2s;
    }

    .input-wrapper:focus-within {
        border-color: rgba(180, 140, 60, 0.5);
    }

    textarea {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: #e8e0d0;
        font-family: 'Source Serif 4', Georgia, serif;
        font-size: 1rem;
        font-weight: 300;
        line-height: 1.6;
        resize: none;
        caret-color: #b48c3c;
    }

    textarea::placeholder {
        color: #4a4232;
        font-style: italic;
    }

    button[type="submit"] {
        flex-shrink: 0;
        background: #b48c3c;
        color: #0d0d0f;
        border: none;
        border-radius: 3px;
        padding: 10px 24px;
        font-family: 'Playfair Display', serif;
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
        letter-spacing: 0.03em;
        transition: background 0.2s, transform 0.1s;
        min-width: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    button[type="submit"]:hover:not(:disabled) {
        background: #c9a04a;
    }

    button[type="submit"]:active:not(:disabled) {
        transform: scale(0.98);
    }

    button[type="submit"]:disabled {
        background: #3a3020;
        color: #6a5a38;
        cursor: not-allowed;
    }

    .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid #6a5a38;
        border-top-color: #b48c3c;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        display: inline-block;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    .status-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 0.85rem;
        color: #8a7d5a;
        margin-bottom: 28px;
        font-style: italic;
        letter-spacing: 0.02em;
    }

    .status-dot {
        width: 7px;
        height: 7px;
        background: #b48c3c;
        border-radius: 50%;
        animation: pulse 1.2s ease-in-out infinite;
        flex-shrink: 0;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.8); }
    }

    .section-label {
        font-family: 'Playfair Display', serif;
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #b48c3c;
        margin-bottom: 16px;
    }

    .queries-section {
        margin-bottom: 36px;
    }

    .query-list {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .query-list li {
        display: flex;
        align-items: baseline;
        gap: 14px;
        padding: 10px 16px;
        background: rgba(180, 140, 60, 0.05);
        border-left: 2px solid rgba(180, 140, 60, 0.25);
        border-radius: 0 3px 3px 0;
    }

    .query-index {
        font-family: 'Playfair Display', serif;
        font-size: 0.75rem;
        color: #b48c3c;
        opacity: 0.7;
        flex-shrink: 0;
    }

    .query-text {
        font-size: 0.9rem;
        color: #c8bda0;
        font-weight: 300;
        font-style: italic;
    }

    .answer-section {
        margin-bottom: 36px;
    }

    .answer-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
    }

    .answer-header .section-label {
        margin-bottom: 0;
    }

    .fallback-badge {
        font-size: 0.7rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        background: rgba(192, 115, 90, 0.15);
        color: #c0735a;
        border: 1px solid rgba(192, 115, 90, 0.3);
        padding: 3px 10px;
        border-radius: 20px;
    }

    .semantic-badge {
        font-size: 0.7rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        background: rgba(180, 140, 60, 0.1);
        color: #b48c3c;
        border: 1px solid rgba(180, 140, 60, 0.25);
        padding: 3px 10px;
        border-radius: 20px;
    }

    .answer-card {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(180, 140, 60, 0.15);
        border-radius: 4px;
        padding: 28px 32px;
        position: relative;
        overflow: hidden;
    }

    .answer-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(90deg, #b48c3c, transparent);
    }

    .answer-body {
        font-size: 1rem;
        line-height: 1.8;
        color: #d8cebc;
        font-weight: 300;
        white-space: pre-wrap;
    }

    .error-message {
        color: #c0735a;
        font-size: 0.9rem;
        padding: 14px 18px;
        border: 1px solid rgba(192, 115, 90, 0.3);
        border-radius: 4px;
        background: rgba(192, 115, 90, 0.05);
    }
</style>