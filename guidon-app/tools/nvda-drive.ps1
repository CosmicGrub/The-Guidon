# Drives the GUIDON desktop app by keyboard and captures what NVDA actually
# announces, by reading NVDA's own debug log rather than listening to audio.
#
# NVDA is configured with the "silence" synthesizer, so nothing is spoken aloud,
# but every speech sequence is still written to %TEMP%\nvda.log as
#   Speaking [LangChangeCommand ('en'), 'the text', ...]
# which is exactly what a user would hear, in order.
#
# Usage:  powershell -File nvda-drive.ps1 -Steps "TAB:5" -Label "flow name"

param(
  [string]$Keys = "",          # semicolon-separated: TAB, ENTER, SPACE, DOWN, F6, "text"
  [string]$Label = "step",
  [int]$SettleMs = 900,
  [string]$ProcessName = "guidon"   # installed build's exe stem; portable builds are named
                                     # GUIDON-<version>-portable, pass that instead
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
Add-Type -AssemblyName System.Windows.Forms

$LOG = "$env:TEMP\nvda.log"

function Get-LogLineCount { if (Test-Path $LOG) { (Get-Content $LOG -Encoding UTF8 -ErrorAction SilentlyContinue).Count } else { 0 } }

function Get-SpeechSince([int]$from) {
  if (-not (Test-Path $LOG)) { return @() }
  # NVDA writes the log as UTF-8; reading it as ANSI turned every em dash
  # into "a EUR ..." mojibake in the captured transcript.
  $all = Get-Content $LOG -Encoding UTF8 -ErrorAction SilentlyContinue
  if ($all.Count -le $from) { return @() }
  $new = $all[$from..($all.Count - 1)]
  $out = @()
  foreach ($line in $new) {
    if ($line -match "^Speaking \[") {
      # Pull the quoted strings out of the speech sequence, dropping the
      # LangChangeCommand and other non-text commands.
      $texts = [regex]::Matches($line, "'((?:[^'\\]|\\.)*)'") | ForEach-Object { $_.Groups[1].Value }
      $texts = $texts | Where-Object { $_ -and $_ -ne 'en' -and $_.Length -gt 0 }
      if ($texts) { $out += ($texts -join " | ") }
    }
  }
  return $out
}

function Focus-Guidon {
  $p = Get-Process $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $p) { Write-Output "!! GUIDON not running"; return $false }
  # A background/non-interactive process (this script, launched by automation
  # rather than a live foreground shell) cannot normally steal focus at all -
  # Windows silently no-ops SetForegroundWindow for it. Tapping ALT first
  # gives this process the "recent input" state SetForegroundWindow requires
  # to succeed; without it every call below returns true but does nothing.
  [W]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)   # ALT down
  [W]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)   # ALT up
  [W]::ShowWindow($p.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
  [W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 700
  $fg = [W]::GetForegroundWindow()
  return ($fg -eq $p.MainWindowHandle)
}

if (-not (Focus-Guidon)) { Write-Output "!! could not focus GUIDON window"; exit 2 }

$before = Get-LogLineCount
foreach ($k in ($Keys -split ";" | Where-Object { $_ -ne "" })) {
  $k = $k.Trim()
  $send = switch -Regex ($k) {
    '^TAB$'    { "{TAB}" }
    '^STAB$'   { "+{TAB}" }
    '^ENTER$'  { "{ENTER}" }
    '^SPACE$'  { " " }
    '^DOWN$'   { "{DOWN}" }
    '^UP$'     { "{UP}" }
    '^RIGHT$'  { "{RIGHT}" }
    '^LEFT$'   { "{LEFT}" }
    '^ESC$'    { "{ESC}" }
    '^HOME$'   { "^{HOME}" }
    default    { $k }
  }
  [System.Windows.Forms.SendKeys]::SendWait($send)
  Start-Sleep -Milliseconds $SettleMs
}
Start-Sleep -Milliseconds 600

$speech = Get-SpeechSince $before
# Console encoding mangles the icon glyphs that are part of these accessible
# names, so the transcript is also written UTF-8 to disk and read from there.
$outFile = Join-Path $PSScriptRoot '../dist/nvda-transcript.txt'
$lines = @("===== $Label =====")
if ($speech.Count -eq 0) { $lines += "  (nothing announced)" }
else { $i = 0; foreach ($s in $speech) { $i++; $lines += ("  {0,2}. {1}" -f $i, $s) } }
$lines += ""
Add-Content -Path $outFile -Value $lines -Encoding UTF8
$lines | ForEach-Object { Write-Output $_ }
