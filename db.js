// ============================================================
// StudyTrack — Supabase sync layer
// All reads/writes go through this file
// Falls back to localStorage if offline
// ============================================================

const DB_CONFIG = {
  url: 'https://ecmtrizpoarvgxyvnhwh.supabase.co',       // e.g. https://xyzxyz.supabase.co
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjbXRyaXpwb2FydmdreXZuaHdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MzM1NTksImV4cCI6MjEwNDEwOTU1OX0.RWAkeeTiRRsRo8f1lDdBCeYwGQffPoaJRns-vYuV050', // eyJ...
};

// ─── Supabase REST helpers ───────────────────────────────────
async function sbFetch(path, method='GET', body=null) {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': DB_CONFIG.anonKey,
    'Authorization': 'Bearer ' + DB_CONFIG.anonKey,
    'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=representation' : '',
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(DB_CONFIG.url + '/rest/v1/' + path, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Supabase error: ' + err);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ─── Device ID (stable per browser) ─────────────────────────
function getDeviceId() {
  let id = localStorage.getItem('st_device_id');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('st_device_id', id);
  }
  return id;
}

// ─── Online check ────────────────────────────────────────────
function isOnline() {
  return navigator.onLine && DB_CONFIG.url !== 'https://ecmtrizpoarvgxyvnhwh.supabase.co';
}

// ============================================================
// SESSIONS (tracker.html)
// ============================================================

export async function saveSessions(sessions) {
  // Always save to localStorage first (offline fallback)
  localStorage.setItem('studytrack_v1', JSON.stringify(sessions));
  if (!isOnline()) return;
  try {
    // Upsert all sessions — Supabase handles duplicates via id
    if (sessions.length === 0) return;
    await sbFetch('sessions?on_conflict=id', 'POST', sessions.map(s => ({
      id: String(s.id),
      date: s.date,
      hours: s.hours,
      track: s.track,
      activity: s.activity,
      phase: String(s.phase),
      difficulty: s.diff,
      note: s.note || '',
    })));
  } catch(e) {
    console.warn('Sync sessions failed:', e.message);
  }
}

export async function loadSessions() {
  // Try Supabase first
  if (isOnline()) {
    try {
      const rows = await sbFetch('sessions?select=*&order=date.desc');
      if (rows && rows.length > 0) {
        const sessions = rows.map(r => ({
          id: Number(r.id),
          date: r.date,
          hours: r.hours,
          track: r.track,
          activity: r.activity,
          phase: r.phase,
          diff: r.difficulty,
          note: r.note || '',
        }));
        // Update local cache
        localStorage.setItem('studytrack_v1', JSON.stringify(sessions));
        return sessions;
      }
    } catch(e) {
      console.warn('Load sessions failed, using local:', e.message);
    }
  }
  // Fallback to localStorage
  try {
    return JSON.parse(localStorage.getItem('studytrack_v1') || '[]');
  } catch(e) { return []; }
}

export async function deleteSession(id) {
  // Remove from localStorage
  const sessions = JSON.parse(localStorage.getItem('studytrack_v1') || '[]')
    .filter(s => s.id !== id);
  localStorage.setItem('studytrack_v1', JSON.stringify(sessions));
  // Remove from Supabase
  if (isOnline()) {
    try {
      await sbFetch('sessions?id=eq.' + id, 'DELETE');
    } catch(e) {
      console.warn('Delete session failed:', e.message);
    }
  }
  return sessions;
}

// ============================================================
// PLAN STATE (index.html — task checkboxes + milestones)
// ============================================================

export async function savePlanState(taskState, msState) {
  const payload = { tasks: taskState, milestones: msState };
  // Always save locally
  localStorage.setItem('cpp_career_plan_v1', JSON.stringify(payload));
  if (!isOnline()) return;
  try {
    await sbFetch('plan_state?on_conflict=id', 'POST', [{
      id: 'main',
      task_state: taskState,
      milestone_state: msState,
      updated_at: new Date().toISOString(),
    }]);
  } catch(e) {
    console.warn('Sync plan state failed:', e.message);
  }
}

export async function loadPlanState() {
  if (isOnline()) {
    try {
      const rows = await sbFetch('plan_state?id=eq.main&select=*');
      if (rows && rows.length > 0) {
        const { task_state, milestone_state } = rows[0];
        const payload = { tasks: task_state, milestones: milestone_state };
        localStorage.setItem('cpp_career_plan_v1', JSON.stringify(payload));
        return payload;
      }
    } catch(e) {
      console.warn('Load plan state failed, using local:', e.message);
    }
  }
  try {
    const saved = localStorage.getItem('cpp_career_plan_v1');
    return saved ? JSON.parse(saved) : { tasks: {}, milestones: {} };
  } catch(e) { return { tasks: {}, milestones: {} }; }
}

// ============================================================
// SYNC STATUS INDICATOR
// ============================================================
export function showSyncStatus(elementId, success=true) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = success
    ? (isOnline() ? '☁️ Synced' : '💾 Saved locally')
    : '⚠️ Sync failed — saved locally';
  el.style.color = success ? '#1D9E75' : '#BA7517';
  el.style.opacity = 1;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.opacity = 0, 2500);
}
