/**
 * TeamPulse — app.js
 *
 * Core state-sync loop:
 *  1. Load all members  → GET  /api/members
 *  2. Toggle availability → PATCH /api/members/:id/availability
 *     (updates DB boolean, returns updated record, re-renders card)
 *  3. Add member        → POST  /api/members
 *  4. Delete member     → DELETE /api/members/:id
 *  5. Stats             → GET  /api/stats
 *
 * Conditional rendering: cards have .available / .unavailable classes
 * that drive all visual states (toggle colour, border glow, status dot,
 * label badge) purely through CSS — no inline style thrashing.
 */

const API = 'http://127.0.0.1:8002';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const membersGrid    = document.getElementById('membersGrid');
const noResults      = document.getElementById('noResults');
const searchInput    = document.getElementById('searchInput');
const filterBtns     = document.querySelectorAll('.filter-btn');
const activityList   = document.getElementById('activityList');
const activityEmpty  = document.getElementById('activityEmpty');
const btnClearLog    = document.getElementById('btnClearLog');
const btnAddMember   = document.getElementById('btnAddMember');
const addModal       = document.getElementById('addModal');
const modalClose     = document.getElementById('modalClose');
const btnCancel      = document.getElementById('btnCancel');
const addMemberForm  = document.getElementById('addMemberForm');
const colorPicker    = document.getElementById('colorPicker');
const noteModal      = document.getElementById('noteModal');
const noteModalClose = document.getElementById('noteModalClose');
const noteCancel     = document.getElementById('noteCancel');
const noteSave       = document.getElementById('noteSave');
const noteInput      = document.getElementById('noteInput');
const quickNotes     = document.getElementById('quickNotes');
const toastEl        = document.getElementById('toast');
const liveClock      = document.getElementById('liveClock');

// Stats
const numTotal     = document.getElementById('numTotal');
const numAvailable = document.getElementById('numAvailable');
const numBusy      = document.getElementById('numBusy');
const numRate      = document.getElementById('numRate');
const rateBar      = document.getElementById('rateBar');

// ── State ─────────────────────────────────────────────────────────────────────
let allMembers      = [];         // full list from API
let activeFilter    = 'all';      // 'all' | 'available' | 'unavailable'
let selectedColor   = '#8b5cf6';  // for add-member modal
let toastTimer      = null;

// Note modal pending state
let pendingToggleId   = null;
let pendingToggleVal  = null;

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  loadMembers();
  loadStats();
  setupListeners();
});

// ── Live clock ────────────────────────────────────────────────────────────────
function startClock() {
  function tick() {
    const now = new Date();
    liveClock.textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  tick();
  setInterval(tick, 1000);
}

// ── Event listeners ───────────────────────────────────────────────────────────
function setupListeners() {
  // Filters
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderGrid();
    });
  });

  // Search
  searchInput.addEventListener('input', renderGrid);

  // Activity log clear
  btnClearLog.addEventListener('click', () => {
    activityList.innerHTML = '';
    activityEmpty.hidden   = false;
    activityList.prepend(activityEmpty);
  });

  // Add member modal
  btnAddMember.addEventListener('click', openAddModal);
  modalClose.addEventListener('click', closeAddModal);
  btnCancel.addEventListener('click', closeAddModal);
  addModal.addEventListener('click', e => { if (e.target === addModal) closeAddModal(); });

  // Color swatches
  colorPicker.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      colorPicker.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.remove('active');
        s.setAttribute('aria-pressed', 'false');
      });
      sw.classList.add('active');
      sw.setAttribute('aria-pressed', 'true');
      selectedColor = sw.dataset.color;
    });
  });

  // Add member form submit
  addMemberForm.addEventListener('submit', handleAddMember);

  // Note modal
  noteModalClose.addEventListener('click', closeNoteModal);
  noteCancel.addEventListener('click', closeNoteModal);
  noteModal.addEventListener('click', e => { if (e.target === noteModal) closeNoteModal(); });
  noteSave.addEventListener('click', confirmToggleWithNote);

  // Quick note buttons
  quickNotes.querySelectorAll('.quick-note-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      quickNotes.querySelectorAll('.quick-note-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      noteInput.value = btn.dataset.note;
    });
  });

  // Keyboard: close modals on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!addModal.hidden) closeAddModal();
      if (!noteModal.hidden) closeNoteModal();
    }
  });
}

// ── Load members ──────────────────────────────────────────────────────────────
async function loadMembers() {
  try {
    const res = await fetch(`${API}/api/members`);
    if (!res.ok) throw new Error();
    allMembers = await res.json();
    renderGrid();
  } catch (_) {
    membersGrid.innerHTML = '';
    showToast('Cannot reach backend. Is it running on port 8002?', 'error');
  }
}

// ── Render grid (conditional rendering based on filter + search) ──────────────
function renderGrid() {
  const query = searchInput.value.trim().toLowerCase();

  let filtered = allMembers.filter(m => {
    const matchFilter =
      activeFilter === 'all'         ? true :
      activeFilter === 'available'   ? m.is_available :
                                       !m.is_available;

    const matchSearch =
      !query ||
      m.name.toLowerCase().includes(query) ||
      m.role.toLowerCase().includes(query) ||
      m.department.toLowerCase().includes(query);

    return matchFilter && matchSearch;
  });

  // Remove skeletons
  membersGrid.querySelectorAll('.skeleton-card').forEach(s => s.remove());

  if (filtered.length === 0) {
    membersGrid.innerHTML = '';
    noResults.hidden = false;
    return;
  }

  noResults.hidden = true;

  // Sync existing cards and add missing ones
  const existingIds = new Set([...membersGrid.querySelectorAll('.member-card')].map(c => Number(c.dataset.id)));
  const filteredIds = new Set(filtered.map(m => m.id));

  // Remove cards no longer in filtered set
  membersGrid.querySelectorAll('.member-card').forEach(card => {
    if (!filteredIds.has(Number(card.dataset.id))) card.remove();
  });

  // Add / update each filtered member
  filtered.forEach((member, idx) => {
    const existing = membersGrid.querySelector(`[data-id="${member.id}"]`);
    if (existing) {
      updateCardDOM(existing, member);
    } else {
      const card = buildMemberCard(member);
      card.style.animationDelay = `${idx * 40}ms`;
      membersGrid.appendChild(card);
    }
  });
}

// ── Build a member card ───────────────────────────────────────────────────────
function buildMemberCard(member) {
  const article = document.createElement('article');
  article.className = `member-card ${member.is_available ? 'available' : 'unavailable'}`;
  article.dataset.id = member.id;
  article.style.setProperty('--avatar-color', member.avatar_color);
  article.setAttribute('aria-label', `${member.name}, ${member.is_available ? 'available' : 'unavailable'}`);

  article.innerHTML = cardInnerHTML(member);
  attachCardListeners(article, member);
  return article;
}

function cardInnerHTML(m) {
  const initials  = getInitials(m.name);
  const tzIcon    = '🌐';
  const availText = m.is_available ? 'Available' : 'Unavailable';

  return `
    <div class="card-top">
      <div class="member-avatar" style="background:${esc(m.avatar_color)}" aria-hidden="true">${esc(initials)}</div>
      <div class="member-info">
        <div class="member-name">${esc(m.name)}</div>
        <div class="member-role">${esc(m.role)}</div>
        <span class="member-dept">${esc(m.department)}</span>
      </div>
      <button class="card-delete-btn" data-id="${m.id}" title="Remove member" aria-label="Remove ${esc(m.name)}">✕</button>
    </div>

    <div class="member-status-note" id="note-${m.id}">${esc(m.status_note) || '&nbsp;'}</div>

    <div class="card-bottom">
      <span class="member-tz">${tzIcon} ${esc(m.timezone)}</span>
      <span class="availability-label">${availText}</span>

      <label class="toggle-switch" aria-label="Toggle ${esc(m.name)}'s availability">
        <input type="checkbox" class="avail-toggle" data-id="${m.id}" ${m.is_available ? 'checked' : ''} aria-checked="${m.is_available}" />
        <span class="toggle-track">
          <span class="toggle-thumb"></span>
        </span>
      </label>
    </div>`;
}

function attachCardListeners(card, member) {
  // Toggle checkbox
  const checkbox = card.querySelector('.avail-toggle');
  checkbox.addEventListener('change', () => handleToggle(member.id, checkbox.checked, card));

  // Delete button
  const delBtn = card.querySelector('.card-delete-btn');
  delBtn.addEventListener('click', e => { e.stopPropagation(); handleDelete(member.id, card); });
}

// ── Update existing card DOM in-place ─────────────────────────────────────────
function updateCardDOM(card, member) {
  card.className = `member-card ${member.is_available ? 'available' : 'unavailable'}`;
  card.setAttribute('aria-label', `${member.name}, ${member.is_available ? 'available' : 'unavailable'}`);

  const label = card.querySelector('.availability-label');
  if (label) label.textContent = member.is_available ? 'Available' : 'Unavailable';

  const noteEl = card.querySelector('.member-status-note');
  if (noteEl) noteEl.innerHTML = esc(member.status_note) || '&nbsp;';

  const chk = card.querySelector('.avail-toggle');
  if (chk) {
    chk.checked = member.is_available;
    chk.setAttribute('aria-checked', member.is_available);
  }
}

// ── Handle toggle ─────────────────────────────────────────────────────────────
function handleToggle(memberId, newVal, card) {
  if (!newVal) {
    // Going UNAVAILABLE → ask for optional status note first
    pendingToggleId  = memberId;
    pendingToggleVal = newVal;
    noteInput.value  = '';
    quickNotes.querySelectorAll('.quick-note-btn').forEach(b => b.classList.remove('selected'));
    openNoteModal();
  } else {
    // Going AVAILABLE → no note needed, just toggle
    patchAvailability(memberId, true, '', card);
  }
}

async function patchAvailability(memberId, isAvail, statusNote, card) {
  // Immediately reflect UI (optimistic update)
  const member = allMembers.find(m => m.id === memberId);
  if (!member) return;

  // Lock toggle during API call
  const track = card?.querySelector('.toggle-track');
  if (track) track.classList.add('pending');

  try {
    /**
     * PATCH /api/members/:id/availability
     * Sends { is_available: bool, status_note: string } to backend.
     * Backend updates the DB boolean and returns the updated record.
     * Frontend then re-renders the card based on the server response —
     * this is the state-sync pattern: UI state always reflects DB truth.
     */
    const res = await fetch(`${API}/api/members/${memberId}/availability`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_available: isAvail, status_note: statusNote }),
    });

    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    const updated = await res.json();

    // Sync local state with DB-confirmed data
    const idx = allMembers.findIndex(m => m.id === memberId);
    if (idx !== -1) allMembers[idx] = updated;

    // Re-render this specific card with confirmed data
    if (card) updateCardDOM(card, updated);

    logActivity(updated);
    loadStats();

    showToast(
      `${updated.name} is now ${updated.is_available ? '🟢 Available' : '🔴 Unavailable'}`,
      updated.is_available ? 'success' : 'info'
    );

  } catch (err) {
    // Revert optimistic update on failure
    if (member) updateCardDOM(card, member);
    showToast(`Failed to update: ${err.message}`, 'error');
  } finally {
    if (track) track.classList.remove('pending');
  }
}

// ── Note modal confirm ────────────────────────────────────────────────────────
function confirmToggleWithNote() {
  const note = noteInput.value.trim();
  const card = membersGrid.querySelector(`[data-id="${pendingToggleId}"]`);
  closeNoteModal();
  if (pendingToggleId !== null) {
    patchAvailability(pendingToggleId, pendingToggleVal, note, card);
  }
  pendingToggleId  = null;
  pendingToggleVal = null;
}

// ── Add member ────────────────────────────────────────────────────────────────
async function handleAddMember(e) {
  e.preventDefault();
  const name = document.getElementById('fieldName').value.trim();
  if (!name) {
    document.getElementById('nameError').textContent = 'Name is required.';
    document.getElementById('fieldName').focus();
    return;
  }
  document.getElementById('nameError').textContent = '';

  const payload = {
    name,
    role:         document.getElementById('fieldRole').value.trim() || 'Team Member',
    department:   document.getElementById('fieldDept').value.trim() || 'General',
    timezone:     document.getElementById('fieldTz').value.trim()   || 'UTC',
    avatar_color: selectedColor,
    is_available: document.getElementById('fieldAvail').checked,
    status_note:  '',
  };

  document.getElementById('btnSubmit').disabled = true;

  try {
    const res = await fetch(`${API}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to add member');
    const newMember = await res.json();
    allMembers.unshift(newMember);
    closeAddModal();
    renderGrid();
    loadStats();
    showToast(`✦ ${newMember.name} added to the team!`, 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    document.getElementById('btnSubmit').disabled = false;
  }
}

// ── Delete member ─────────────────────────────────────────────────────────────
async function handleDelete(memberId, card) {
  const member = allMembers.find(m => m.id === memberId);
  if (!confirm(`Remove ${member?.name || 'this member'} from the team?`)) return;

  try {
    const res = await fetch(`${API}/api/members/${memberId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('Delete failed');

    allMembers = allMembers.filter(m => m.id !== memberId);
    card.style.transition = 'all 0.3s ease';
    card.style.opacity    = '0';
    card.style.transform  = 'scale(0.9)';
    setTimeout(() => { card.remove(); renderGrid(); }, 300);
    loadStats();
    showToast(`${member?.name} removed.`, 'info');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ── Load stats ────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch(`${API}/api/stats`);
    if (!res.ok) return;
    const s = await res.json();
    numTotal.textContent     = s.total;
    numAvailable.textContent = s.available;
    numBusy.textContent      = s.unavailable;
    numRate.textContent      = `${s.availability_rate}%`;
    rateBar.style.width      = `${s.availability_rate}%`;
  } catch (_) { /* silent */ }
}

// ── Activity log ──────────────────────────────────────────────────────────────
function logActivity(member) {
  activityEmpty.hidden = true;

  const li = document.createElement('li');
  li.className = 'activity-item';

  const now    = new Date();
  const time   = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const status = member.is_available ? 'Available' : 'Unavailable';
  const cls    = member.is_available ? 'to-available' : 'to-unavailable';
  const note   = member.status_note ? ` · "${esc(member.status_note)}"` : '';

  li.innerHTML = `
    <div class="log-name">${esc(member.name)}</div>
    <div class="log-action ${cls}">→ ${status}${note}</div>
    <div class="log-time">${time}</div>`;

  activityList.insertBefore(li, activityList.firstChild);

  // Keep last 30 entries
  while (activityList.children.length > 31) {
    activityList.removeChild(activityList.lastChild);
  }
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openAddModal() {
  addMemberForm.reset();
  document.getElementById('nameError').textContent = '';
  addModal.hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('fieldName').focus();
}

function closeAddModal() {
  addModal.hidden = true;
  document.body.style.overflow = '';
}

function openNoteModal() {
  noteModal.hidden = false;
  document.body.style.overflow = 'hidden';
  noteInput.focus();
}

function closeNoteModal() {
  noteModal.hidden = true;
  document.body.style.overflow = '';
  // Revert the checkbox if user cancelled
  if (pendingToggleId !== null) {
    const card = membersGrid.querySelector(`[data-id="${pendingToggleId}"]`);
    const chk  = card?.querySelector('.avail-toggle');
    if (chk) chk.checked = !pendingToggleVal;  // revert
  }
  pendingToggleId  = null;
  pendingToggleVal = null;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  toastEl.textContent = msg;
  toastEl.className   = `toast ${type} visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 3200);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
}

function esc(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
