/* ===========================================================
   Hitster Foto-Trainer – App-Logik
   Speichert eigene Fotos der Hitster-Karten in IndexedDB (lokal
   im Browser). Kein Song-Wissen in der App noetig: der Nutzer
   bewertet sich anhand des tatsaechlichen Kartenfotos selbst.
   =========================================================== */

(function () {
  "use strict";

  // ---------------------------------------------------------
  // Hilfsfunktionen
  // ---------------------------------------------------------

  function uid() {
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  function shuffle(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------------------------------------------------------
  // IndexedDB Speicherschicht
  // ---------------------------------------------------------

  const DB_NAME = "hitster-photo-trainer";
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB wird von diesem Browser nicht unterstützt."));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("cardSets")) {
          db.createObjectStore("cardSets", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("cards")) {
          const store = db.createObjectStore("cards", { keyPath: "id" });
          store.createIndex("cardSetId", "cardSetId", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeNames, mode) {
    return openDb().then((db) => db.transaction(storeNames, mode));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const Store = {
    async addCardSet(cardSet) {
      const t = await tx(["cardSets"], "readwrite");
      t.objectStore("cardSets").add(cardSet);
      return new Promise((res, rej) => { t.oncomplete = () => res(cardSet); t.onerror = () => rej(t.error); });
    },
    async getAllCardSets() {
      const t = await tx(["cardSets"], "readonly");
      const result = await reqToPromise(t.objectStore("cardSets").getAll());
      return result || [];
    },
    async deleteCardSet(id) {
      const t = await tx(["cardSets", "cards"], "readwrite");
      t.objectStore("cardSets").delete(id);
      const idx = t.objectStore("cards").index("cardSetId");
      const cursorReq = idx.openCursor(IDBKeyRange.only(id));
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
    },
    async addCards(cards) {
      const t = await tx(["cards"], "readwrite");
      const store = t.objectStore("cards");
      cards.forEach((c) => store.add(c));
      return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
    },
    async getCardsForSet(cardSetId) {
      const t = await tx(["cards"], "readonly");
      const idx = t.objectStore("cards").index("cardSetId");
      const result = await reqToPromise(idx.getAll(IDBKeyRange.only(cardSetId)));
      return result || [];
    },
    async deleteCard(id) {
      const t = await tx(["cards"], "readwrite");
      t.objectStore("cards").delete(id);
      return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
    },
    async updateCard(card) {
      const t = await tx(["cards"], "readwrite");
      t.objectStore("cards").put(card);
      return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
    },
    async getAllCards() {
      const t = await tx(["cards"], "readonly");
      const result = await reqToPromise(t.objectStore("cards").getAll());
      return result || [];
    },
  };

  // ---------------------------------------------------------
  // Bildkomprimierung (Canvas) – haelt IndexedDB schlank & App schnell
  // ---------------------------------------------------------

  function compressImage(file, maxDim, quality) {
    maxDim = maxDim || 1400;
    quality = quality || 0.85;
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Bild konnte nicht verarbeitet werden."));
          },
          "image/jpeg",
          quality
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Bilddatei konnte nicht gelesen werden."));
      };
      img.src = url;
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    const [meta, b64] = dataUrl.split(",");
    const mimeMatch = meta.match(/data:(.*);base64/);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // ---------------------------------------------------------
  // Android-App (Capacitor) – nur aktiv, wenn als APK installiert.
  // Im normalen Browser / als Einzeldatei bleibt alles wie gehabt.
  // ---------------------------------------------------------

  function isNativeApp() {
    try {
      const cap = window.Capacitor;
      if (!cap) return false;
      if (typeof cap.isNativePlatform === "function") return !!cap.isNativePlatform();
      if (typeof cap.getPlatform === "function") return cap.getPlatform() !== "web";
      return !!cap.platform && cap.platform !== "web";
    } catch (e) {
      return false;
    }
  }

  // Plugin-Zugriff ohne Bundler: erst registerPlugin, sonst die alte Plugins-Tabelle
  function nativePlugin(name) {
    const cap = window.Capacitor;
    if (cap && typeof cap.registerPlugin === "function") return cap.registerPlugin(name);
    if (cap && cap.Plugins && cap.Plugins[name]) return cap.Plugins[name];
    throw new Error("Android-Plugin '" + name + "' nicht verfügbar.");
  }

  // Sicherung in Cache-Datei schreiben (in Stuecken, damit grosse Dateien die
  // Bruecke nicht sprengen) und dann den Android-Teilen-Dialog oeffnen
  // (dort: "In Drive speichern", "Dateien", E-Mail an sich selbst, ...).
  async function saveBackupNative(json, fileName) {
    const Filesystem = nativePlugin("Filesystem");
    const Share = nativePlugin("Share");
    const CHUNK = 1500000;
    await Filesystem.writeFile({
      path: fileName, data: json.slice(0, CHUNK), directory: "CACHE", encoding: "utf8",
    });
    for (let pos = CHUNK; pos < json.length; pos += CHUNK) {
      await Filesystem.appendFile({
        path: fileName, data: json.slice(pos, pos + CHUNK), directory: "CACHE", encoding: "utf8",
      });
    }
    const res = await Filesystem.getUri({ path: fileName, directory: "CACHE" });
    await Share.share({
      title: "Hitster Foto-Trainer Sicherung",
      url: res.uri,
      dialogTitle: "Sicherung speichern",
    });
  }

  // ---------------------------------------------------------
  // Elemente
  // ---------------------------------------------------------

  const el = {
    backBtn: document.getElementById("backBtn"),
    headerTitle: document.getElementById("headerTitle"),
    themeToggle: document.getElementById("themeToggle"),

    homeView: document.getElementById("homeView"),
    detailView: document.getElementById("detailView"),
    playView: document.getElementById("playView"),

    cardSetGrid: document.getElementById("cardSetGrid"),
    addSetBtn: document.getElementById("addSetBtn"),
    strugglingCount: document.getElementById("strugglingCount"),
    strugglingYearBtn: document.getElementById("strugglingYearBtn"),
    strugglingArtistBtn: document.getElementById("strugglingArtistBtn"),
    strugglingEmptyHint: document.getElementById("strugglingEmptyHint"),
    backupBtn: document.getElementById("backupBtn"),
    restoreBtn: document.getElementById("restoreBtn"),
    restoreFileInput: document.getElementById("restoreFileInput"),
    backupStatus: document.getElementById("backupStatus"),

    playYearBtn: document.getElementById("playYearBtn"),
    playArtistBtn: document.getElementById("playArtistBtn"),
    detailEmptyHint: document.getElementById("detailEmptyHint"),
    addPhotosBtn: document.getElementById("addPhotosBtn"),
    photoFileInput: document.getElementById("photoFileInput"),
    uploadStatus: document.getElementById("uploadStatus"),
    cardThumbGrid: document.getElementById("cardThumbGrid"),
    deleteSetBtn: document.getElementById("deleteSetBtn"),

    playCounter: document.getElementById("playCounter"),
    cardPhotoImg: document.getElementById("cardPhotoImg"),
    coverBand: document.getElementById("coverBand"),
    revealBtn: document.getElementById("revealBtn"),
    gradeRow: document.getElementById("gradeRow"),
    wrongBtn: document.getElementById("wrongBtn"),
    rightBtn: document.getElementById("rightBtn"),
    playDonePanel: document.getElementById("playDonePanel"),
    playFirstTryStat: document.getElementById("playFirstTryStat"),
    playAgainBtn: document.getElementById("playAgainBtn"),

    nameModalOverlay: document.getElementById("nameModalOverlay"),
    nameModalTitle: document.getElementById("nameModalTitle"),
    nameModalInput: document.getElementById("nameModalInput"),
    nameModalCancel: document.getElementById("nameModalCancel"),
    nameModalConfirm: document.getElementById("nameModalConfirm"),
  };

  // ---------------------------------------------------------
  // App-Zustand
  // ---------------------------------------------------------

  let cardSets = [];
  let currentCardSetId = null;
  let currentMode = null; // 'year' | 'artist'
  let currentPlayContext = "set"; // 'set' | 'struggling'
  let strugglingCardsCache = { year: [], artist: [] }; // set-uebergreifend, je Modus getrennt: Karten mit >= 2 Versuchen
  let currentObjectUrls = []; // aktive object URLs, zum Aufraeumen

  const STRUGGLING_THRESHOLD = 2; // ab so vielen Versuchen gilt eine Karte als "schwierig"

  // Die Versuche werden pro Modus gespeichert: "Jahr erraten" und "Interpret erraten"
  // zaehlen unabhaengig voneinander.
  function attemptsField(mode) {
    return mode === "year" ? "lastAttemptsYear" : "lastAttemptsArtist";
  }

  function revokeCurrentUrls() {
    currentObjectUrls.forEach((u) => URL.revokeObjectURL(u));
    currentObjectUrls = [];
  }

  function currentCardSet() {
    return cardSets.find((s) => s.id === currentCardSetId) || null;
  }

  // ---------------------------------------------------------
  // Ansichten wechseln
  // ---------------------------------------------------------

  function showView(name) {
    el.homeView.classList.toggle("hidden", name !== "home");
    el.detailView.classList.toggle("hidden", name !== "detail");
    el.playView.classList.toggle("hidden", name !== "play");
    el.backBtn.classList.toggle("hidden", name === "home");

    if (name === "home") {
      el.headerTitle.textContent = "🎴 Hitster Foto-Trainer";
    } else if (name === "detail") {
      const set = currentCardSet();
      el.headerTitle.textContent = set ? set.name : "Kartenset";
    } else if (name === "play") {
      const modeLabel = currentMode === "year" ? "Jahr erraten" : "Interpret erraten";
      if (currentPlayContext === "struggling") {
        el.headerTitle.textContent = "🔁 Schwierige Karten · " + modeLabel;
      } else {
        const set = currentCardSet();
        el.headerTitle.textContent = (set ? set.name : "") + " · " + modeLabel;
      }
    }
  }

  el.backBtn.addEventListener("click", () => {
    if (!el.playView.classList.contains("hidden")) {
      if (currentPlayContext === "struggling") {
        renderHome();
        showView("home");
      } else {
        renderDetail();
        showView("detail");
      }
    } else if (!el.detailView.classList.contains("hidden")) {
      renderHome();
      showView("home");
    }
  });

  // ---------------------------------------------------------
  // HOME: Kartenset-Liste
  // ---------------------------------------------------------

  async function renderHome() {
    revokeCurrentUrls();
    const allCards = await Store.getAllCards();
    const countBySet = {};
    const thumbBySet = {};
    allCards.forEach((c) => {
      countBySet[c.cardSetId] = (countBySet[c.cardSetId] || 0) + 1;
      if (!thumbBySet[c.cardSetId]) thumbBySet[c.cardSetId] = c;
    });

    // Schwierige Karten: alle Kartensets zusammen, je Modus getrennt –
    // zuletzt >= 2 Versuche in genau diesem Modus noetig
    strugglingCardsCache = {
      year: allCards.filter((c) => Number(c.lastAttemptsYear) >= STRUGGLING_THRESHOLD),
      artist: allCards.filter((c) => Number(c.lastAttemptsArtist) >= STRUGGLING_THRESHOLD),
    };
    const yCount = strugglingCardsCache.year.length;
    const aCount = strugglingCardsCache.artist.length;
    el.strugglingCount.textContent =
      yCount + aCount === 0 ? "" :
      "Jahr: " + yCount + (yCount === 1 ? " Karte" : " Karten") +
      " · Interpret: " + aCount + (aCount === 1 ? " Karte" : " Karten") +
      " (aus allen Kartensets, zuletzt mind. 2 Versuche gebraucht)";
    el.strugglingYearBtn.disabled = yCount === 0;
    el.strugglingArtistBtn.disabled = aCount === 0;
    el.strugglingEmptyHint.classList.toggle("hidden", yCount + aCount > 0);

    el.cardSetGrid.innerHTML = "";
    cardSets.forEach((set) => {
      const count = countBySet[set.id] || 0;
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "card-set-tile";

      const thumbWrap = document.createElement("div");
      thumbWrap.className = "card-set-thumb";
      const thumbCard = thumbBySet[set.id];
      if (thumbCard) {
        const img = document.createElement("img");
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        img.style.borderRadius = "inherit";
        const url = URL.createObjectURL(thumbCard.imageBlob);
        currentObjectUrls.push(url);
        img.src = url;
        thumbWrap.appendChild(img);
      } else {
        thumbWrap.textContent = "🎴";
      }

      const info = document.createElement("div");
      info.className = "card-set-info";
      info.innerHTML =
        '<p class="card-set-name">' + escapeHtml(set.name) + "</p>" +
        '<p class="card-set-count">' + count + (count === 1 ? " Karte" : " Karten") + "</p>";

      const arrow = document.createElement("span");
      arrow.className = "card-set-arrow";
      arrow.textContent = "›";

      tile.appendChild(thumbWrap);
      tile.appendChild(info);
      tile.appendChild(arrow);

      tile.addEventListener("click", () => {
        currentCardSetId = set.id;
        renderDetail();
        showView("detail");
      });

      el.cardSetGrid.appendChild(tile);
    });
  }

  // ---------------------------------------------------------
  // Neues Kartenset (Modal)
  // ---------------------------------------------------------

  function openNameModal() {
    el.nameModalInput.value = "";
    el.nameModalOverlay.classList.remove("hidden");
    setTimeout(() => el.nameModalInput.focus(), 50);
  }

  function closeNameModal() {
    el.nameModalOverlay.classList.add("hidden");
  }

  el.addSetBtn.addEventListener("click", openNameModal);
  el.nameModalCancel.addEventListener("click", closeNameModal);
  el.nameModalOverlay.addEventListener("click", (e) => {
    if (e.target === el.nameModalOverlay) closeNameModal();
  });
  el.nameModalInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); el.nameModalConfirm.click(); }
  });

  el.nameModalConfirm.addEventListener("click", async () => {
    const name = el.nameModalInput.value.trim();
    if (!name) { el.nameModalInput.focus(); return; }
    const set = { id: uid(), name: name, createdAt: Date.now() };
    await Store.addCardSet(set);
    cardSets.push(set);
    closeNameModal();
    revokeCurrentUrls();
    await renderHome();
  });

  // ---------------------------------------------------------
  // DETAIL: Kartenset (Fotos verwalten + Modus starten)
  // ---------------------------------------------------------

  let currentSetCards = [];

  async function renderDetail() {
    const set = currentCardSet();
    if (!set) { showView("home"); return; }
    el.headerTitle.textContent = set.name;

    revokeCurrentUrls();
    currentSetCards = await Store.getCardsForSet(set.id);

    const hasCards = currentSetCards.length > 0;
    el.playYearBtn.disabled = !hasCards;
    el.playArtistBtn.disabled = !hasCards;
    el.detailEmptyHint.classList.toggle("hidden", hasCards);

    el.cardThumbGrid.innerHTML = "";
    currentSetCards.forEach((card) => {
      const wrap = document.createElement("div");
      wrap.className = "card-thumb";
      const img = document.createElement("img");
      const url = URL.createObjectURL(card.imageBlob);
      currentObjectUrls.push(url);
      img.src = url;
      wrap.appendChild(img);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "card-thumb-delete";
      delBtn.setAttribute("aria-label", "Karte löschen");
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = window.confirm("Diese Karte aus dem Kartenset entfernen?");
        if (!ok) return;
        await Store.deleteCard(card.id);
        await renderDetail();
      });
      wrap.appendChild(delBtn);

      el.cardThumbGrid.appendChild(wrap);
    });
  }

  el.addPhotosBtn.addEventListener("click", () => el.photoFileInput.click());

  el.photoFileInput.addEventListener("change", async () => {
    const files = Array.from(el.photoFileInput.files || []);
    if (files.length === 0) return;
    const set = currentCardSet();
    if (!set) return;

    el.uploadStatus.textContent = "Verarbeite " + files.length + " Foto(s) …";
    el.uploadStatus.className = "upload-status";

    const newCards = [];
    let failed = 0;
    for (const file of files) {
      try {
        const blob = await compressImage(file);
        newCards.push({
          id: uid(), cardSetId: set.id, imageBlob: blob, addedAt: Date.now(),
          lastAttemptsYear: 0, lastAttemptsArtist: 0, lastPlayedAt: null,
        });
      } catch (e) {
        failed++;
      }
    }

    if (newCards.length > 0) {
      await Store.addCards(newCards);
    }

    el.photoFileInput.value = "";

    if (failed === 0) {
      el.uploadStatus.textContent = "✅ " + newCards.length + " Foto(s) hinzugefügt.";
      el.uploadStatus.className = "upload-status success";
    } else {
      el.uploadStatus.textContent = "⚠️ " + newCards.length + " hinzugefügt, " + failed + " fehlgeschlagen.";
      el.uploadStatus.className = "upload-status error";
    }

    await renderDetail();
  });

  el.deleteSetBtn.addEventListener("click", async () => {
    const set = currentCardSet();
    if (!set) return;
    const ok = window.confirm(
      'Kartenset "' + set.name + '" wirklich komplett löschen? Alle Fotos darin gehen dabei verloren.'
    );
    if (!ok) return;
    await Store.deleteCardSet(set.id);
    cardSets = cardSets.filter((s) => s.id !== set.id);
    currentCardSetId = null;
    revokeCurrentUrls();
    await renderHome();
    showView("home");
  });

  // ---------------------------------------------------------
  // SPIELEN: Selbstbewertungs-Engine
  // ---------------------------------------------------------

  let playQueue = [];
  let playPoolSize = 0;
  let playLearned = 0;
  let currentPlayCard = null;
  let revealedThisCard = false;
  let currentPlayImgUrl = null;
  let attemptsById = {};       // Karten-ID -> wie oft in diesem Durchgang bewertet
  let firstTryCorrectCount = 0; // Karten, die gleich beim 1. Versuch richtig waren

  function poolForContext() {
    return currentPlayContext === "struggling" ? strugglingCardsCache[currentMode] : currentSetCards;
  }

  function startPlay(mode, context) {
    currentMode = mode;
    currentPlayContext = context || "set";
    revokeCurrentUrls();
    playQueue = shuffle(poolForContext());
    playPoolSize = playQueue.length;
    playLearned = 0;
    attemptsById = {};
    firstTryCorrectCount = 0;
    el.playDonePanel.classList.add("hidden");
    document.querySelector(".card-photo-stage").classList.remove("hidden");
    document.querySelector(".play-controls").classList.remove("hidden");
    nextPlayCard();
    showView("play");
  }

  el.playYearBtn.addEventListener("click", () => startPlay("year", "set"));
  el.playArtistBtn.addEventListener("click", () => startPlay("artist", "set"));
  el.strugglingYearBtn.addEventListener("click", () => startPlay("year", "struggling"));
  el.strugglingArtistBtn.addEventListener("click", () => startPlay("artist", "struggling"));
  el.playAgainBtn.addEventListener("click", () => startPlay(currentMode, currentPlayContext));

  function updatePlayCounter() {
    el.playCounter.textContent = playLearned + " / " + playPoolSize;
  }

  function nextPlayCard() {
    revealedThisCard = false;
    el.revealBtn.classList.remove("hidden");
    el.gradeRow.classList.add("hidden");
    updatePlayCounter();

    if (playQueue.length === 0) {
      document.querySelector(".card-photo-stage").classList.add("hidden");
      document.querySelector(".play-controls").classList.add("hidden");
      const pct = playPoolSize > 0 ? Math.round((firstTryCorrectCount / playPoolSize) * 100) : 0;
      el.playFirstTryStat.textContent =
        "🎯 " + pct + " % beim ersten Versuch richtig (" + firstTryCorrectCount + " von " + playPoolSize + ")";
      el.playDonePanel.classList.remove("hidden");
      return;
    }

    document.querySelector(".card-photo-stage").classList.remove("hidden");
    document.querySelector(".play-controls").classList.remove("hidden");

    currentPlayCard = playQueue[0];
    if (currentPlayImgUrl) URL.revokeObjectURL(currentPlayImgUrl);
    currentPlayImgUrl = URL.createObjectURL(currentPlayCard.imageBlob);
    el.cardPhotoImg.src = currentPlayImgUrl;

    el.coverBand.className = "cover-band " + (currentMode === "year" ? "mode-year" : "mode-artist");

    // Wechsel-Animation
    const frame = document.getElementById("cardPhotoFrame");
    frame.style.animation = "none";
    void frame.offsetWidth;
    frame.style.animation = "";
  }

  el.revealBtn.addEventListener("click", () => {
    revealedThisCard = true;
    el.coverBand.classList.add("revealed");
    el.revealBtn.classList.add("hidden");
    el.gradeRow.classList.remove("hidden");
  });

  function gradeCurrent(wasCorrect) {
    if (!revealedThisCard) return;
    playQueue.shift();

    const cardId = currentPlayCard.id;
    const isFirstAttempt = !attemptsById[cardId];
    attemptsById[cardId] = (attemptsById[cardId] || 0) + 1;
    if (isFirstAttempt && wasCorrect) firstTryCorrectCount++;

    if (wasCorrect) {
      playLearned++;
      // Merken, wie viele Versuche diese Karte diesmal in diesem Modus gebraucht hat
      // (ueberschreibt den alten Wert -> spiegelt immer "in letzter Zeit")
      currentPlayCard[attemptsField(currentMode)] = attemptsById[cardId];
      currentPlayCard.lastPlayedAt = Date.now();
      Store.updateCard(currentPlayCard).catch(() => {});
    } else {
      const insertOffset = randInt(3, 7);
      const insertPos = Math.min(insertOffset, playQueue.length);
      playQueue.splice(insertPos, 0, currentPlayCard);
    }
    nextPlayCard();
  }

  el.rightBtn.addEventListener("click", () => gradeCurrent(true));
  el.wrongBtn.addEventListener("click", () => gradeCurrent(false));

  // ---------------------------------------------------------
  // Backup / Wiederherstellen (alle Kartensets + Fotos als JSON)
  // ---------------------------------------------------------

  function showBackupStatus(msg, kind) {
    el.backupStatus.textContent = msg;
    el.backupStatus.className = "backup-status" + (kind ? " " + kind : "");
  }

  el.backupBtn.addEventListener("click", async () => {
    showBackupStatus("Sichere Daten …", "");
    try {
      const sets = await Store.getAllCardSets();
      const cards = await Store.getAllCards();
      const cardsWithData = [];
      for (const c of cards) {
        const dataUrl = await blobToDataUrl(c.imageBlob);
        cardsWithData.push({
          id: c.id, cardSetId: c.cardSetId, addedAt: c.addedAt,
          lastAttemptsYear: c.lastAttemptsYear || 0, lastAttemptsArtist: c.lastAttemptsArtist || 0,
          lastPlayedAt: c.lastPlayedAt || null,
          imageDataUrl: dataUrl,
        });
      }
      const payload = {
        app: "hitster-photo-trainer",
        version: 2,
        exportedAt: new Date().toISOString(),
        cardSets: sets,
        cards: cardsWithData,
      };
      const json = JSON.stringify(payload);
      const dateStamp = new Date().toISOString().slice(0, 10);
      const fileName = "hitster-fototrainer-backup-" + dateStamp + ".json";
      if (isNativeApp()) {
        // In der Android-App funktionieren Blob-Downloads nicht -> Teilen-Dialog
        await saveBackupNative(json, fileName);
      } else {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      showBackupStatus("✅ " + sets.length + " Kartensets, " + cards.length + " Fotos gesichert.", "success");
    } catch (e) {
      showBackupStatus("❌ Sicherung fehlgeschlagen: " + e.message, "error");
    }
  });

  el.restoreBtn.addEventListener("click", () => {
    el.restoreFileInput.value = "";
    el.restoreFileInput.click();
  });

  el.restoreFileInput.addEventListener("change", async () => {
    const file = el.restoreFileInput.files && el.restoreFileInput.files[0];
    if (!file) return;
    showBackupStatus("Stelle Daten wieder her …", "");
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.cardSets) || !Array.isArray(data.cards)) {
        throw new Error("Ungültiges Sicherungsdateiformat.");
      }

      const existingSets = await Store.getAllCardSets();
      const existingIds = new Set(existingSets.map((s) => s.id));

      let addedSets = 0;
      for (const s of data.cardSets) {
        if (!existingIds.has(s.id)) {
          await Store.addCardSet(s);
          addedSets++;
        }
      }

      let addedCards = 0;
      const newCards = [];
      for (const c of data.cards) {
        if (!c.imageDataUrl) continue;
        const blob = dataUrlToBlob(c.imageDataUrl);
        newCards.push({
          id: c.id, cardSetId: c.cardSetId, addedAt: c.addedAt || Date.now(), imageBlob: blob,
          lastAttemptsYear: c.lastAttemptsYear || 0, lastAttemptsArtist: c.lastAttemptsArtist || 0,
          lastPlayedAt: c.lastPlayedAt || null,
        });
        addedCards++;
      }
      if (newCards.length > 0) await Store.addCards(newCards);

      cardSets = await Store.getAllCardSets();
      revokeCurrentUrls();
      await renderHome();
      showBackupStatus("✅ Wiederhergestellt: " + addedSets + " neue Kartensets, " + addedCards + " Fotos.", "success");
    } catch (e) {
      showBackupStatus("❌ " + e.message, "error");
    }
  });

  // ---------------------------------------------------------
  // Dark / Light Theme
  // ---------------------------------------------------------

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    el.themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
    try { localStorage.setItem("hitster-photo-theme", theme); } catch (e) {}
  }

  el.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });

  let savedTheme = null;
  try { savedTheme = localStorage.getItem("hitster-photo-theme"); } catch (e) {}
  if (savedTheme) {
    applyTheme(savedTheme);
  } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    applyTheme("dark");
  } else {
    applyTheme("light");
  }

  // ---------------------------------------------------------
  // Start
  // ---------------------------------------------------------

  function initNativeExtras() {
    if (!isNativeApp()) return;
    try {
      // Android-Zurueck-Taste: erst eine Ebene zurueck, auf Home erst dann App schliessen
      const App = nativePlugin("App");
      App.addListener("backButton", () => {
        if (!el.nameModalOverlay.classList.contains("hidden")) {
          closeNameModal();
        } else if (!el.backBtn.classList.contains("hidden")) {
          el.backBtn.click();
        } else {
          App.exitApp();
        }
      });
    } catch (e) { /* ohne Zurueck-Taste-Sonderbehandlung weiterlaufen */ }
  }

  // Bitte das System, den Speicher nicht automatisch zu raeumen.
  function requestPersistentStorage() {
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (e) {}
  }

  async function init() {
    initNativeExtras();
    requestPersistentStorage();
    try {
      cardSets = await Store.getAllCardSets();
      if (cardSets.length === 0) {
        const seedFlag = "hitster-photo-seeded";
        let alreadySeeded = false;
        try { alreadySeeded = !!localStorage.getItem(seedFlag); } catch (e) {}
        if (!alreadySeeded) {
          const setBingo = { id: uid(), name: "Hitster Bingo", createdAt: Date.now() };
          const setRock = { id: uid(), name: "Hitster Rock", createdAt: Date.now() + 1 };
          await Store.addCardSet(setBingo);
          await Store.addCardSet(setRock);
          cardSets = [setBingo, setRock];
          try { localStorage.setItem(seedFlag, "1"); } catch (e) {}
        }
      }
      await renderHome();
      showView("home");
    } catch (e) {
      el.cardSetGrid.innerHTML =
        '<p style="color:var(--wrong); text-align:center;">Fehler beim Laden: ' + escapeHtml(e.message) + "</p>";
    }
  }

  init();
})();
