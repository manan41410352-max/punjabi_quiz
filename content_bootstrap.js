// content_bootstrap.js
// Loads content.json (if present) and merges it into CLASSES defined in data.js.
// This lets server-side / admin-managed content override or extend the built-in data.

(function () {
  if (typeof window === "undefined") return;

  if (typeof window.CLASSES === "undefined") {
    window.CONTENT_READY = Promise.resolve();
    return;
  }

  async function mergeContentJson() {
    try {
      // Try to fetch content.json from the same root
      const res = await fetch("content.json", { cache: "no-store" });
      if (!res.ok) {
        // No override file is fine; just use built-in data.js
        return;
      }
      const extra = await res.json();
      if (!extra || typeof extra !== "object") return;

      Object.keys(extra).forEach((classKey) => {
        const incomingClass = extra[classKey];
        if (!incomingClass) return;

        // New class: add directly
        if (!window.CLASSES[classKey]) {
          window.CLASSES[classKey] = incomingClass;
          return;
        }

        // Existing class: shallow-merge id/name, and merge chapters by id
        const base = window.CLASSES[classKey];
        base.name = incomingClass.name || base.name;
        base.id = incomingClass.id || base.id;

        if (Array.isArray(incomingClass.chapters)) {
          const existingChapters = Array.isArray(base.chapters) ? base.chapters : [];
          const byId = new Map(existingChapters.map((ch) => [ch.id, ch]));

          incomingClass.chapters.forEach((incomingCh) => {
            if (!incomingCh || !incomingCh.id) return;
            const prev = byId.get(incomingCh.id) || {};
            byId.set(incomingCh.id, Object.assign({}, prev, incomingCh));
          });

          base.chapters = Array.from(byId.values());
        }
      });
    } catch (err) {
      console.error("Error merging content.json:", err);
    }
  }

  window.CONTENT_READY = mergeContentJson();
})();
