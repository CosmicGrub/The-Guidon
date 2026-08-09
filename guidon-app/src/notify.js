/* ==== js/notify.js ==== */
/* GUIDON — notify.js : local reminder notifications (G.notify)

   Only does anything inside a Capacitor Android build; a no-op everywhere else
   (web, Tauri, file://) so this file is safe to load anywhere, same convention
   as native.js.

   Schedules a LOCAL notification (no network, no push service, no backend, no
   data leaving the device) for reminders the Soldier sets in the Reminders
   editor, using @capacitor/local-notifications. Nothing is scheduled and no
   permission prompt fires until the Soldier explicitly turns the toggle on in
   Settings — never at launch, only from that one contextual moment.
*/
window.G = window.G || {};
(function () {
  "use strict";

  const Cap = window.Capacitor;
  const isNative = !!(Cap && (Cap.isNativePlatform ? Cap.isNativePlatform() : Cap.isNative));

  function plugin() {
    return (Cap && Cap.Plugins && Cap.Plugins.LocalNotifications) || null;
  }

  function supported() {
    return isNative && !!plugin();
  }

  // Stable, deterministic notification ID derived from the reminder's own
  // string id, so re-scheduling the same reminder updates it in place instead
  // of stacking duplicates, and cancelling later needs no separate id-map.
  function notifId(reminderId) {
    let h = 0;
    for (let i = 0; i < reminderId.length; i++) { h = (h * 31 + reminderId.charCodeAt(i)) | 0; }
    return Math.abs(h) % 2147483647 || 1;
  }

  async function checkPermission() {
    const p = plugin();
    if (!p) return "unsupported";
    try { const r = await p.checkPermissions(); return (r && r.display) || "denied"; }
    catch (e) { return "denied"; }
  }

  // The one and only place this ever prompts the OS permission dialog —
  // called from Settings' own toggle, never on boot.
  async function requestPermission() {
    const p = plugin();
    if (!p) return "unsupported";
    try { const r = await p.requestPermissions(); return (r && r.display) || "denied"; }
    catch (e) { return "denied"; }
  }

  // Schedules one notification for 09:00 local on the reminder's date.
  // Silently no-ops if unsupported, the reminder has no date, or that date
  // has already passed — callers don't need to guard any of that themselves.
  async function scheduleForReminder(r) {
    const p = plugin();
    if (!p || !r || !r.date) return false;
    try {
      const when = new Date(r.date + "T09:00:00");
      if (isNaN(when.getTime()) || when.getTime() <= Date.now()) return false;
      await p.schedule({ notifications: [{
        id: notifId(r.id),
        title: "GUIDON — " + r.label,
        body: r.note || "Due today.",
        schedule: { at: when },
      }] });
      return true;
    } catch (e) { console.warn("notify: schedule failed:", e && e.message); return false; }
  }

  async function cancelForReminder(reminderId) {
    const p = plugin();
    if (!p) return false;
    try { await p.cancel({ notifications: [{ id: notifId(reminderId) }] }); return true; }
    catch (e) { return false; }
  }

  // Re-syncs every upcoming reminder's notification against the plugin's own
  // schedule. Called once right after the Soldier turns the toggle on, and
  // again on boot so a reinstall/update never silently drops the schedule —
  // this NEVER prompts for permission itself, it only re-applies a choice
  // already made.
  async function syncAll() {
    if (!supported()) return;
    try {
      const s = (G.store && G.store.settings && G.store.settings()) || {};
      if (!s.notifyReminders) return;
      const list = (G.reminders && (await G.reminders.load())) || [];
      for (const r of list) { await scheduleForReminder(r); }
    } catch (e) {}
  }

  if (isNative) {
    // Long enough that the rest of boot (theme, seed, router) is settled
    // first; this is a background resync, not something on the critical path.
    setTimeout(syncAll, 1500);
  }

  G.notify = {
    supported,
    checkPermission,
    requestPermission,
    scheduleForReminder,
    cancelForReminder,
    syncAll,
    _notifId: notifId, // exported for tests
  };
})();
// END notify.js
