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
  // Also no-ops when the Soldier has turned "Reminder notifications" off —
  // previously only syncAll() checked s.notifyReminders, so turning the
  // Settings toggle off cancelled everything already queued but did nothing
  // to stop a reminder added AFTER that point (the Reminders editor's own
  // add button, the salary-negotiation quick-add, the USAJOBS quick-add all
  // called this directly) from still arming a real native notification,
  // directly contradicting the toggle's own "Off" copy.
  async function scheduleForReminder(r) {
    const p = plugin();
    if (!p || !r || !r.date) return false;
    try {
      const s = (G.store && G.store.settings && G.store.settings()) || {};
      if (!s.notifyReminders) return false;
    } catch (e) { return false; }
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

  // How many reminder notifications are ACTUALLY sitting in the OS's
  // schedule right now, as opposed to what s.notifyReminders (a local,
  // app-side boolean) claims. Settings' own toggle previously only ever
  // read that boolean, so it could read "on" for weeks after the Soldier
  // revoked GUIDON's notification permission from Android's system
  // settings (or the OS itself dropped the schedule on a reinstall) with
  // no way to tell from inside the app. Paired with checkPermission()
  // below, this gives Settings a real, live answer instead of an assumed
  // one — see the "Notifications" panel in index.html's views.settings.
  async function getPendingCount() {
    const p = plugin();
    if (!p) return 0;
    try { const r = await p.getPending(); return (r && Array.isArray(r.notifications)) ? r.notifications.length : 0; }
    catch (e) { return 0; }
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

  // The inverse of syncAll(): cancels every currently-scheduled reminder
  // notification. Settings' own toggle previously had no way to do this at
  // all when turned off - it only cleared the notifyReminders flag, so
  // anything already armed in the OS notification queue kept firing on its
  // scheduled date regardless, directly contradicting the on-screen copy
  // telling the Soldier notifications are off.
  async function cancelAll() {
    if (!plugin()) return false;
    try {
      const list = (G.reminders && (await G.reminders.load())) || [];
      for (const r of list) { await cancelForReminder(r.id); }
      return true;
    } catch (e) { return false; }
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
    getPendingCount,
    syncAll,
    cancelAll,
    _notifId: notifId, // exported for tests
  };
})();
// END notify.js
