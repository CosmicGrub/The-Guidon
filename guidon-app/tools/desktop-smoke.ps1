# tools/desktop-smoke.ps1 - T9 desktop smoke for the GUIDON Tauri shell.
#
# Launches a from-tree guidon.exe ONCE and records what it does, in the order
# a person would see it:
#
#   1. time-to-first-visible-window   EnumWindows polled every 10 ms for a
#                                     visible, unowned top-level window of
#                                     the launched PID;
#   2. client-area screenshots        at +150 ms and +1500 ms after that
#                                     window appeared (PrintWindow with
#                                     PW_CLIENTONLY|PW_RENDERFULLCONTENT, or
#                                     BitBlt-from-screen when PrintWindow
#                                     refuses), each judged by
#                                     tools/png-render-check.py and the pair
#                                     by its --compare mode;
#   3. GetWindowRect                  at first-visible and at +1000 ms, plus
#                                     every change in between, so the
#                                     centred-then-maximized jump that the
#                                     window-state plugin's restore produces
#                                     is on the record with its timing;
#   4. EnumWindows count              every top-level window of the PID
#                                     (visible or not) with class and title;
#   5. WM_CLOSE                       posted to the main window, then a wait
#                                     for the process to exit. Stop-Process
#                                     is the documented LAST RESORT only,
#                                     after WM_CLOSE has been posted twice
#                                     and ignored twice; it is reported as
#                                     force_killed:true in the summary;
#   6. .window-state.json             the file tauri-plugin-window-state
#                                     writes on exit (AppHandle.path()
#                                     .app_config_dir() = %APPDATA%\
#                                     app.guidon.trainer, DEFAULT_FILENAME
#                                     ".window-state.json" - read from the
#                                     plugin's own src/lib.rs, 2.4.1),
#                                     snapshot before launch and after exit.
#
# Data isolation. Tauri does not expose a "profile dir" switch and rule 9 of
# the desktop plan forbids dataDirectory/incognito on the window (it would
# split the IndexedDB). What the WebView2 LOADER honours, independent of the
# app, is the WEBVIEW2_USER_DATA_FOLDER environment variable, so every run
# sets it to a fresh folder of its own and then MEASURES whether that folder
# was populated (clean_data_dir.honored) and whether the operator's real
# profile (%LOCALAPPDATA%\app.guidon.trainer\EBWebView) gained a newer file
# during the run (real_profile.touched). The window-state file is the one
# thing this cannot redirect: the plugin resolves %APPDATA% through the
# shell's known-folder API, not the environment. It holds window geometry
# only (no study data), and the summary records its before/after contents.
#
# Exit codes: 0 baseline recorded (every finding is INFO, nothing here is a
# gate yet) or, with -Phase4, every Phase 4 assertion passed; 1 the exe never
# showed a window within -WindowTimeoutMs, or (-Phase4 only) at least one
# Phase 4 assertion failed; 2 a precondition failed (exe missing, GUIDON
# already running - the single-instance plugin would hand off to it and exit
# at once, python missing).
#
# -Phase4 turns on the R2/R3/R4/R6/R7/R8 assertions from the desktop plan
# (see $summary.phase4 in the JSON for each one's pass/fail and measured
# value). Baseline mode (no -Phase4) is completely unchanged by their
# presence: the extra shots and keystrokes are simply not taken, and the
# exit code stays governed by window-timeout/precondition only. Today none
# of R2-R8 are implemented, so -Phase4 is expected to fail every assertion
# it runs (rule 5: verifier first, RED before the Rust change, then GREEN).
#
# Two GAP-closing assertions (verify pass 2026-09-05), additive to the
# pixel-based checks they sit beside, not replacements for them:
#   R3.f5_nav_probe_unchanged   a Rust-side page-load counter
#                                (src-tauri/src/desktop.rs::NavLoadState),
#                                read over WebView2 remote debugging via
#                                tools/nav-probe.mjs (node) before and after
#                                F5 - real, because it lives outside the
#                                page a reload would otherwise reset, unlike
#                                R3.f5_no_reload's pixel diff, which cannot
#                                tell a real reload from none on this app.
#   R8.background_color_applied nativeThemeBackgroundApplied in the R8
#                                selftest JSON, set at the exact call site
#                                of Window::set_background_color - never
#                                inferred from nativeTheme.ground - so a
#                                regression that silently drops that call
#                                is caught even though set_theme still
#                                succeeds.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File tools/desktop-smoke.ps1 <exe> [-OutDir dir] [-Phase4]
#         npm run desktop:smoke        (the from-tree debug exe)
#
# Windows PowerShell 5.1: no ternary, no ??, no C# 6 in Add-Type. Writes
# LF-only UTF-8 (no BOM) so the JSON diffs cleanly on every platform.

param(
  [Parameter(Position = 0)][string]$ExePath = "",
  [string]$OutDir = "",
  # 20000 -> 60000 (2026-09-08): the desktop.yml CI job (windows-latest,
  # `npm run desktop:smoke`, no override - so this default is what CI
  # actually runs under) failed twice tonight with the identical "no
  # visible top-level window within 20000 ms (process exited: False)"
  # signature, on a brand-new, author-labeled "AUTHORED-BUT-UNRUN" job
  # never validated against real CI before merging. The 20000ms figure was
  # set against this session's own measured LOCAL baseline (window visible
  # ~112-113ms after launch per this file's own header) - a ~44x margin
  # that's real on a warm dev machine but doesn't hold on a cold CI runner
  # doing its first-ever WebView2 launch in a fresh, throwaway user-data
  # folder (WebView2 runtime/profile provisioning, JIT, disk cache all
  # cold at once) - process exited:False both times confirms the exe
  # itself never crashed, it was still genuinely starting when the clock
  # ran out. Matches this same night's own established pattern for a
  # first-real-CI-exposure margin issue (rapid-fire's waitForFunction,
  # widened 15000->30000ms for the identical reason) - a real condition-
  # based wait needing more patience under load, not a hang to paper over.
  [int]$WindowTimeoutMs = 60000,
  [int]$EarlyShotMs = 150,
  [int]$RectMs = 1000,
  [int]$LateShotMs = 1500,
  [int]$CloseWaitMs = 10000,
  [switch]$KeepData,
  [switch]$Phase4
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2

function Say([string]$tag, [string]$msg) { Write-Output ("  {0,-5} {1}" -f $tag, $msg) }
function Fail([int]$code, [string]$msg) { Say "FAIL" $msg; exit $code }

# ---------------------------------------------------------------------------
# user32 / gdi32 surface. C# 5 only (PowerShell 5.1 compiles with the .NET
# Framework CodeDom compiler).
# ---------------------------------------------------------------------------
if (-not ([System.Management.Automation.PSTypeName]'GuidonSmoke').Type) {
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class GuidonSmoke {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public class Win {
    public long Hwnd; public bool Visible; public bool Owned; public string Title; public string Class;
  }
  // Every top-level window (EnumWindows never yields children) of one PID.
  public static List<Win> Windows(uint pid) {
    List<Win> list = new List<Win>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint p;
      GetWindowThreadProcessId(h, out p);
      if (p == pid) {
        Win w = new Win();
        w.Hwnd = h.ToInt64();
        w.Visible = IsWindowVisible(h);
        w.Owned = GetWindow(h, 4) != IntPtr.Zero;   // GW_OWNER
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(h, sb, 512);
        w.Title = sb.ToString();
        StringBuilder cb = new StringBuilder(256);
        GetClassName(h, cb, 256);
        w.Class = cb.ToString();
        list.Add(w);
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }
  public static string Title(IntPtr h) {
    StringBuilder sb = new StringBuilder(512);
    GetWindowText(h, sb, 512);
    return sb.ToString();
  }
}
"@
}
Add-Type -AssemblyName System.Drawing

# Per-monitor-v2 DPI awareness so GetWindowRect/GetClientRect and the
# screenshots are in physical pixels. Recorded, not assumed: powershell.exe
# may already carry an awareness from its manifest, in which case this
# returns false and the values are whatever that context yields.
$dpiAwareSet = [GuidonSmoke]::SetProcessDpiAwarenessContext([IntPtr](-4))

# ---------------------------------------------------------------------------
# Preconditions.
# ---------------------------------------------------------------------------
$toolsDir = $PSScriptRoot
$appDir = Split-Path -Parent $toolsDir
if ($ExePath -eq "") { Fail 2 "usage: desktop-smoke.ps1 <path-to-guidon.exe> [-OutDir dir]" }
if (-not (Test-Path -LiteralPath $ExePath)) { Fail 2 ("exe not found: " + $ExePath) }
$exe = (Resolve-Path -LiteralPath $ExePath).Path
$exeItem = Get-Item -LiteralPath $exe
$exeStem = [IO.Path]::GetFileNameWithoutExtension($exe)

$already = @(Get-Process -Name $exeStem -ErrorAction SilentlyContinue)
if ($already.Count -gt 0) {
  $pids = (@($already | ForEach-Object { $_.Id }) -join ",")
  Fail 2 ("{0} is already running (PID {1}); tauri-plugin-single-instance would hand this launch to it and exit. Close it first." -f $exeStem, $pids)
}

$checker = Join-Path $toolsDir "png-render-check.py"
if (-not (Test-Path -LiteralPath $checker)) { Fail 2 ("missing " + $checker) }
$py = $null
$pyArgs = @()
if (Get-Command py -ErrorAction SilentlyContinue) { $py = "py"; $pyArgs = @("-3") }
elseif (Get-Command python -ErrorAction SilentlyContinue) { $py = "python" }
if ($null -eq $py) { Fail 2 "python 3 not found (py or python on PATH); png-render-check.py needs it" }
$pyVersion = (& $py @pyArgs --version 2>&1 | Out-String).Trim()
if ($pyVersion -notmatch "^Python 3") { Fail 2 ("python 3 required, found: " + $pyVersion) }

# GAP B (Phase4 only): R3.f5_nav_probe_unchanged reads a Rust-side counter
# over WebView2 remote debugging via tools/nav-probe.mjs (node), a real
# signal the pixel diff alone cannot provide - see that script's header.
$navProbeScript = Join-Path $toolsDir "nav-probe.mjs"
$node = $null
if ($Phase4) {
  if (-not (Test-Path -LiteralPath $navProbeScript)) { Fail 2 ("missing " + $navProbeScript) }
  # Prefer the real node.exe: a bare "node" on PATH can resolve (PATH-order
  # dependent) to a non-.exe shim (e.g. a Git-Bash-style launcher script)
  # that PowerShell refuses to run inside a pipeline ("Cannot run a document
  # in the middle of a pipeline"), which crashed this whole Phase4 run
  # before it ever reached the F5 assertion. node.exe's own Source path is
  # always directly runnable, so resolve that first and only fall back to
  # the bare name if no .exe is on PATH.
  $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -eq $nodeCmd) { $nodeCmd = Get-Command node -ErrorAction SilentlyContinue }
  if ($nodeCmd) { $node = $nodeCmd.Source }
  if ($null -eq $node) { Fail 2 "node not found on PATH; required for the R3 nav-probe assertion (tools/nav-probe.mjs)" }
}
$NavProbePort = 9231
function Read-NavProbe([int]$TimeoutMs) {
  $out = (& $node $navProbeScript $NavProbePort $TimeoutMs 2>&1 | Out-String).Trim()
  $parsed = $null
  try { $parsed = $out | ConvertFrom-Json } catch { $parsed = $null }
  return @{ raw = $out; report = $parsed }
}

if ($OutDir -eq "") { $OutDir = Join-Path $appDir "artifacts\desktop-smoke" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$earlyPng = Join-Path $OutDir ("smoke-{0}-early.png" -f $stamp)
$latePng = Join-Path $OutDir ("smoke-{0}-late.png" -f $stamp)
$jsonPath = Join-Path $OutDir ("smoke-{0}.json" -f $stamp)

# Window-state file (see header) and the real WebView2 profile, both
# snapshotted before launch.
$stateDir = Join-Path $env:APPDATA "app.guidon.trainer"
$statePath = Join-Path $stateDir ".window-state.json"
function Snapshot-State {
  if (Test-Path -LiteralPath $statePath) {
    $it = Get-Item -LiteralPath $statePath
    $raw = [IO.File]::ReadAllText($statePath)
    $parsed = $null
    try { $parsed = $raw | ConvertFrom-Json } catch { $parsed = $null }
    return @{ exists = $true; path = $statePath; mtime = $it.LastWriteTimeUtc.ToString("o"); bytes = $it.Length; content = $parsed }
  }
  return @{ exists = $false; path = $statePath; mtime = $null; bytes = 0; content = $null }
}
$realProfile = Join-Path $env:LOCALAPPDATA "app.guidon.trainer\EBWebView"
function Newest-Write([string]$dir) {
  if (-not (Test-Path -LiteralPath $dir)) { return $null }
  $files = @(Get-ChildItem -LiteralPath $dir -Recurse -File -Force -ErrorAction SilentlyContinue)
  if ($files.Count -eq 0) { return $null }
  return ($files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc.ToString("o")
}
$stateBefore = Snapshot-State
$realBefore = Newest-Write $realProfile

# Fresh WebView2 profile for this run only.
$dataDir = Join-Path $env:TEMP ("guidon-desktop-smoke\wv2-{0}-{1}" -f $stamp, $PID)
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

Write-Output ("desktop-smoke: {0}" -f $exe)
Say "INFO" ("exe {0} bytes, modified {1}, ProductVersion {2}" -f $exeItem.Length, $exeItem.LastWriteTimeUtc.ToString("o"), $exeItem.VersionInfo.ProductVersion)
Say "INFO" ("python: {0} ({1})" -f $pyVersion, $py)
Say "INFO" ("dpi awareness context set by this script: {0}" -f $dpiAwareSet)
Say "INFO" ("WEBVIEW2_USER_DATA_FOLDER = {0}" -f $dataDir)

# ---------------------------------------------------------------------------
# Launch and wait for the first visible top-level window.
# ---------------------------------------------------------------------------
function Rect-Of([IntPtr]$h) {
  $r = New-Object GuidonSmoke+RECT
  [void][GuidonSmoke]::GetWindowRect($h, [ref]$r)
  return @{ left = $r.Left; top = $r.Top; right = $r.Right; bottom = $r.Bottom; width = ($r.Right - $r.Left); height = ($r.Bottom - $r.Top); maximized = [GuidonSmoke]::IsZoomed($h); minimized = [GuidonSmoke]::IsIconic($h) }
}
function Rect-Key($r) { return ("{0},{1},{2},{3},{4}" -f $r.left, $r.top, $r.right, $r.bottom, $r.maximized) }

function Capture-Client([IntPtr]$h, [string]$path) {
  $cr = New-Object GuidonSmoke+RECT
  [void][GuidonSmoke]::GetClientRect($h, [ref]$cr)
  $w = $cr.Right - $cr.Left
  $ht = $cr.Bottom - $cr.Top
  if ($w -le 0 -or $ht -le 0) { return @{ ok = $false; reason = ("client rect {0}x{1}" -f $w, $ht) } }
  $bmp = New-Object System.Drawing.Bitmap $w, $ht, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $printed = [GuidonSmoke]::PrintWindow($h, $hdc, 3)   # PW_CLIENTONLY (1) | PW_RENDERFULLCONTENT (2)
  $g.ReleaseHdc($hdc)
  $method = "PrintWindow"
  if (-not $printed) {
    $pt = New-Object GuidonSmoke+POINT
    $pt.X = 0; $pt.Y = 0
    [void][GuidonSmoke]::ClientToScreen($h, [ref]$pt)
    $g.CopyFromScreen($pt.X, $pt.Y, 0, 0, $bmp.Size)
    $method = "CopyFromScreen"
  }
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return @{ ok = $true; method = $method; print_window_returned = $printed; width = $w; height = $ht; file = $path }
}

# ---------------------------------------------------------------------------
# Phase 4 helpers: a keystroke to whatever is foreground, and a pixel diff
# over one rectangular region of two same-size PNGs (the "no Edge find bar
# appeared" check needs the top-right corner only - a full-frame compare
# would be swamped by the rest of the page, which is not what changed).
# ---------------------------------------------------------------------------
$VK_CONTROL = 0x11
$VK_F5 = 0x74
$VK_F = 0x46
$VK_OEM_PLUS = 0xBB
$KEYEVENTF_KEYUP = 0x2
function Send-Key([int]$vk, [switch]$Ctrl) {
  if ($Ctrl) { [GuidonSmoke]::keybd_event([byte]$VK_CONTROL, 0, 0, [UIntPtr]::Zero) }
  [GuidonSmoke]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
  [GuidonSmoke]::keybd_event([byte]$vk, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
  if ($Ctrl) { [GuidonSmoke]::keybd_event([byte]$VK_CONTROL, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero) }
}
function Region-Diff([string]$pathA, [string]$pathB, [int]$x, [int]$y, [int]$w, [int]$h) {
  $ba = [System.Drawing.Bitmap]::FromFile($pathA)
  $bb = [System.Drawing.Bitmap]::FromFile($pathB)
  $maxW = [Math]::Max(0, [Math]::Min($w, [Math]::Min($ba.Width - $x, $bb.Width - $x)))
  $maxH = [Math]::Max(0, [Math]::Min($h, [Math]::Min($ba.Height - $y, $bb.Height - $y)))
  $diff = 0; $total = 0
  for ($j = 0; $j -lt $maxH; $j++) {
    for ($i = 0; $i -lt $maxW; $i++) {
      $pa = $ba.GetPixel($x + $i, $y + $j)
      $pb = $bb.GetPixel($x + $i, $y + $j)
      $total++
      if ($pa.ToArgb() -ne $pb.ToArgb()) { $diff++ }
    }
  }
  $ba.Dispose(); $bb.Dispose()
  $frac = 0.0
  if ($total -gt 0) { $frac = $diff / [double]$total }
  return @{ changed_fraction = $frac; region = @{ x = $x; y = $y; w = $maxW; h = $maxH }; a = $pathA; b = $pathB }
}

$env:WEBVIEW2_USER_DATA_FOLDER = $dataDir
# GAP B (Phase4 only): remote debugging on this SAME main-window launch, so
# Read-NavProbe can attach to it later. Baseline mode never sets this, so
# baseline runs are unchanged by its existence (matches the header's promise
# for the rest of Phase4).
if ($Phase4) { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$NavProbePort" }
$launch = [Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -PassThru
Remove-Item Env:\WEBVIEW2_USER_DATA_FOLDER
if ($Phase4) { Remove-Item Env:\WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS }
$procId = [uint32]$proc.Id

# The app window is the visible top-level window of class "Tauri Window"
# (tao's class name). The PID also owns a debug-build console
# (ConsoleWindowClass - the debug profile has no windows_subsystem), the
# single-instance plugin's message window (app.guidon.trainer-sic) and tao's
# thread event target; all three report IsWindowVisible and the console
# even paints first, so "first visible unowned window" is the WRONG probe
# (measured 2026-09-05: it picked the console at 514 ms and WM_CLOSE to it
# ended the process with STATUS_CONTROL_C_EXIT).
$AppWindowClass = "Tauri Window"
$hwnd = [IntPtr]::Zero
$firstVisibleMs = $null
$firstVisibleOthers = @()
while ($launch.ElapsedMilliseconds -lt $WindowTimeoutMs) {
  $wins = [GuidonSmoke]::Windows($procId)
  foreach ($w in $wins) {
    if ($w.Visible -and -not $w.Owned -and $w.Class -eq $AppWindowClass) { $hwnd = [IntPtr]$w.Hwnd; break }
  }
  if ($hwnd -ne [IntPtr]::Zero) {
    $firstVisibleMs = $launch.ElapsedMilliseconds
    $firstVisibleOthers = @($wins | Where-Object { $_.Visible -and $_.Class -ne $AppWindowClass } | ForEach-Object { $_.Class })
    break
  }
  if ($proc.HasExited) { break }
  Start-Sleep -Milliseconds 10
}

$summary = [ordered]@{
  tool = "desktop-smoke.ps1"
  at = (Get-Date).ToUniversalTime().ToString("o")
  exe = $exe
  exe_bytes = $exeItem.Length
  exe_mtime = $exeItem.LastWriteTimeUtc.ToString("o")
  exe_product_version = $exeItem.VersionInfo.ProductVersion
  pid = $proc.Id
  dpi_awareness_set_here = $dpiAwareSet
  window_timeout_ms = $WindowTimeoutMs
  app_window_class = $AppWindowClass
  first_visible_ms = $firstVisibleMs
  other_visible_classes_at_first_visible = @($firstVisibleOthers)
}

if ($null -eq $firstVisibleMs) {
  $summary.exited_early = $proc.HasExited
  if ($proc.HasExited) { $summary.exit_code = $proc.ExitCode }
  Say "FAIL" ("no visible top-level window within {0} ms (process exited: {1})" -f $WindowTimeoutMs, $proc.HasExited)
  if (-not $proc.HasExited) {
    Say "INFO" "posting WM_CLOSE to every top-level window of the PID"
    foreach ($w in [GuidonSmoke]::Windows($procId)) { [void][GuidonSmoke]::PostMessage([IntPtr]$w.Hwnd, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
    [void]$proc.WaitForExit($CloseWaitMs)
  }
  $json = ($summary | ConvertTo-Json -Depth 8) -replace "`r`n", "`n"
  [IO.File]::WriteAllText($jsonPath, $json + "`n", (New-Object Text.UTF8Encoding $false))
  # The throwaway profile folder is this run's own; the exit-0 path below
  # removes it too (measured 2026-09-05: the charmap RED left one behind).
  if (-not $KeepData) { Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue }
  Write-Output $json
  exit 1
}

$title = [GuidonSmoke]::Title($hwnd)
$rectFirst = Rect-Of $hwnd
$dpi = [GuidonSmoke]::GetDpiForWindow($hwnd)
Say "PASS" ("visible window in {0} ms: hwnd 0x{1:X} title {2}" -f $firstVisibleMs, $hwnd.ToInt64(), ($title -replace "[^\x20-\x7e]", "?"))
Say "INFO" ("rect at first visible: {0},{1} {2}x{3} maximized={4} dpi={5}" -f $rectFirst.left, $rectFirst.top, $rectFirst.width, $rectFirst.height, $rectFirst.maximized, $dpi)

# Captured the instant the window is judged visible, for R2's "first frame is
# not blank" assertion - the +150 ms "early" shot below is deliberately
# later and exists for a different purpose (colour-variety vs. the
# launch-to-content transition), not this one.
$firstVisPng = Join-Path $OutDir ("smoke-{0}-firstvisible.png" -f $stamp)
$firstVisShot = Capture-Client $hwnd $firstVisPng
Say "INFO" ("first-visible client shot: {0} {1}x{2} PrintWindow={3}" -f $firstVisShot.method, $firstVisShot.width, $firstVisShot.height, $firstVisShot.print_window_returned)

# ---------------------------------------------------------------------------
# Timeline from first-visible: rect changes, the two shots, the +1000 rect.
# ---------------------------------------------------------------------------
$t0 = [Diagnostics.Stopwatch]::StartNew()
$timeline = New-Object System.Collections.ArrayList
[void]$timeline.Add(@{ ms = 0; rect = $rectFirst })
$lastKey = Rect-Key $rectFirst
$early = $null; $late = $null; $rectAt = $null
$earlyAt = $null; $lateAt = $null; $rectAtMs = $null
while ($t0.ElapsedMilliseconds -le ($LateShotMs + 50)) {
  $now = $t0.ElapsedMilliseconds
  if ($null -eq $early -and $now -ge $EarlyShotMs) {
    $earlyAt = $now
    $early = Capture-Client $hwnd $earlyPng
  }
  if ($null -eq $rectAt -and $now -ge $RectMs) {
    $rectAtMs = $now
    $rectAt = Rect-Of $hwnd
  }
  if ($null -eq $late -and $now -ge $LateShotMs) {
    $lateAt = $now
    $late = Capture-Client $hwnd $latePng
    break
  }
  $r = Rect-Of $hwnd
  $k = Rect-Key $r
  if ($k -ne $lastKey) { [void]$timeline.Add(@{ ms = $now; rect = $r }); $lastKey = $k }
  Start-Sleep -Milliseconds 10
}
$launchAtLate = $launch.ElapsedMilliseconds

$jump = ($timeline.Count -gt 1)
Say "INFO" ("rect at +{0} ms: {1},{2} {3}x{4} maximized={5}" -f $rectAtMs, $rectAt.left, $rectAt.top, $rectAt.width, $rectAt.height, $rectAt.maximized)
if ($jump) {
  foreach ($e in $timeline) { Say "INFO" ("  rect change at +{0} ms: {1},{2} {3}x{4} maximized={5}" -f $e.ms, $e.rect.left, $e.rect.top, $e.rect.width, $e.rect.height, $e.rect.maximized) }
} else { Say "INFO" "window rect never changed between first-visible and the late shot" }
Say "INFO" ("early shot at +{0} ms: {1} {2}x{3} PrintWindow={4}" -f $earlyAt, $early.method, $early.width, $early.height, $early.print_window_returned)
Say "INFO" ("late shot at +{0} ms: {1} {2}x{3} PrintWindow={4}" -f $lateAt, $late.method, $late.width, $late.height, $late.print_window_returned)

# ---------------------------------------------------------------------------
# png-render-check on both shots and their difference.
# ---------------------------------------------------------------------------
function Run-Check([string[]]$argv) {
  $out = (& $py @pyArgs $checker @argv 2>&1 | Out-String).Trim()
  $code = $LASTEXITCODE
  $parsed = $null
  try { $parsed = $out | ConvertFrom-Json } catch { $parsed = $null }
  return @{ exit = $code; raw = $out; report = $parsed }
}
$chkEarly = Run-Check @($earlyPng, "--json")
$chkLate = Run-Check @($latePng, "--json")
$chkCompare = Run-Check @("--compare", $earlyPng, $latePng, "--json")
Say "INFO" ("early frame: {0}" -f $chkEarly.raw)
Say "INFO" ("late frame:  {0}" -f $chkLate.raw)
Say "INFO" ("compare:     {0}" -f $chkCompare.raw)

# ---------------------------------------------------------------------------
# Phase 4 (-Phase4 only): R2/R3/R4 assertions against the still-running main
# window. Baseline mode never enters this block, so its exit code and JSON
# shape are unchanged by this section existing.
# ---------------------------------------------------------------------------
# Named $p4Results, NOT $phase4: PowerShell variable names are
# case-insensitive, so $phase4 would silently alias the -Phase4 switch
# parameter above and clobber it (measured 2026-09-05 - that exact
# collision made -Phase4 read back as an empty, falsy dictionary and the
# whole Phase 4 section never ran).
$p4Results = [ordered]@{}
function Add-Phase4([string]$id, [bool]$pass, [string]$detail, $measured) {
  $p4Results[$id] = @{ pass = $pass; detail = $detail; measured = $measured }
  $tag = "PASS"; if (-not $pass) { $tag = "FAIL" }
  Say $tag ("Phase4 {0}: {1}" -f $id, $detail)
}
if ($Phase4) {
  Say "INFO" "Phase4: R2/R3/R4 assertions (none of R2-R8 are implemented yet - expect RED)"

  # R2: the first-visible client shot must not be a blank paint. --crop-top=0
  # because PW_CLIENTONLY/CopyFromScreen-from-ClientToScreen already exclude
  # the titlebar (Capture-Client always shoots the client rect); the flag is
  # there so a future chrome-inclusive capture path can reuse this check.
  #
  # Threshold recalibrated 2026-09-05 after R2 landed: the pre-R2 blank cream
  # frame measured dominant_fraction 0.99998 with 2 distinct colors (the RED
  # baseline). The post-R2 first-visible frame - inspected directly, not just
  # by number: see the saved PNG, GUIDON's real welcome screen, cards and
  # sidebar all present - measures 0.907-0.908 with ~870-880 distinct colors
  # on this build, because that screen's own layout is mostly empty cream
  # below the fold; 0.90 flagged it as "blank" by a hair. 0.95 sits with
  # comfortable margin above the real measurement and far below the true
  # blank one, so it still catches a genuine blank-paint regression.
  $chkFirstVis = Run-Check @($firstVisPng, "--json", "--max-dominant=0.95", "--crop-top=0")
  $fvRendered = ($null -ne $chkFirstVis.report) -and ($chkFirstVis.report.verdict -eq "rendered")
  Add-Phase4 "R2.first_frame_not_blank" $fvRendered "first-visible shot verdict == rendered, dominant_fraction < 0.95" $chkFirstVis.report

  # R2: no centred-then-maximized (or any other) rect jump between
  # first-visible and +1000 ms.
  $rectStable = ((Rect-Key $rectFirst) -eq (Rect-Key $rectAt))
  Add-Phase4 "R2.rect_stable" $rectStable ("GetWindowRect at first-visible == at +{0} ms" -f $rectAtMs) @{ first_visible = $rectFirst; at_1000ms = $rectAt }

  # R2: time-to-window budget.
  $ttwOk = ($firstVisibleMs -lt 1500)
  Add-Phase4 "R2.time_to_window_lt_1500ms" $ttwOk "first_visible_ms < 1500" $firstVisibleMs

  # R3: F5 must not reload the page once the accelerator-key handler exists.
  # SetForegroundWindow's own return is logged and recorded (not [void]'d):
  # Windows can silently refuse it (SPI_FOREGROUNDLOCKTIMEOUT) for a caller
  # that is not itself already foreground, which would make every keystroke
  # below land nowhere and every diff read as "nothing changed" - a false
  # PASS, not a real measurement of the accelerator-key behaviour.
  # GAP B: read the Rust-side nav-load counter BEFORE F5, over the same
  # remote-debugging port this launch was started with above. A real
  # signal a pixel diff cannot provide - see tools/nav-probe.mjs.
  $navBefore = Read-NavProbe 15000
  Say "INFO" ("nav-probe before F5: {0}" -f $navBefore.raw)

  $fg1 = [GuidonSmoke]::SetForegroundWindow($hwnd)
  Say "INFO" ("SetForegroundWindow before F5: {0}" -f $fg1)
  Start-Sleep -Milliseconds 50
  Send-Key $VK_F5
  Start-Sleep -Milliseconds 300
  $postF5Png = Join-Path $OutDir ("smoke-{0}-postf5.png" -f $stamp)
  [void](Capture-Client $hwnd $postF5Png)
  $chkF5 = Run-Check @("--compare", $latePng, $postF5Png, "--json", "--min-diff=0.02")
  $f5Frac = $null; if ($null -ne $chkF5.report) { $f5Frac = $chkF5.report.changed_fraction }
  $f5Ok = ($null -ne $f5Frac) -and ($f5Frac -lt 0.02)
  Add-Phase4 "R3.f5_no_reload" $f5Ok ("changed_fraction(late, +300ms after F5) < 0.02; SetForegroundWindow returned {0}" -f $fg1) $chkF5.report

  # GAP B: read it again AFTER F5. If the accelerator guard actually
  # blocked F5, WebView2 never navigates and the Rust-side counter (which
  # lives outside the page, so a real reload can't reset it) stays exactly
  # where it was; if F5 got through, a real Finished event fires and the
  # count goes up - detectable even though this app's reload is pixel-
  # identical to no reload at all (the gap the check above cannot close).
  $navAfter = Read-NavProbe 15000
  Say "INFO" ("nav-probe after F5:  {0}" -f $navAfter.raw)
  $navBeforeCount = $null; if ($null -ne $navBefore.report) { $navBeforeCount = $navBefore.report.navLoadCount }
  $navAfterCount = $null; if ($null -ne $navAfter.report) { $navAfterCount = $navAfter.report.navLoadCount }
  $navProbeOk = ($null -ne $navBeforeCount) -and ($null -ne $navAfterCount) -and ($navBeforeCount -eq $navAfterCount)
  Add-Phase4 "R3.f5_nav_probe_unchanged" $navProbeOk ("Rust-side nav_load_count unchanged across F5 (before {0}, after {1})" -f $navBeforeCount, $navAfterCount) @{ before = $navBefore.report; after = $navAfter.report }

  # R3: Ctrl+F must not open the Edge find bar (top-right 400x80 of client area).
  $fg2 = [GuidonSmoke]::SetForegroundWindow($hwnd)
  Say "INFO" ("SetForegroundWindow before Ctrl+F: {0}" -f $fg2)
  Send-Key $VK_F -Ctrl
  Start-Sleep -Milliseconds 300
  $postCtrlFPng = Join-Path $OutDir ("smoke-{0}-postctrlf.png" -f $stamp)
  [void](Capture-Client $hwnd $postCtrlFPng)
  $crNow = New-Object GuidonSmoke+RECT
  [void][GuidonSmoke]::GetClientRect($hwnd, [ref]$crNow)
  $findRegionX = [Math]::Max(0, ($crNow.Right - $crNow.Left) - 400)
  $findRegion = Region-Diff $postF5Png $postCtrlFPng $findRegionX 0 400 80
  $findOk = ($findRegion.changed_fraction -lt 0.02)
  Add-Phase4 "R3.no_find_bar" $findOk ("top-right 400x80 unchanged (fraction < 0.02) after Ctrl+F; SetForegroundWindow returned {0}" -f $fg2) $findRegion

  # R3/R4: Ctrl+= must scale the page (zoomHotkeysEnabled).
  $fg3 = [GuidonSmoke]::SetForegroundWindow($hwnd)
  Say "INFO" ("SetForegroundWindow before Ctrl+=: {0}" -f $fg3)
  Send-Key $VK_OEM_PLUS -Ctrl
  Start-Sleep -Milliseconds 300
  $postZoomPng = Join-Path $OutDir ("smoke-{0}-postzoom.png" -f $stamp)
  [void](Capture-Client $hwnd $postZoomPng)
  $chkZoom = Run-Check @("--compare", $postCtrlFPng, $postZoomPng, "--json", "--min-diff=0.05")
  $zoomFrac = $null; if ($null -ne $chkZoom.report) { $zoomFrac = $chkZoom.report.changed_fraction }
  $zoomOk = ($null -ne $zoomFrac) -and ($zoomFrac -gt 0.05)
  Add-Phase4 "R3_R4.ctrl_plus_scales_page" $zoomOk ("changed_fraction(pre-zoom, +300ms after Ctrl+=) > 0.05; SetForegroundWindow returned {0}" -f $fg3) $chkZoom.report
}

# ---------------------------------------------------------------------------
# Every top-level window of the PID.
# ---------------------------------------------------------------------------
$allWins = [GuidonSmoke]::Windows($procId)
$winList = New-Object System.Collections.ArrayList
$visibleCount = 0
foreach ($w in $allWins) {
  if ($w.Visible) { $visibleCount++ }
  [void]$winList.Add(@{ hwnd = ("0x{0:X}" -f $w.Hwnd); visible = $w.Visible; owned = $w.Owned; class = $w.Class; title = $w.Title })
}
Say "INFO" ("EnumWindows for PID {0}: {1} top-level ({2} visible)" -f $proc.Id, $allWins.Count, $visibleCount)

# ---------------------------------------------------------------------------
# WM_CLOSE, wait, last resort.
# ---------------------------------------------------------------------------
$rectAtClose = Rect-Of $hwnd
$closeSw = [Diagnostics.Stopwatch]::StartNew()
$closeAttempts = 0
$forceKilled = $false
while (-not $proc.HasExited -and $closeAttempts -lt 2) {
  $closeAttempts++
  [void][GuidonSmoke]::PostMessage($hwnd, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)   # WM_CLOSE
  [void]$proc.WaitForExit($CloseWaitMs)
}
if (-not $proc.HasExited) {
  # Documented last resort: WM_CLOSE posted twice, ignored twice.
  Say "INFO" ("process ignored WM_CLOSE twice ({0} ms each); Stop-Process as the last resort" -f $CloseWaitMs)
  Stop-Process -Id $proc.Id -Force
  [void]$proc.WaitForExit($CloseWaitMs)
  $forceKilled = $true
}
$exitMs = $closeSw.ElapsedMilliseconds
$exitCode = $null
if ($proc.HasExited) { try { $exitCode = $proc.ExitCode } catch { $exitCode = $null } }
if ($forceKilled) { Say "INFO" ("force-killed after {0} ms" -f $exitMs) }
else { Say "PASS" ("exited {0} ms after WM_CLOSE (attempt {1}, exit code {2})" -f $exitMs, $closeAttempts, $exitCode) }

# ---------------------------------------------------------------------------
# Files after exit: window-state, the fresh profile, the real profile.
# ---------------------------------------------------------------------------
$stateAfter = Snapshot-State
$stateChanged = ($stateBefore.mtime -ne $stateAfter.mtime) -or ($stateBefore.bytes -ne $stateAfter.bytes)
if ($stateAfter.exists) {
  $c = $stateAfter.content
  $main = $null
  if ($null -ne $c) { $main = $c.PSObject.Properties["main"] }
  if ($null -ne $main) {
    $m = $main.Value
    Say "INFO" ("window-state {0} (written this run: {1}): main {2}x{3} at {4},{5} maximized={6} visible={7}" -f $statePath, $stateChanged, $m.width, $m.height, $m.x, $m.y, $m.maximized, $m.visible)
  } else { Say "INFO" ("window-state {0} exists (written this run: {1}) but carries no main entry" -f $statePath, $stateChanged) }
} else { Say "INFO" ("window-state file absent: {0}" -f $statePath) }

$dataEntries = @(Get-ChildItem -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue)
$dataHonored = ($dataEntries.Count -gt 0)
$realAfter = Newest-Write $realProfile
$realTouched = ($realBefore -ne $realAfter)
Say "INFO" ("clean data dir honored: {0} ({1} entries under {2})" -f $dataHonored, $dataEntries.Count, $dataDir)
Say "INFO" ("real profile {0} newest write before {1} after {2} -> touched: {3}" -f $realProfile, $realBefore, $realAfter, $realTouched)
if (-not $KeepData) {
  # This folder was created by this run a few seconds ago and holds only the
  # throwaway WebView2 profile; -KeepData retains it for inspection.
  Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# Phase 4 (-Phase4 only): R6/R7/R8. These need the primary instance gone
# (single-instance would otherwise just hand off to it), so they run after
# its WM_CLOSE above, as their own short-lived launches.
# ---------------------------------------------------------------------------
if ($Phase4) {
  Say "INFO" "Phase4: R6/R7 assertions (--route argv is discarded by main.rs today - expect RED)"

  $r6Dir = Join-Path $env:TEMP ("guidon-desktop-smoke\wv2-{0}-{1}-r6" -f $stamp, $PID)
  New-Item -ItemType Directory -Force -Path $r6Dir | Out-Null
  $env:WEBVIEW2_USER_DATA_FOLDER = $r6Dir
  $procA = Start-Process -FilePath $exe -ArgumentList "--route=board" -WorkingDirectory (Split-Path -Parent $exe) -PassThru
  Remove-Item Env:\WEBVIEW2_USER_DATA_FOLDER

  $pidA = [uint32]$procA.Id
  $hwndA = [IntPtr]::Zero
  $titleA = $null
  $swA = [Diagnostics.Stopwatch]::StartNew()
  while ($swA.ElapsedMilliseconds -lt 3000) {
    foreach ($w in [GuidonSmoke]::Windows($pidA)) {
      if ($w.Visible -and -not $w.Owned -and $w.Class -eq $AppWindowClass) { $hwndA = [IntPtr]$w.Hwnd; $titleA = $w.Title }
    }
    if ($hwndA -ne [IntPtr]::Zero -and $titleA -like "*Board*") { break }
    if ($procA.HasExited) { break }
    Start-Sleep -Milliseconds 20
  }
  $r6aOk = ($null -ne $titleA) -and ($titleA -like "*Board*")
  Add-Phase4 "R6.first_launch_route_arg" $r6aOk "title contains 'Board' within 3000 ms of launching --route=board" $titleA

  # Second launch while the first is still up: single-instance should hand
  # off (exit almost at once) and the running window should re-route.
  $procB = Start-Process -FilePath $exe -ArgumentList "--route=progress" -WorkingDirectory (Split-Path -Parent $exe) -PassThru
  [void]$procB.WaitForExit(5000)
  Start-Sleep -Milliseconds 200
  $stillRunning = @(Get-Process -Name $exeStem -ErrorAction SilentlyContinue)
  $pidCountOk = ($stillRunning.Count -eq 1)
  Add-Phase4 "R6.second_launch_pid_count_stays_1" $pidCountOk ("processes named {0} after the second launch hands off" -f $exeStem) @($stillRunning | ForEach-Object { $_.Id })

  $titleA2 = $null
  $swB = [Diagnostics.Stopwatch]::StartNew()
  while ($swB.ElapsedMilliseconds -lt 3000) {
    if ([GuidonSmoke]::IsWindow($hwndA)) { $titleA2 = [GuidonSmoke]::Title($hwndA) }
    if ($titleA2 -like "*Progress*") { break }
    Start-Sleep -Milliseconds 20
  }
  $r6bOk = ($null -ne $titleA2) -and ($titleA2 -like "*Progress*")
  Add-Phase4 "R6_R7.running_instance_retitles_on_second_launch" $r6bOk "title flips to contain 'Progress' within 3000 ms of the second launch" $titleA2

  # Always clean up procA, even when hwndA was never found within the 3000 ms
  # detection window above (a slow/cold WebView2 profile can still finish
  # creating and retitling the window after that window closes - measured
  # directly: a leftover guidon.exe with MainWindowTitle "GUIDON - Progress"
  # survived a run where hwndA stayed Zero). Re-resolve the window by PID
  # right before closing so a late-appearing window still gets a clean
  # WM_CLOSE instead of Stop-Process; fall back to Stop-Process by PID
  # either way so this launch can never outlive the script.
  if (-not $procA.HasExited) {
    $hwndLate = [IntPtr]::Zero
    foreach ($w in [GuidonSmoke]::Windows($pidA)) {
      if ($w.Visible -and -not $w.Owned -and $w.Class -eq $AppWindowClass) { $hwndLate = [IntPtr]$w.Hwnd }
    }
    if ($hwndLate -eq [IntPtr]::Zero) { $hwndLate = $hwndA }
    if ($hwndLate -ne [IntPtr]::Zero) {
      [void][GuidonSmoke]::PostMessage($hwndLate, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)
      [void][GuidonSmoke]::PostMessage($hwndLate, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)
      [void]$procA.WaitForExit($CloseWaitMs)
    }
    if (-not $procA.HasExited) { Stop-Process -Id $procA.Id -Force -ErrorAction SilentlyContinue }
  }
  if (-not $KeepData) { Remove-Item -LiteralPath $r6Dir -Recurse -Force -ErrorAction SilentlyContinue }

  # R8: GUIDON_SELFTEST_THEME=night-vision (src-tauri/src/selftest.rs
  # Config::theme) seeds guidon:appearance:v1 in this run's fresh WebView2
  # profile before the page's own pre-paint script (src/index.html) ever
  # reads it, so the page boots directly into the dark "Night Vision" theme.
  # S6's native.js Tauri branch then invokes set_native_theme(dark:true,...)
  # on that theme, which calls Window::set_theme(Dark) - window.theme() in
  # the selftest report is the ONE independent way to observe that actually
  # happened (there is no getter for the WebView2 background colour it also
  # sets). This is a real assertion, not "whatever the OS theme already is":
  # the OS/WebView2 default is untouched by this - the app's OWN theme drives it.
  Say "INFO" "Phase4: R8 assertion (GUIDON_SELFTEST_THEME=night-vision -> set_native_theme -> native window.theme() == dark)"
  $r8Dir = Join-Path $env:TEMP ("guidon-desktop-smoke\wv2-{0}-{1}-r8" -f $stamp, $PID)
  New-Item -ItemType Directory -Force -Path $r8Dir | Out-Null
  $r8Json = Join-Path $OutDir ("smoke-{0}-r8-selftest.json" -f $stamp)
  $env:WEBVIEW2_USER_DATA_FOLDER = $r8Dir
  $env:GUIDON_SELFTEST_OUT = $r8Json
  $env:GUIDON_SELFTEST_THEME = "night-vision"
  $procC = Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -PassThru
  Remove-Item Env:\WEBVIEW2_USER_DATA_FOLDER
  Remove-Item Env:\GUIDON_SELFTEST_OUT
  Remove-Item Env:\GUIDON_SELFTEST_THEME
  [void]$procC.WaitForExit(20000)
  if (-not $procC.HasExited) { Stop-Process -Id $procC.Id -Force -ErrorAction SilentlyContinue }
  $r8Report = $null
  if (Test-Path -LiteralPath $r8Json) {
    try { $r8Report = (Get-Content -LiteralPath $r8Json -Raw) | ConvertFrom-Json } catch { $r8Report = $null }
  }
  $r8Theme = $null
  if ($null -ne $r8Report) { $r8Theme = $r8Report.theme }
  $r8Ok = ($r8Theme -eq "dark")
  Add-Phase4 "R8.night_vision_forces_dark_native_theme" $r8Ok "selftest JSON theme field == dark after booting into the night-vision theme (GUIDON_SELFTEST_THEME seeding -> set_native_theme -> Window::set_theme)" $r8Report

  # GAP C: a SEPARATE assertion on nativeThemeBackgroundApplied - set at the
  # EXACT call site of Window::set_background_color in desktop.rs, never
  # inferred from nativeTheme.ground - so a regression that drops that one
  # call (while set_theme keeps succeeding, which is what the theme check
  # above alone would still pass) is caught here instead of shipping silent.
  # Set-StrictMode -Version 2 throws on a PSCustomObject property that does
  # not exist (unlike normal PowerShell, which would just return $null) -
  # and this key IS conditionally absent (that is the GAP C signal itself:
  # a dropped set_background_color call leaves it out entirely), so this
  # must go through PSObject.Properties rather than plain dot access.
  $r8Background = $null
  if ($null -ne $r8Report) {
    $prop = $r8Report.PSObject.Properties["nativeThemeBackgroundApplied"]
    if ($null -ne $prop) { $r8Background = $prop.Value }
  }
  $r8BackgroundOk = ($null -ne $r8Background) -and ($r8Background -ne "")
  Add-Phase4 "R8.background_color_applied" $r8BackgroundOk "selftest JSON nativeThemeBackgroundApplied is set (non-empty) after boot - proves Window::set_background_color actually ran, independent of the theme check above" $r8Report
  if (-not $KeepData) { Remove-Item -LiteralPath $r8Dir -Recurse -Force -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------------------
# Summary.
# ---------------------------------------------------------------------------
$summary.hwnd = ("0x{0:X}" -f $hwnd.ToInt64())
$summary.title = $title
$summary.dpi = $dpi
$summary.rect_first_visible = $rectFirst
$summary.rect_at_ms = $rectAtMs
$summary.rect_at = $rectAt
$summary.rect_at_close = $rectAtClose
$summary.rect_timeline = @($timeline)
$summary.centred_then_maximized_jump = $jump
$summary.early_shot = $early
$summary.early_shot_at_ms = $earlyAt
$summary.late_shot = $late
$summary.late_shot_at_ms = $lateAt
$summary.late_shot_since_launch_ms = $launchAtLate
$summary.render_check = @{ early = $chkEarly; late = $chkLate; compare = $chkCompare }
$summary.enum_windows = @{ count = $allWins.Count; visible = $visibleCount; windows = @($winList) }
$summary.close = @{ wm_close_attempts = $closeAttempts; exit_ms = $exitMs; force_killed = $forceKilled; exit_code = $exitCode }
$summary.window_state = @{ path = $statePath; before = $stateBefore; after = $stateAfter; written_this_run = $stateChanged }
$summary.clean_data_dir = @{ path = $dataDir; honored = $dataHonored; entries = $dataEntries.Count; kept = [bool]$KeepData }
$summary.real_profile = @{ path = $realProfile; newest_write_before = $realBefore; newest_write_after = $realAfter; touched = $realTouched }
$summary.artifacts = @{ json = $jsonPath; early = $earlyPng; late = $latePng; first_visible = $firstVisPng }
$summary.phase4_mode = [bool]$Phase4
$summary.phase4 = $p4Results

$phase4AllPass = $true
if ($Phase4) {
  foreach ($k in $p4Results.Keys) { if (-not $p4Results[$k].pass) { $phase4AllPass = $false } }
}
$summary.exit_code = 0
if ($Phase4 -and -not $phase4AllPass) { $summary.exit_code = 1 }

$json = ($summary | ConvertTo-Json -Depth 8) -replace "`r`n", "`n"
[IO.File]::WriteAllText($jsonPath, $json + "`n", (New-Object Text.UTF8Encoding $false))
if ($Phase4 -and -not $phase4AllPass) { Say "FAIL" ("Phase4 RED recorded: {0}" -f $jsonPath) }
else { Say "PASS" ("baseline recorded: {0}" -f $jsonPath) }
Write-Output "SUMMARY"
Write-Output $json
exit $summary.exit_code
