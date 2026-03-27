<script>
    import { onMount } from "svelte";
    import { runPipeline } from "$lib/pipeline.js";
    import { preloadEmbedder, getEmbedderStatus } from "$lib/embed.js";
    import { preloadSearchIndex, getSourceStatus } from "$lib/search.js";
    import SearchPreview from "../components/SearchPreview.svelte";
    import ResultPagePreview from "../components/ResultPagePreview.svelte";
    import SanhitaAvatar from "../components/SanhitaAvatar.svelte";
    import { loadConversations, saveConversation, deleteConversation as deleteConversationFromStore } from "$lib/chatHistoryStore.js";

    let queryInput;
    let questionDraft = "";
    let conversations = [];
    let activeConversationId = null;
    let status = "idle";
    let statusMessage = "";
    let isPreviewOpen = false;
    let previewResult = null;
    let turnCounter = 0;
    let sidebarOpen = false;
    let isLoadingConversations = true;
    let modelStatus = "idle";
    let modelStatusMessage = "Calling Sanhita... Sanhita is on the way...";
    let sourceStatus = "idle";
    let sourceStatusMessage = "Source index not initialized yet.";
    let sourceProgress = 0;

    const WORKING_STATUSES = ["processing", "searching", "extracting", "answering"];
    const DEFAULT_TITLE = "New Chat";

    $: isWorking = WORKING_STATUSES.includes(status);
    $: activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) || null;
    $: activeTurns = activeConversation?.turns || [];
    $: latestAnsweredTurn = [...activeTurns].reverse().find((turn) => !!turn.answer) || null;
    $: sortedConversations = [...conversations].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    $: isStartupLoading = modelStatus !== "ready" || sourceStatus !== "ready";
    $: sanhitaMode = isWorking
        ? "thinking"
        : latestAnsweredTurn?.answer
            ? "smile"
            : questionDraft.trim().length > 0
                ? "tracking"
                : "idle";

    function syncInitialWarmupState() {
        modelStatus = getEmbedderStatus();
        modelStatusMessage = modelStatus === "ready"
            ? "Sanhita has arrived!"
            : modelStatus === "loading"
                ? "Calling Sanhita... Sanhita is on the way..."
                : modelStatus === "error"
                    ? "Language model failed to load."
                    : "Calling Sanhita... Sanhita is on the way...";

        const currentSource = getSourceStatus();
        sourceStatus = currentSource.state;
        sourceProgress = currentSource.progress;
        sourceStatusMessage = sourceStatus === "ready"
            ? "Legal source index ready."
            : sourceStatus === "loading"
                ? "Importing कागजात from सर्वोच्च अदालत..."
                : sourceStatus === "error"
                    ? "Legal source index failed to load."
                    : "Source index not initialized yet.";
    }

    async function warmupSearchAndModel() {
        syncInitialWarmupState();

        const modelWarmup = preloadEmbedder()
            .then(() => {
                modelStatus = "ready";
                modelStatusMessage = "Sanhita has arrived!";
            })
            .catch((error) => {
                console.error("Model warm-up failed:", error);
                modelStatus = "error";
                modelStatusMessage = "Language model failed to load.";
            });

        const sourceWarmup = preloadSearchIndex((event) => {
            sourceStatus = event.state;
            sourceProgress = event.progress;
            sourceStatusMessage = event.state === "loading"
                ? "Importing कागजात from सर्वोच्च अदालत..."
                : event.message;
        })
            .then(() => {
                sourceStatus = "ready";
                sourceProgress = 100;
                sourceStatusMessage = "Legal source index ready.";
            })
            .catch((error) => {
                console.error("Source index warm-up failed:", error);
                sourceStatus = "error";
                sourceStatusMessage = "Legal source index failed to load.";
            });

        await Promise.allSettled([modelWarmup, sourceWarmup]);
    }

    function createConversation(seedQuery = "") {
        const now = Date.now();
        const cleaned = seedQuery.trim();
        const title = cleaned ? cleaned.slice(0, 52) : DEFAULT_TITLE;

        return {
            id: `conv-${now}-${Math.random().toString(36).slice(2, 8)}`,
            title,
            turns: [],
            createdAt: now,
            updatedAt: now,
        };
    }

    function pickConversationTitle(userQuery, generatedQueries) {
        const options = Array.isArray(generatedQueries)
            ? generatedQueries.map((item) => (item || "").trim()).filter(Boolean)
            : [];

        if (options.length > 0) {
            const randomIndex = Math.floor(Math.random() * options.length);
            return options[randomIndex].slice(0, 52);
        }

        return (userQuery || DEFAULT_TITLE).trim().slice(0, 52) || DEFAULT_TITLE;
    }

    function persistConversation(conversation) {
        if (!conversation) return;
        saveConversation(conversation).catch((error) => {
            console.error("Failed to persist conversation:", error);
        });
    }

    function upsertConversation(conversationId, updater) {
        let updatedConversation = null;

        conversations = conversations.map((conversation) => {
            if (conversation.id !== conversationId) return conversation;
            updatedConversation = updater(conversation);
            return updatedConversation;
        });

        persistConversation(updatedConversation);
        return updatedConversation;
    }

    function createNewChatAndActivate() {
        const conversation = createConversation();
        conversations = [conversation, ...conversations];
        activeConversationId = conversation.id;
        status = "idle";
        statusMessage = "";
        isPreviewOpen = false;
        previewResult = null;
        questionDraft = "";
        sidebarOpen = false;
        persistConversation(conversation);
    }

    function selectConversation(conversationId) {
        activeConversationId = conversationId;
        sidebarOpen = false;
        isPreviewOpen = false;
        previewResult = null;
        status = "idle";
        statusMessage = "";
    }

    async function deleteConversation(conversationId, event) {
        event?.stopPropagation?.();

        const nextConversations = conversations.filter((conversation) => conversation.id !== conversationId);
        conversations = nextConversations;

        try {
            await deleteConversationFromStore(conversationId);
        } catch (error) {
            console.error("Failed to delete conversation:", error);
        }

        if (activeConversationId === conversationId) {
            if (nextConversations.length > 0) {
                activeConversationId = nextConversations[0].id;
            } else {
                createNewChatAndActivate();
            }
        }
    }

    onMount(async () => {
        warmupSearchAndModel();

        try {
            const stored = await loadConversations();
            conversations = stored;

            const maxTurnId = stored
                .flatMap((conversation) => conversation.turns || [])
                .map((turn) => Number(turn.id) || 0)
                .reduce((max, id) => Math.max(max, id), 0);
            turnCounter = maxTurnId;

            if (stored.length > 0) {
                activeConversationId = stored[0].id;
            } else {
                createNewChatAndActivate();
            }
        } catch (error) {
            console.error("Failed to load conversations:", error);
            createNewChatAndActivate();
        } finally {
            isLoadingConversations = false;
        }
    });

    function openPreview(result) {
        previewResult = result;
        isPreviewOpen = true;
    }

    function closePreview() {
        isPreviewOpen = false;
        previewResult = null;
    }

    function onStatus(newStatus, message) {
        status = newStatus;
        statusMessage = message;
    }

    async function startQueryProcessing(event) {
        event.preventDefault();
        const userQuery = queryInput.value.trim();
        if (!userQuery) return;

        if (!activeConversationId) {
            createNewChatAndActivate();
        }

        const conversationId = activeConversationId;
        if (!conversationId) return;

        const turnId = ++turnCounter;

        upsertConversation(conversationId, (conversation) => ({
            ...conversation,
            title: conversation.turns.length === 0 ? userQuery.slice(0, 52) : conversation.title,
            updatedAt: Date.now(),
            turns: [
                ...conversation.turns,
                {
                    id: turnId,
                    query: userQuery,
                    answer: "",
                    topResult: null,
                    error: "",
                }
            ]
        }));

        questionDraft = "";
        isPreviewOpen = false;
        previewResult = null;

        try {
            const result = await runPipeline(userQuery, onStatus);

            upsertConversation(conversationId, (conversation) => ({
                ...conversation,
                title: conversation.turns.length <= 1
                    ? pickConversationTitle(userQuery, result.queries)
                    : conversation.title,
                updatedAt: Date.now(),
                turns: conversation.turns.map((turn) =>
                    turn.id === turnId
                        ? {
                            ...turn,
                            answer: result.answer,
                            topResult: result.previewResult || (result.searchResults || [])[0] || null,
                            error: "",
                        }
                        : turn
                ),
            }));

            status = "done";
            statusMessage = "";
        } catch (err) {
            console.error(err);
            upsertConversation(conversationId, (conversation) => ({
                ...conversation,
                updatedAt: Date.now(),
                turns: conversation.turns.map((turn) =>
                    turn.id === turnId
                        ? {
                            ...turn,
                            error: "Something went wrong. Please try again.",
                        }
                        : turn
                ),
            }));
            status = "error";
            statusMessage = "Something went wrong. Please try again.";
        }
    }
</script>

<svelte:head>
    <title>Sanhita - Legal Assistant</title>
    <meta name="description" content="Sanhita, your law-focused assistant for Nepali legal research and source-backed answers." />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Source+Serif+4:ital,wght@0,300;0,400;1,300&display=swap" rel="stylesheet" />
</svelte:head>

<div class="app">
    <div class="background">
        <div class="grid-overlay"></div>
    </div>

    <div class="layout-shell">
        <aside class={`sidebar ${sidebarOpen ? "open" : ""}`}>
            <div class="sidebar-header">
                <h2>Chats</h2>
                <div class="sidebar-actions">
                    <button type="button" class="new-chat-button" onclick={createNewChatAndActivate}>+ New</button>
                    <button type="button" class="close-sidebar-button" onclick={() => (sidebarOpen = false)} aria-label="Close chats panel">✕</button>
                </div>
            </div>

            <div class="sidebar-list">
                {#if isLoadingConversations}
                    <p class="sidebar-state">Loading chats...</p>
                {:else if sortedConversations.length === 0}
                    <p class="sidebar-state">No saved chats yet.</p>
                {:else}
                    {#each sortedConversations as conversation}
                        <button
                            type="button"
                            class={`sidebar-item ${conversation.id === activeConversationId ? "active" : ""}`}
                            onclick={() => selectConversation(conversation.id)}
                        >
                            <span class="sidebar-row-top">
                                <span class="sidebar-title">{conversation.title || DEFAULT_TITLE}</span>
                                <span
                                    class="sidebar-delete"
                                    role="button"
                                    tabindex="0"
                                    onclick={(event) => deleteConversation(conversation.id, event)}
                                    onkeydown={(event) => (event.key === "Enter" || event.key === " ") && deleteConversation(conversation.id, event)}
                                    aria-label="Delete conversation"
                                    title="Delete chat"
                                >
                                    ×
                                </span>
                            </span>
                            <span class="sidebar-meta">{new Date(conversation.updatedAt || conversation.createdAt || Date.now()).toLocaleString()}</span>
                        </button>
                    {/each}
                {/if}
            </div>
        </aside>

        <button
            type="button"
            class={`sidebar-backdrop ${sidebarOpen ? "open" : ""}`}
            onclick={() => (sidebarOpen = false)}
            aria-label="Close sidebar"
        ></button>

        <main>
            <header>
                <div class="header-row">
                    <button type="button" class="mobile-menu-button" onclick={() => (sidebarOpen = !sidebarOpen)}>Chats</button>
                    <div class="brand-avatar">
                        <SanhitaAvatar size={86} mode={sanhitaMode} trackText={questionDraft} />
                    </div>
                </div>
                <h1>Sanhita</h1>
                <p class="subtitle">Nepali Legal Assistant</p>
                {#if isStartupLoading}
                    <div class="startup-status" role="status" aria-live="polite">
                        <div class="startup-row">
                            <span class={`dot ${modelStatus === "ready" ? "ready" : modelStatus === "error" ? "error" : "loading"}`}></span>
                            <span>Model: {modelStatusMessage}</span>
                        </div>
                        <div class="startup-row">
                            <span class={`dot ${sourceStatus === "ready" ? "ready" : sourceStatus === "error" ? "error" : "loading"}`}></span>
                            <span>Sources: {sourceStatusMessage}</span>
                        </div>
                        {#if sourceStatus === "loading"}
                            <div class="startup-progress">
                                <div class="startup-progress-fill" style={`width: ${Math.max(4, sourceProgress)}%`}></div>
                            </div>
                        {/if}
                    </div>
                {/if}
            </header>

            <section class="chat-thread" aria-live="polite">
                {#each activeTurns as turn}
                    <article class="chat-row user-row">
                        <div class="chat-avatar user-avatar">U</div>
                        <div class="chat-bubble user-bubble">{turn.query}</div>
                    </article>

                    {#if !turn.answer && !turn.error}
                        <article class="chat-row assistant-row loading-row">
                            <div class="chat-avatar orb-avatar" aria-hidden="true">
                                <span class="chat-orb"></span>
                            </div>
                            <div class="chat-bubble assistant-bubble loading-bubble">
                                <span class="spinner"></span>
                                <span>{statusMessage || "Working on your request..."}</span>
                            </div>
                        </article>
                    {/if}

                    {#if turn.answer}
                        <article class="chat-row assistant-row">
                            <div class="chat-avatar orb-avatar" aria-hidden="true">
                                <span class="chat-orb"></span>
                            </div>
                            <div class="chat-bubble assistant-bubble">
                                <div class="answer-body">{turn.answer}</div>
                                {#if turn.topResult}
                                    <ResultPagePreview result={turn.topResult} on:open={() => openPreview(turn.topResult)} />
                                {/if}
                            </div>
                        </article>
                    {/if}

                    {#if turn.error}
                        <article class="chat-row assistant-row">
                            <div class="chat-avatar orb-avatar" aria-hidden="true">
                                <span class="chat-orb"></span>
                            </div>
                            <div class="chat-bubble assistant-bubble error-bubble">{turn.error}</div>
                        </article>
                    {/if}
                {/each}

                {#if activeTurns.length === 0 && status === "idle"}
                    <article class="chat-row assistant-row">
                        <div class="chat-avatar orb-avatar" aria-hidden="true">
                            <span class="chat-orb"></span>
                        </div>
                        <div class="chat-bubble assistant-bubble welcome-bubble">
                            Namaste. I am Sanhita, your law guide. Ask your legal question and I will respond with source-backed context.
                        </div>
                    </article>
                {/if}
            </section>

            <section class="composer-section">
                <form onsubmit={startQueryProcessing} method="post">
                    <div class="input-wrapper">
                        <textarea
                            bind:this={queryInput}
                            bind:value={questionDraft}
                            placeholder="Ask Sanhita a legal question about Nepali law..."
                            name="query"
                            autocomplete="off"
                            rows="3"
                        ></textarea>
                        {#if !isStartupLoading}
                            <button
                                type="submit"
                                disabled={status === "processing" || status === "searching" || status === "extracting" || status === "answering"}
                            >
                                {#if status !== "idle" && status !== "done" && status !== "error"}
                                    <span class="spinner"></span>
                                {:else}
                                    <span>Send</span>
                                {/if}
                            </button>
                        {:else}
                            <div class="composer-warmup-note" aria-live="polite">
                                Preparing Sanhita and legal sources...
                            </div>
                        {/if}
                    </div>
                </form>
            </section>

            {#if isPreviewOpen && previewResult}
                <SearchPreview
                    result={previewResult}
                    on:close={closePreview}
                />
            {/if}
        </main>
    </div>
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

    .layout-shell {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr);
        min-height: 100vh;
    }

    .sidebar {
        border-right: 1px solid rgba(180, 140, 60, 0.2);
        background: rgba(6, 6, 8, 0.45);
        backdrop-filter: blur(3px);
        padding: 18px 12px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        overflow-y: auto;
    }

    .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
    }

    .sidebar-actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .sidebar-header h2 {
        font-family: 'Playfair Display', serif;
        color: #e9dbb8;
        font-size: 1.05rem;
    }

    .new-chat-button {
        border: 1px solid rgba(180, 140, 60, 0.35);
        background: rgba(180, 140, 60, 0.12);
        color: #dec58f;
        border-radius: 5px;
        padding: 6px 10px;
        font-size: 0.78rem;
        cursor: pointer;
    }

    .new-chat-button:hover {
        background: rgba(180, 140, 60, 0.2);
    }

    .close-sidebar-button {
        display: none;
        border: 1px solid rgba(180, 140, 60, 0.28);
        background: rgba(180, 140, 60, 0.08);
        color: #dec58f;
        border-radius: 5px;
        width: 30px;
        height: 30px;
        cursor: pointer;
        line-height: 1;
    }

    .close-sidebar-button:hover {
        background: rgba(180, 140, 60, 0.18);
    }

    .sidebar-backdrop {
        display: none;
    }

    .sidebar-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .sidebar-item {
        width: 100%;
        text-align: left;
        border: 1px solid rgba(180, 140, 60, 0.18);
        background: rgba(255, 255, 255, 0.03);
        border-radius: 7px;
        padding: 10px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 5px;
    }

    .sidebar-item.active {
        border-color: rgba(180, 140, 60, 0.45);
        background: rgba(180, 140, 60, 0.12);
    }

    .sidebar-title {
        color: #e2d3ad;
        font-size: 0.88rem;
        line-height: 1.3;
    }

    .sidebar-row-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
    }

    .sidebar-delete {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #a88d59;
        font-size: 0.95rem;
        line-height: 1;
        flex-shrink: 0;
        opacity: 0.7;
    }

    .sidebar-delete:hover,
    .sidebar-delete:focus {
        background: rgba(192, 115, 90, 0.16);
        color: #d59a8b;
        opacity: 1;
        outline: none;
    }

    .sidebar-meta {
        color: #9f8b60;
        font-size: 0.72rem;
    }

    .sidebar-state {
        color: #9f8b60;
        font-size: 0.84rem;
        font-style: italic;
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
        max-width: 920px;
        width: 100%;
        margin: 0 auto;
        padding: 60px 24px 100px;
    }

    .header-row {
        display: flex;
        justify-content: center;
        align-items: center;
        position: relative;
    }

    .mobile-menu-button {
        display: none;
        position: absolute;
        left: 0;
        top: 10px;
        border: 1px solid rgba(180, 140, 60, 0.35);
        background: rgba(180, 140, 60, 0.12);
        color: #dec58f;
        border-radius: 5px;
        padding: 6px 10px;
        font-size: 0.78rem;
        cursor: pointer;
    }

    header {
        text-align: center;
        margin-bottom: 56px;
    }

    .emblem {
        display: none;
    }

    .brand-avatar {
        display: inline-flex;
        margin-bottom: 14px;
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

    .startup-status {
        margin: 16px auto 0;
        width: min(620px, 100%);
        border: 1px solid rgba(180, 140, 60, 0.2);
        background: rgba(255, 255, 255, 0.02);
        border-radius: 8px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        text-align: left;
    }

    .startup-row {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #bba97f;
        font-size: 0.84rem;
        line-height: 1.35;
    }

    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        display: inline-block;
        flex-shrink: 0;
    }

    .dot.loading {
        background: #c9a04a;
        box-shadow: 0 0 8px rgba(201, 160, 74, 0.5);
    }

    .dot.ready {
        background: #7cb37f;
        box-shadow: 0 0 8px rgba(124, 179, 127, 0.45);
    }

    .dot.error {
        background: #d59a8b;
        box-shadow: 0 0 8px rgba(213, 154, 139, 0.45);
    }

    .startup-progress {
        height: 5px;
        background: rgba(180, 140, 60, 0.15);
        border-radius: 999px;
        overflow: hidden;
    }

    .startup-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #9f7b3a, #d4ad5f);
        transition: width 0.2s ease;
    }

    .chat-thread {
        display: flex;
        flex-direction: column;
        gap: 18px;
        margin-bottom: 24px;
    }

    .chat-row {
        display: flex;
        gap: 10px;
        align-items: flex-start;
    }

    .user-row {
        justify-content: flex-end;
    }

    .assistant-row {
        justify-content: flex-start;
    }

    .chat-avatar {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        flex-shrink: 0;
    }

    .orb-avatar {
        background: transparent;
        border: none;
        box-shadow: none;
        padding-top: 1px;
    }

    .chat-orb {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: inline-block;
        background:
            radial-gradient(circle at 30% 28%, rgba(255, 246, 220, 0.8), rgba(255, 246, 220, 0.12) 36%, rgba(255, 246, 220, 0) 48%),
            conic-gradient(from 0deg, #f6dfaa 0%, #e7bc73 24%, #c88f4a 49%, #a16a35 74%, #f6dfaa 100%);
        box-shadow: 0 0 0 1px rgba(180, 140, 60, 0.35), 0 0 16px rgba(180, 140, 60, 0.35);
        position: relative;
    }

    .loading-row .chat-orb {
        animation: orbSpin 2.2s linear infinite;
    }

    .user-avatar {
        background: rgba(220, 220, 220, 0.12);
        color: #d8cebc;
        border: 1px solid rgba(220, 220, 220, 0.22);
        order: 2;
    }

    .chat-bubble {
        max-width: min(100%, 660px);
        border-radius: 10px;
        padding: 14px 16px;
        line-height: 1.65;
    }

    .assistant-bubble {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(180, 140, 60, 0.17);
        color: #d8cebc;
    }

    .user-bubble {
        background: rgba(180, 140, 60, 0.18);
        border: 1px solid rgba(180, 140, 60, 0.38);
        color: #f0e6c8;
        margin-left: auto;
        order: 1;
    }

    .loading-bubble {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .welcome-bubble {
        color: #bba97f;
        font-style: italic;
    }

    .error-bubble {
        border-color: rgba(192, 115, 90, 0.4);
        background: rgba(192, 115, 90, 0.08);
        color: #dfb3a9;
    }

    .composer-section {
        position: sticky;
        bottom: 16px;
        z-index: 5;
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
        color: #f0e8d6;
        font-family: 'Source Serif 4', Georgia, serif;
        font-size: 1rem;
        font-weight: 300;
        line-height: 1.6;
        resize: none;
        caret-color: #b48c3c;
    }

    textarea::placeholder {
        color: #8f7e57;
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

    .composer-warmup-note {
        min-width: 180px;
        text-align: right;
        color: #9f8b60;
        font-size: 0.8rem;
        font-style: italic;
        line-height: 1.35;
        padding-bottom: 4px;
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

    @keyframes orbSpin {
        to { transform: rotate(360deg); }
    }

    .answer-body {
        font-size: 1rem;
        line-height: 1.8;
        color: #d8cebc;
        font-weight: 300;
        white-space: pre-wrap;
    }

    @media (prefers-color-scheme: light) {
        :global(body) {
            background: #f5efe4;
            color: #2f250f;
        }

        .background {
            background: radial-gradient(ellipse at 20% 20%, #f6f0e3 0%, #eee2cf 60%);
        }

        .grid-overlay {
            background-image:
                linear-gradient(rgba(139, 109, 45, 0.08) 1px, transparent 1px),
                linear-gradient(90deg, rgba(139, 109, 45, 0.08) 1px, transparent 1px);
        }

        .sidebar {
            border-right-color: rgba(154, 118, 45, 0.28);
            background: rgba(255, 252, 246, 0.78);
        }

        .sidebar-header h2 {
            color: #3e2f12;
        }

        .sidebar-item {
            border-color: rgba(154, 118, 45, 0.24);
            background: rgba(255, 255, 255, 0.86);
        }

        .sidebar-item.active {
            border-color: rgba(154, 118, 45, 0.52);
            background: rgba(180, 140, 60, 0.18);
        }

        .sidebar-title {
            color: #392a0f;
        }

        .sidebar-meta,
        .sidebar-state,
        .subtitle {
            color: #35270d;
        }

        .new-chat-button,
        .mobile-menu-button,
        .close-sidebar-button {
            border-color: rgba(154, 118, 45, 0.36);
            background: rgba(180, 140, 60, 0.14);
            color: #4e3a14;
        }

        h1 {
            color: #3d2d0f;
        }

        .startup-status,
        .assistant-bubble,
        .input-wrapper {
            border-color: rgba(154, 118, 45, 0.24);
            background: rgba(255, 255, 255, 0.78);
        }

        .startup-row,
        .answer-body,
        .assistant-bubble {
            color: #261b08;
        }

        .welcome-bubble,
        .composer-warmup-note,
        textarea::placeholder {
            color: #3a2b0e;
        }

        .user-avatar {
            background: rgba(141, 110, 46, 0.16);
            color: #443311;
            border-color: rgba(141, 110, 46, 0.3);
        }

        .user-bubble {
            background: rgba(180, 140, 60, 0.22);
            border-color: rgba(154, 118, 45, 0.44);
            color: #3a2b10;
        }

        .error-bubble {
            border-color: rgba(192, 115, 90, 0.45);
            background: rgba(192, 115, 90, 0.1);
            color: #6e352b;
        }

        textarea {
            color: #1f1708;
            caret-color: #9f7b3a;
        }

        .sidebar-delete {
            color: #4a3712;
        }

        .sidebar-delete:hover,
        .sidebar-delete:focus {
            color: #8e4d3f;
        }

        button[type="submit"] {
            background: #b48837;
            color: #fff8ea;
        }

        button[type="submit"]:hover:not(:disabled) {
            background: #c79a42;
        }

        button[type="submit"]:disabled {
            background: #d6c3a0;
            color: #8f7442;
        }

        .spinner {
            border-color: #d6c3a0;
            border-top-color: #9f7b3a;
        }

        @media (max-width: 768px) {
            .sidebar {
                background: #f7efe3;
            }

            .sidebar-backdrop {
                background: rgba(60, 44, 20, 0.22);
            }
        }
    }

    @media (max-width: 768px) {
        .layout-shell {
            grid-template-columns: 1fr;
        }

        .sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            width: 84vw;
            max-width: 300px;
            background: #0a0a0d;
            backdrop-filter: none;
            transform: translateX(-102%);
            transition: transform 0.2s ease;
            z-index: 20;
            box-shadow: 20px 0 30px rgba(0, 0, 0, 0.35);
        }

        .sidebar.open {
            transform: translateX(0);
        }

        .mobile-menu-button {
            display: inline-flex;
        }

        .close-sidebar-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        .sidebar-backdrop {
            display: block;
            position: fixed;
            inset: 0;
            z-index: 15;
            border: none;
            background: rgba(0, 0, 0, 0.45);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
        }

        .sidebar-backdrop.open {
            opacity: 1;
            pointer-events: auto;
        }

        main {
            padding: 36px 14px 92px;
        }

        .chat-avatar {
            width: 30px;
            height: 30px;
        }

        .chat-bubble {
            max-width: 100%;
            padding: 12px 13px;
        }
    }

</style>