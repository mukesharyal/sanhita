const DB_NAME = "sanhita-chat-db";
const DB_VERSION = 1;
const STORE_NAME = "conversations";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction(mode, handler) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const request = handler(store);

        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error || request?.error);
        tx.onabort = () => reject(tx.error || request?.error);
      })
  );
}

export async function loadConversations() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const conversations = request.result || [];
      conversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(conversations);
    };

    request.onerror = () => reject(request.error);
  });
}

export function saveConversation(conversation) {
  return runTransaction("readwrite", (store) => store.put(conversation));
}

export function saveConversations(conversations) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);

        for (const conversation of conversations) {
          store.put(conversation);
        }

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

export function deleteConversation(conversationId) {
  return runTransaction("readwrite", (store) => store.delete(conversationId));
}
