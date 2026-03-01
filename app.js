const DB_NAME = "dddl_lab_portal";
const DB_VERSION = 2;
const SAMPLE_STORE = "samples";
const FILE_STORE = "files";
const USER_STORE = "users";
const SESSION_KEY = "dddl_lab_session_user";

const CLOUD_CONFIG_KEY = "dddl_cloud_config";
const CLOUD_TABLE = "lab_samples";
const CLOUD_BUCKET = "lab-reports";

const statusOptions = ["Received", "In Process", "Report Ready", "Dispatched"];

let db = null;
let samplesCache = [];
let editingId = null;
let currentUser = null;
let previewUrl = null;
let supabaseClient = null;
let cloudConnected = false;

const sampleForm = document.getElementById("sampleForm");
const saveBtn = document.getElementById("saveBtn");
const resetBtn = document.getElementById("resetBtn");
const formMsg = document.getElementById("formMsg");
const dbStatus = document.getElementById("dbStatus");
const recordsBody = document.getElementById("recordsBody");
const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");

const exportBtn = document.getElementById("exportBtn");
const clearBtn = document.getElementById("clearBtn");

const sampleIdInput = document.getElementById("sampleId");
const receivedAtInput = document.getElementById("receivedAt");

const authName = document.getElementById("authName");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authMsg = document.getElementById("authMsg");
const authLoggedOut = document.getElementById("authLoggedOut");
const authLoggedIn = document.getElementById("authLoggedIn");
const currentUserLabel = document.getElementById("currentUserLabel");

const previewModal = document.getElementById("previewModal");
const previewBody = document.getElementById("previewBody");
const previewTitle = document.getElementById("previewTitle");
const closePreviewBtn = document.getElementById("closePreviewBtn");

const sbUrlInput = document.getElementById("sbUrl");
const sbAnonKeyInput = document.getElementById("sbAnonKey");
const cloudConnectBtn = document.getElementById("cloudConnectBtn");
const cloudDisconnectBtn = document.getElementById("cloudDisconnectBtn");
const cloudSyncBtn = document.getElementById("cloudSyncBtn");
const cloudMsg = document.getElementById("cloudMsg");

const metricEls = {
  total: document.getElementById("mTotal"),
  received: document.getElementById("mReceived"),
  inProcess: document.getElementById("mInProcess"),
  ready: document.getElementById("mReady"),
  dispatched: document.getElementById("mDispatched"),
  today: document.getElementById("mToday")
};

async function init() {
  try {
    db = await openDb();
    bindEvents();

    setDefaultDateTime();
    onResetForm();

    loadCloudConfig();
    await restoreSession();
    await maybeAutoConnectCloud();
    await refreshSamples();

    updateAuthUI();
    updateAppAccess();
  } catch (error) {
    console.error(error);
    dbStatus.textContent = "Initialization error";
    dbStatus.style.color = "#b43b2c";
  }
}

function bindEvents() {
  sampleForm.addEventListener("submit", onSubmitSample);
  resetBtn.addEventListener("click", onResetForm);
  searchInput.addEventListener("input", renderTable);
  statusFilter.addEventListener("change", renderTable);
  exportBtn.addEventListener("click", exportRecords);
  clearBtn.addEventListener("click", clearAllData);

  loginBtn.addEventListener("click", signIn);
  registerBtn.addEventListener("click", registerUser);
  logoutBtn.addEventListener("click", signOut);

  closePreviewBtn.addEventListener("click", closePreview);
  previewModal.addEventListener("click", (event) => {
    if (event.target === previewModal) closePreview();
  });

  cloudConnectBtn.addEventListener("click", () => connectCloud({ userInitiated: true }));
  cloudDisconnectBtn.addEventListener("click", disconnectCloud);
  cloudSyncBtn.addEventListener("click", syncNow);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const upgradeDb = request.result;

      if (!upgradeDb.objectStoreNames.contains(SAMPLE_STORE)) {
        const sampleStore = upgradeDb.createObjectStore(SAMPLE_STORE, { keyPath: "id" });
        sampleStore.createIndex("sampleId", "sampleId", { unique: true });
        sampleStore.createIndex("status", "status", { unique: false });
        sampleStore.createIndex("receivedAt", "receivedAt", { unique: false });
        sampleStore.createIndex("createdById", "createdById", { unique: false });
      }

      if (!upgradeDb.objectStoreNames.contains(FILE_STORE)) {
        const fileStore = upgradeDb.createObjectStore(FILE_STORE, { keyPath: "id" });
        fileStore.createIndex("sampleId", "sampleId", { unique: false });
      }

      if (!upgradeDb.objectStoreNames.contains(USER_STORE)) {
        const userStore = upgradeDb.createObjectStore(USER_STORE, { keyPath: "id" });
        userStore.createIndex("email", "email", { unique: true });
      }
    };
  });
}

function txStore(storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function setDefaultDateTime() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  receivedAtInput.value = local;
}

function setCloudMsg(message, isError = false) {
  cloudMsg.textContent = message;
  cloudMsg.style.color = isError ? "#b43b2c" : "#486280";
}

function getCloudConfig() {
  return {
    url: String(sbUrlInput.value || "").trim(),
    anonKey: String(sbAnonKeyInput.value || "").trim()
  };
}

function loadCloudConfig() {
  try {
    const raw = localStorage.getItem(CLOUD_CONFIG_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    sbUrlInput.value = parsed.url || "";
    sbAnonKeyInput.value = parsed.anonKey || "";
  } catch {
    // ignore malformed local value
  }
}

function persistCloudConfig(config) {
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(config));
}

function clearCloudConfig() {
  localStorage.removeItem(CLOUD_CONFIG_KEY);
}

async function maybeAutoConnectCloud() {
  const { url, anonKey } = getCloudConfig();
  if (!url || !anonKey) return;
  await connectCloud({ userInitiated: false });
}

async function connectCloud({ userInitiated }) {
  const { url, anonKey } = getCloudConfig();

  if (!url || !anonKey) {
    if (userInitiated) setCloudMsg("Enter Supabase URL and anon key.", true);
    return;
  }

  if (!window.supabase?.createClient) {
    setCloudMsg("Supabase client script not loaded.", true);
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(url, anonKey);
    const { error } = await supabaseClient
      .from(CLOUD_TABLE)
      .select("id", { count: "exact", head: true });

    if (error) {
      cloudConnected = false;
      if (userInitiated) setCloudMsg(`Cloud connection failed: ${error.message}`, true);
      return;
    }

    cloudConnected = true;
    persistCloudConfig({ url, anonKey });
    setCloudMsg("Cloud connected. Use Sync Now to push local data.");
    await refreshSamples();
  } catch (error) {
    cloudConnected = false;
    console.error(error);
    if (userInitiated) setCloudMsg("Cloud connection failed.", true);
  }
}

async function disconnectCloud() {
  cloudConnected = false;
  supabaseClient = null;
  clearCloudConfig();
  sbAnonKeyInput.value = "";
  setCloudMsg("Cloud disconnected.");
  await refreshSamples();
}

async function getCloudSamples() {
  if (!cloudConnected || !supabaseClient) return [];

  const { data, error } = await supabaseClient
    .from(CLOUD_TABLE)
    .select("id,payload,updated_at")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const rows = (data || [])
    .map((entry) => {
      const payload = entry.payload || {};
      return {
        ...payload,
        id: payload.id || entry.id,
        updatedAt: payload.updatedAt || entry.updated_at || payload.createdAt || new Date().toISOString()
      };
    })
    .filter((row) => row.id);

  rows.sort((a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0));
  return rows;
}

async function upsertCloudSample(sample) {
  if (!cloudConnected || !supabaseClient) return;

  const payload = {
    ...sample,
    reportFileId: null
  };

  const { error } = await supabaseClient
    .from(CLOUD_TABLE)
    .upsert({
      id: sample.id,
      payload,
      updated_at: new Date().toISOString()
    });

  if (error) throw error;
}

async function deleteCloudSample(sample) {
  if (!cloudConnected || !supabaseClient) return;

  if (sample?.reportStoragePath) {
    await supabaseClient.storage.from(CLOUD_BUCKET).remove([sample.reportStoragePath]);
  }

  const { error } = await supabaseClient
    .from(CLOUD_TABLE)
    .delete()
    .eq("id", sample.id);

  if (error) throw error;
}

function sanitizeFileName(name) {
  return String(name || "report").replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function uploadReportToCloud(sampleId, file, oldPath = "") {
  if (!cloudConnected || !supabaseClient || !file || file.size === 0) {
    return {
      reportPublicUrl: null,
      reportStoragePath: oldPath || null
    };
  }

  if (oldPath) {
    await supabaseClient.storage.from(CLOUD_BUCKET).remove([oldPath]);
  }

  const filePath = `${sampleId}/${Date.now()}-${sanitizeFileName(file.name)}`;
  const { error: uploadError } = await supabaseClient
    .storage
    .from(CLOUD_BUCKET)
    .upload(filePath, file, { upsert: false });

  if (uploadError) throw uploadError;

  const { data } = supabaseClient
    .storage
    .from(CLOUD_BUCKET)
    .getPublicUrl(filePath);

  return {
    reportPublicUrl: data?.publicUrl || null,
    reportStoragePath: filePath
  };
}

async function syncNow() {
  if (!cloudConnected || !supabaseClient) {
    setCloudMsg("Connect cloud first.", true);
    return;
  }

  try {
    setCloudMsg("Syncing local records to cloud...");
    const localRows = await getAllLocalSamples();

    for (const row of localRows) {
      await upsertCloudSample(row);
    }

    await refreshSamples();
    setCloudMsg(`Sync complete. ${localRows.length} local record(s) pushed.`);
  } catch (error) {
    console.error(error);
    setCloudMsg(`Sync failed: ${error.message}`, true);
  }
}

async function refreshSamples() {
  try {
    if (cloudConnected && supabaseClient) {
      samplesCache = await getCloudSamples();
    } else {
      samplesCache = await getAllLocalSamples();
    }
  } catch (error) {
    console.error(error);
    samplesCache = await getAllLocalSamples();
    setCloudMsg(`Cloud read failed; showing local data. ${error.message}`, true);
  }

  updateSampleIdField();
  updateMetrics();
  renderTable();

  dbStatus.textContent = currentUser
    ? `Ready • Logged in as ${currentUser.name}${cloudConnected ? " • Cloud ON" : " • Local"}`
    : "Login required";
}

function updateSampleIdField() {
  if (editingId) return;

  const today = new Date();
  const dateKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const prefix = `DDDL-${dateKey}-`;

  let maxSeq = 0;
  for (const sample of samplesCache) {
    if (!sample.sampleId?.startsWith(prefix)) continue;
    const seq = Number(sample.sampleId.slice(prefix.length));
    if (!Number.isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
  }

  sampleIdInput.value = `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
}

function getAllLocalSamples() {
  return new Promise((resolve, reject) => {
    const req = txStore(SAMPLE_STORE).getAll();
    req.onsuccess = () => {
      const rows = req.result || [];
      rows.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

function putLocalSample(sample) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAMPLE_STORE, "readwrite");
    tx.objectStore(SAMPLE_STORE).put(sample);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function deleteLocalSampleById(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([SAMPLE_STORE, FILE_STORE], "readwrite");
    const sampleStore = tx.objectStore(SAMPLE_STORE);
    const fileStore = tx.objectStore(FILE_STORE);

    const getReq = sampleStore.get(id);
    getReq.onsuccess = () => {
      const sample = getReq.result;
      if (sample?.reportFileId) {
        fileStore.delete(sample.reportFileId);
      }
      sampleStore.delete(id);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function saveReportFile(sampleId, file) {
  if (!file || file.size === 0) return Promise.resolve(null);

  const fileRecord = {
    id: crypto.randomUUID(),
    sampleId,
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    blob: file,
    uploadedAt: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).put(fileRecord);
    tx.oncomplete = () => resolve(fileRecord);
    tx.onerror = () => reject(tx.error);
  });
}

function getFileById(fileId) {
  return new Promise((resolve, reject) => {
    const req = txStore(FILE_STORE).get(fileId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function deleteFileById(fileId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).delete(fileId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function countUsers() {
  return new Promise((resolve, reject) => {
    const req = txStore(USER_STORE).count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}

function getUserById(id) {
  return new Promise((resolve, reject) => {
    const req = txStore(USER_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function getUserByEmail(email) {
  return new Promise((resolve, reject) => {
    const req = txStore(USER_STORE).index("email").get(email);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function putUser(user) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(USER_STORE, "readwrite");
    tx.objectStore(USER_STORE).put(user);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function hashPassword(email, password) {
  const material = `${normalizeEmail(email)}::${password}`;
  const data = new TextEncoder().encode(material);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function setSession(userId) {
  localStorage.setItem(SESSION_KEY, userId);
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

async function restoreSession() {
  const userId = localStorage.getItem(SESSION_KEY);
  if (!userId) return;
  const user = await getUserById(userId);
  if (!user) {
    clearSession();
    return;
  }
  currentUser = user;
}

function updateAuthUI() {
  const loggedIn = Boolean(currentUser);
  authLoggedOut.classList.toggle("hidden", loggedIn);
  authLoggedIn.classList.toggle("hidden", !loggedIn);

  if (loggedIn) {
    currentUserLabel.textContent = `${currentUser.name} • ${currentUser.role}`;
    authMsg.textContent = "";
  }
}

function updateAppAccess() {
  const locked = !currentUser;
  sampleForm.classList.toggle("disabled-block", locked);
  exportBtn.disabled = locked;
  clearBtn.disabled = locked || currentUser.role !== "admin";

  if (locked) {
    formMsg.textContent = "Login to create or edit samples.";
    formMsg.style.color = "#b43b2c";
  }
}

async function registerUser() {
  authMsg.textContent = "";
  const name = String(authName.value || "").trim();
  const email = normalizeEmail(authEmail.value);
  const password = String(authPassword.value || "");

  if (!name || !email || password.length < 6) {
    authMsg.textContent = "Provide name, valid email, and password (6+ chars).";
    authMsg.style.color = "#b43b2c";
    return;
  }

  try {
    const existing = await getUserByEmail(email);
    if (existing) {
      authMsg.textContent = "Email already registered.";
      authMsg.style.color = "#b43b2c";
      return;
    }

    const totalUsers = await countUsers();
    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash: await hashPassword(email, password),
      role: totalUsers === 0 ? "admin" : "staff",
      createdAt: new Date().toISOString()
    };

    await putUser(user);
    currentUser = user;
    setSession(user.id);
    clearAuthInputs();

    authMsg.textContent = `Registered and signed in as ${user.role}.`;
    authMsg.style.color = "#0d7b78";
    updateAuthUI();
    updateAppAccess();
    await refreshSamples();
  } catch (error) {
    console.error(error);
    authMsg.textContent = "Registration failed.";
    authMsg.style.color = "#b43b2c";
  }
}

async function signIn() {
  authMsg.textContent = "";
  const email = normalizeEmail(authEmail.value);
  const password = String(authPassword.value || "");

  if (!email || !password) {
    authMsg.textContent = "Enter email and password.";
    authMsg.style.color = "#b43b2c";
    return;
  }

  try {
    const user = await getUserByEmail(email);
    if (!user) {
      authMsg.textContent = "Account not found. Register first.";
      authMsg.style.color = "#b43b2c";
      return;
    }

    const hash = await hashPassword(email, password);
    if (hash !== user.passwordHash) {
      authMsg.textContent = "Invalid credentials.";
      authMsg.style.color = "#b43b2c";
      return;
    }

    currentUser = user;
    setSession(user.id);
    clearAuthInputs();
    updateAuthUI();
    updateAppAccess();
    await refreshSamples();
  } catch (error) {
    console.error(error);
    authMsg.textContent = "Login failed.";
    authMsg.style.color = "#b43b2c";
  }
}

function signOut() {
  currentUser = null;
  clearSession();
  updateAuthUI();
  updateAppAccess();
  refreshSamples();
}

function clearAuthInputs() {
  authName.value = "";
  authEmail.value = "";
  authPassword.value = "";
}

async function onSubmitSample(event) {
  event.preventDefault();
  formMsg.textContent = "";

  if (!currentUser) {
    formMsg.textContent = "Login required.";
    formMsg.style.color = "#b43b2c";
    return;
  }

  const formData = new FormData(sampleForm);
  const reportFile = formData.get("reportFile");

  const payload = {
    sampleId: String(formData.get("sampleId") || "").trim(),
    receivedAt: String(formData.get("receivedAt") || "").trim(),
    ownerName: String(formData.get("ownerName") || "").trim(),
    phone: String(formData.get("phone") || "").trim(),
    village: String(formData.get("village") || "").trim(),
    species: String(formData.get("species") || "").trim(),
    sampleType: String(formData.get("sampleType") || "").trim(),
    vetName: String(formData.get("vetName") || "").trim(),
    priority: String(formData.get("priority") || "Routine").trim(),
    status: String(formData.get("status") || "Received").trim(),
    testsRequested: String(formData.get("testsRequested") || "").trim(),
    reportDate: String(formData.get("reportDate") || "").trim(),
    diagnosis: String(formData.get("diagnosis") || "").trim(),
    labFindings: String(formData.get("labFindings") || "").trim(),
    remarks: String(formData.get("remarks") || "").trim()
  };

  if (!payload.ownerName || !payload.phone || !payload.species || !payload.sampleType || !payload.testsRequested || !payload.receivedAt) {
    formMsg.textContent = "Fill all required fields.";
    formMsg.style.color = "#b43b2c";
    return;
  }

  saveBtn.disabled = true;

  try {
    let existing = null;
    if (editingId) {
      existing = samplesCache.find((s) => s.id === editingId) || null;
      if (!existing) throw new Error("Sample not found");
      if (!canManageRecord(existing)) throw new Error("No permission to update this record");
    }

    const sampleId = editingId || crypto.randomUUID();
    let reportFileId = existing?.reportFileId || null;
    let reportName = existing?.reportName || null;
    let reportPublicUrl = existing?.reportPublicUrl || null;
    let reportStoragePath = existing?.reportStoragePath || null;

    if (reportFile && reportFile.size > 0) {
      if (reportFileId) {
        await deleteFileById(reportFileId);
      }
      const savedFile = await saveReportFile(sampleId, reportFile);
      reportFileId = savedFile.id;
      reportName = savedFile.name;

      if (cloudConnected) {
        const uploaded = await uploadReportToCloud(sampleId, reportFile, reportStoragePath);
        reportPublicUrl = uploaded.reportPublicUrl;
        reportStoragePath = uploaded.reportStoragePath;
      }
    }

    const sample = {
      ...(existing || {}),
      id: sampleId,
      ...payload,
      reportFileId,
      reportName,
      reportPublicUrl,
      reportStoragePath,
      createdById: existing?.createdById || currentUser.id,
      createdByName: existing?.createdByName || currentUser.name,
      updatedById: currentUser.id,
      updatedByName: currentUser.name,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putLocalSample(sample);

    if (cloudConnected) {
      try {
        await upsertCloudSample(sample);
      } catch (cloudError) {
        console.error(cloudError);
        formMsg.textContent = `Saved locally. Cloud sync failed: ${cloudError.message}`;
        formMsg.style.color = "#b43b2c";
      }
    }

    if (!formMsg.textContent) {
      formMsg.textContent = editingId ? "Sample updated." : "Sample saved.";
      formMsg.style.color = "#0d7b78";
    }

    onResetForm();
    await refreshSamples();
  } catch (error) {
    console.error(error);
    formMsg.textContent = error?.message || "Failed to save sample.";
    formMsg.style.color = "#b43b2c";
  } finally {
    saveBtn.disabled = false;
  }
}

function onResetForm() {
  sampleForm.reset();
  editingId = null;
  saveBtn.textContent = "Save Sample";
  formMsg.textContent = "";
  setDefaultDateTime();
  updateSampleIdField();
  document.getElementById("status").value = "Received";
  document.getElementById("priority").value = "Routine";
}

function updateMetrics() {
  const total = samplesCache.length;
  const received = samplesCache.filter((s) => s.status === "Received").length;
  const inProcess = samplesCache.filter((s) => s.status === "In Process").length;
  const ready = samplesCache.filter((s) => s.status === "Report Ready").length;
  const dispatched = samplesCache.filter((s) => s.status === "Dispatched").length;

  const todayKey = new Date().toISOString().slice(0, 10);
  const today = samplesCache.filter((s) => s.receivedAt?.slice(0, 10) === todayKey).length;

  metricEls.total.textContent = String(total);
  metricEls.received.textContent = String(received);
  metricEls.inProcess.textContent = String(inProcess);
  metricEls.ready.textContent = String(ready);
  metricEls.dispatched.textContent = String(dispatched);
  metricEls.today.textContent = String(today);
}

function matchesFilters(sample) {
  const q = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;

  const searchHit = !q || [
    sample.sampleId,
    sample.ownerName,
    sample.phone,
    sample.village,
    sample.testsRequested,
    sample.createdByName,
    sample.updatedByName
  ].join(" ").toLowerCase().includes(q);

  const statusHit = !status || sample.status === status;
  return searchHit && statusHit;
}

function formatDate(dateTimeString) {
  const dt = new Date(dateTimeString);
  if (Number.isNaN(dt.getTime())) return dateTimeString || "-";
  return dt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function canManageRecord(sample) {
  if (!currentUser) return false;
  if (currentUser.role === "admin") return true;
  return sample.createdById === currentUser.id;
}

function renderTable() {
  const rows = samplesCache.filter(matchesFilters);
  recordsBody.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.textContent = "No samples found.";
    td.style.textAlign = "center";
    td.style.color = "#6f7c8f";
    tr.appendChild(td);
    recordsBody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");

    const idTd = document.createElement("td");
    idTd.className = "mono";
    idTd.textContent = row.sampleId;
    tr.appendChild(idTd);

    const receivedTd = document.createElement("td");
    receivedTd.textContent = formatDate(row.receivedAt);
    tr.appendChild(receivedTd);

    const ownerTd = document.createElement("td");
    ownerTd.innerHTML = `<strong>${escapeHtml(row.ownerName)}</strong><br>${escapeHtml(row.phone)}<br><span style="color:#6f7c8f">${escapeHtml(row.village || "-")}</span>`;
    tr.appendChild(ownerTd);

    const speciesTd = document.createElement("td");
    speciesTd.innerHTML = `${escapeHtml(row.species)} / ${escapeHtml(row.sampleType)}<br><span style="color:#6f7c8f">${escapeHtml(row.testsRequested)}</span>`;
    tr.appendChild(speciesTd);

    const statusTd = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge status-${row.status.replace(/\s+/g, "-")}`;
    badge.textContent = row.status;
    statusTd.appendChild(badge);

    if (currentUser) {
      statusTd.appendChild(document.createElement("br"));
      const statusSelect = document.createElement("select");
      for (const s of statusOptions) {
        const option = document.createElement("option");
        option.value = s;
        option.textContent = s;
        statusSelect.appendChild(option);
      }
      statusSelect.value = row.status;
      statusSelect.disabled = !canManageRecord(row);
      statusSelect.addEventListener("change", async () => {
        await quickUpdateStatus(row.id, statusSelect.value);
      });
      statusTd.appendChild(statusSelect);
    }

    tr.appendChild(statusTd);

    const reportTd = document.createElement("td");
    if (row.reportFileId) {
      const reportPill = document.createElement("span");
      reportPill.className = "report-pill";
      reportPill.textContent = row.reportName || "Report";
      reportTd.appendChild(reportPill);
      reportTd.appendChild(document.createElement("br"));

      const previewBtn = actionButton("Preview", () => openReportPreview(row));
      const downloadBtn = actionButton("Download", () => downloadReport(row.reportFileId, row.reportName));
      previewBtn.style.marginTop = "6px";
      downloadBtn.style.marginTop = "6px";
      downloadBtn.style.marginLeft = "4px";
      reportTd.append(previewBtn, downloadBtn);
    } else if (row.reportPublicUrl) {
      const reportPill = document.createElement("span");
      reportPill.className = "report-pill";
      reportPill.textContent = row.reportName || "Cloud Report";
      reportTd.appendChild(reportPill);
      reportTd.appendChild(document.createElement("br"));

      const previewBtn = actionButton("Preview", () => openRemotePreview(row.reportPublicUrl, row.sampleId));
      const openBtn = actionButton("Open", () => window.open(row.reportPublicUrl, "_blank", "noopener"));
      previewBtn.style.marginTop = "6px";
      openBtn.style.marginTop = "6px";
      openBtn.style.marginLeft = "4px";
      reportTd.append(previewBtn, openBtn);
    } else {
      reportTd.textContent = "Not uploaded";
    }
    tr.appendChild(reportTd);

    const userTd = document.createElement("td");
    userTd.innerHTML = `${escapeHtml(row.createdByName || "-")}<br><span style="color:#6f7c8f">${escapeHtml(row.updatedByName || "-")}</span>`;
    tr.appendChild(userTd);

    const actionsTd = document.createElement("td");
    const actionGroup = document.createElement("div");
    actionGroup.className = "action-group";

    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    editBtn.disabled = !canManageRecord(row);
    editBtn.addEventListener("click", () => startEdit(row.id));

    const printReportBtn = document.createElement("button");
    printReportBtn.textContent = "Print Report";
    printReportBtn.addEventListener("click", () => printDetailedReport(row));

    const printSlipBtn = document.createElement("button");
    printSlipBtn.textContent = "Print Slip";
    printSlipBtn.addEventListener("click", () => printSlip(row));

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.style.color = "#a3342b";
    deleteBtn.disabled = !canManageRecord(row);
    deleteBtn.addEventListener("click", async () => {
      const ok = window.confirm(`Delete ${row.sampleId}?`);
      if (!ok) return;

      await deleteLocalSampleById(row.id);
      if (cloudConnected) {
        try {
          await deleteCloudSample(row);
        } catch (error) {
          console.error(error);
          formMsg.textContent = `Deleted locally. Cloud delete failed: ${error.message}`;
          formMsg.style.color = "#b43b2c";
        }
      }

      await refreshSamples();
    });

    actionGroup.append(editBtn, printReportBtn, printSlipBtn, deleteBtn);
    actionsTd.appendChild(actionGroup);
    tr.appendChild(actionsTd);

    recordsBody.appendChild(tr);
  }
}

function actionButton(text, onClick) {
  const btn = document.createElement("button");
  btn.className = "btn btn-outline";
  btn.style.padding = "5px 8px";
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

async function quickUpdateStatus(id, status) {
  const sample = samplesCache.find((s) => s.id === id);
  if (!sample || !canManageRecord(sample)) return;

  sample.status = status;
  sample.updatedById = currentUser.id;
  sample.updatedByName = currentUser.name;
  sample.updatedAt = new Date().toISOString();

  await putLocalSample(sample);
  if (cloudConnected) {
    try {
      await upsertCloudSample(sample);
    } catch (error) {
      console.error(error);
      formMsg.textContent = `Status updated locally. Cloud update failed: ${error.message}`;
      formMsg.style.color = "#b43b2c";
    }
  }

  await refreshSamples();
}

function startEdit(id) {
  const sample = samplesCache.find((s) => s.id === id);
  if (!sample || !canManageRecord(sample)) return;

  editingId = id;
  saveBtn.textContent = "Update Sample";

  document.getElementById("sampleId").value = sample.sampleId || "";
  document.getElementById("receivedAt").value = (sample.receivedAt || "").slice(0, 16);
  document.getElementById("ownerName").value = sample.ownerName || "";
  document.getElementById("phone").value = sample.phone || "";
  document.getElementById("village").value = sample.village || "";
  document.getElementById("species").value = sample.species || "";
  document.getElementById("sampleType").value = sample.sampleType || "";
  document.getElementById("vetName").value = sample.vetName || "";
  document.getElementById("priority").value = sample.priority || "Routine";
  document.getElementById("status").value = sample.status || "Received";
  document.getElementById("testsRequested").value = sample.testsRequested || "";
  document.getElementById("reportDate").value = sample.reportDate || "";
  document.getElementById("diagnosis").value = sample.diagnosis || "";
  document.getElementById("labFindings").value = sample.labFindings || "";
  document.getElementById("remarks").value = sample.remarks || "";

  formMsg.textContent = `Editing ${sample.sampleId}. Upload file to replace existing report.`;
  formMsg.style.color = "#0d7b78";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function openReportPreview(sample) {
  if (!sample.reportFileId) return;

  const file = await getFileById(sample.reportFileId);
  if (!file?.blob) {
    alert("Report file not found in local storage.");
    return;
  }

  closePreview();
  previewUrl = URL.createObjectURL(file.blob);
  previewTitle.textContent = `Report Preview • ${sample.sampleId}`;

  if (file.type.includes("pdf")) {
    previewBody.innerHTML = `<iframe class="preview-frame" src="${previewUrl}"></iframe>`;
  } else if (file.type.startsWith("image/")) {
    previewBody.innerHTML = `<img class="preview-image" src="${previewUrl}" alt="Report image">`;
  } else {
    previewBody.innerHTML = `<p>Preview unavailable for this format. Use download instead.</p>`;
  }

  previewModal.classList.remove("hidden");
}

function openRemotePreview(url, sampleId) {
  closePreview();
  previewTitle.textContent = `Cloud Report • ${sampleId}`;

  if (/\.pdf($|\?)/i.test(url)) {
    previewBody.innerHTML = `<iframe class="preview-frame" src="${url}"></iframe>`;
  } else {
    previewBody.innerHTML = `<img class="preview-image" src="${url}" alt="Report image">`;
  }

  previewModal.classList.remove("hidden");
}

function closePreview() {
  previewModal.classList.add("hidden");
  previewBody.innerHTML = "";
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
}

async function downloadReport(fileId, fileName) {
  const file = await getFileById(fileId);
  if (!file?.blob) {
    alert("Report file not found in local storage.");
    return;
  }

  const blobUrl = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = fileName || "report";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

function printSlip(sample) {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Sample Slip - ${escapeHtml(sample.sampleId)}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { margin: 0 0 8px; font-size: 20px; }
        p { margin: 6px 0; }
        .id { font-weight: 700; font-size: 18px; }
      </style>
    </head>
    <body>
      <h1>DDDL Gurugram - Sample Slip</h1>
      <p class="id">${escapeHtml(sample.sampleId)}</p>
      <p><strong>Received:</strong> ${escapeHtml(formatDate(sample.receivedAt))}</p>
      <p><strong>Owner:</strong> ${escapeHtml(sample.ownerName)} (${escapeHtml(sample.phone)})</p>
      <p><strong>Species/Sample:</strong> ${escapeHtml(sample.species)} / ${escapeHtml(sample.sampleType)}</p>
      <p><strong>Tests:</strong> ${escapeHtml(sample.testsRequested)}</p>
      <script>window.print();</script>
    </body>
    </html>
  `;

  const win = window.open("", "_blank", "width=700,height=600");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function printDetailedReport(sample) {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Lab Report - ${escapeHtml(sample.sampleId)}</title>
      <style>
        body { font-family: 'Segoe UI', sans-serif; margin: 0; padding: 24px; color: #0f2f57; }
        .head { border-bottom: 2px solid #0f2f57; padding-bottom: 10px; margin-bottom: 14px; }
        .head h1 { margin: 0; font-size: 24px; }
        .meta { font-size: 13px; color: #4d5d77; }
        .box { border: 1px solid #d6deeb; border-radius: 10px; padding: 12px; margin-bottom: 10px; }
        .box h3 { margin: 0 0 8px; font-size: 16px; color: #0f2f57; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; font-size: 13px; }
        .label { color: #667891; font-weight: 600; }
        .value { color: #0f2f57; }
        .footer { margin-top: 20px; font-size: 12px; color: #576984; }
      </style>
    </head>
    <body>
      <div class="head">
        <h1>District Disease Diagnosis Laboratory, Gurugram</h1>
        <p class="meta">Animal Husbandry Department, Haryana • Veterinary Lab Report</p>
      </div>

      <div class="box">
        <h3>Sample Information</h3>
        <div class="grid">
          <div><span class="label">Sample ID:</span> <span class="value">${escapeHtml(sample.sampleId)}</span></div>
          <div><span class="label">Received At:</span> <span class="value">${escapeHtml(formatDate(sample.receivedAt))}</span></div>
          <div><span class="label">Owner:</span> <span class="value">${escapeHtml(sample.ownerName)}</span></div>
          <div><span class="label">Phone:</span> <span class="value">${escapeHtml(sample.phone)}</span></div>
          <div><span class="label">Species:</span> <span class="value">${escapeHtml(sample.species)}</span></div>
          <div><span class="label">Sample Type:</span> <span class="value">${escapeHtml(sample.sampleType)}</span></div>
          <div><span class="label">Village:</span> <span class="value">${escapeHtml(sample.village || "-")}</span></div>
          <div><span class="label">Veterinary Surgeon:</span> <span class="value">${escapeHtml(sample.vetName || "-")}</span></div>
        </div>
      </div>

      <div class="box">
        <h3>Tests and Findings</h3>
        <p><strong>Tests Requested:</strong> ${escapeHtml(sample.testsRequested || "-")}</p>
        <p><strong>Lab Findings:</strong> ${escapeHtml(sample.labFindings || "-")}</p>
        <p><strong>Provisional Diagnosis:</strong> ${escapeHtml(sample.diagnosis || "-")}</p>
        <p><strong>Report Date:</strong> ${escapeHtml(sample.reportDate || "-")}</p>
      </div>

      <div class="box">
        <h3>Remarks</h3>
        <p>${escapeHtml(sample.remarks || "No additional remarks")}</p>
      </div>

      <div class="footer">
        Generated by ${escapeHtml(sample.updatedByName || sample.createdByName || "Staff")} • ${escapeHtml(new Date().toLocaleString("en-IN"))}
      </div>
      <script>window.print();</script>
    </body>
    </html>
  `;

  const win = window.open("", "_blank", "width=900,height=800");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function exportRecords() {
  if (!currentUser) return;

  const payload = samplesCache.map((s) => ({
    sampleId: s.sampleId,
    receivedAt: s.receivedAt,
    ownerName: s.ownerName,
    phone: s.phone,
    village: s.village,
    species: s.species,
    sampleType: s.sampleType,
    vetName: s.vetName,
    priority: s.priority,
    status: s.status,
    testsRequested: s.testsRequested,
    reportDate: s.reportDate,
    diagnosis: s.diagnosis,
    labFindings: s.labFindings,
    remarks: s.remarks,
    reportName: s.reportName,
    reportPublicUrl: s.reportPublicUrl,
    createdByName: s.createdByName,
    updatedByName: s.updatedByName,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt
  }));

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dddl-records-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function clearAllData() {
  if (!currentUser || currentUser.role !== "admin") {
    alert("Only admin can clear all data.");
    return;
  }

  const ok = window.confirm("Clear all records and uploaded reports from this browser?");
  if (!ok) return;

  if (cloudConnected) {
    try {
      const cloudRows = await getCloudSamples();
      for (const row of cloudRows) {
        await deleteCloudSample(row);
      }
      setCloudMsg("Cloud records cleared.");
    } catch (error) {
      console.error(error);
      setCloudMsg(`Cloud clear failed: ${error.message}`, true);
    }
  }

  await new Promise((resolve, reject) => {
    const tx = db.transaction([SAMPLE_STORE, FILE_STORE], "readwrite");
    tx.objectStore(SAMPLE_STORE).clear();
    tx.objectStore(FILE_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  onResetForm();
  await refreshSamples();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

init();
