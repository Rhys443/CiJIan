# ============================================================
#  Repair UTF-8 text that was mangled by a GBK round-trip.
#
#  What happened: Get-Content -Raw decoded the file as GBK(cp936)
#  instead of UTF-8, and Set-Content wrote it back as UTF-8 --
#  so every CJK character became mojibake.
#
#  The repair is exact, not a guess:
#    text --UTF8 bytes--> --GBK decode--> string --GBK encode-->
#         original UTF8 bytes --UTF8 decode--> original text
#
#  Kept ASCII-only on purpose: this file may be executed by Windows
#  PowerShell 5.1, which reads .ps1 as ANSI and would garble any CJK
#  literal in here (that is the very bug this script fixes).
#
#  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File dev/fix-utf8-mojibake.ps1 -Path <file>
# ============================================================
param([Parameter(Mandatory=$true)][string]$Path)

$full  = (Resolve-Path $Path).Path
$utf8  = New-Object System.Text.UTF8Encoding($false)
$gbk   = [System.Text.Encoding]::GetEncoding(936)

$text  = $utf8.GetString([System.IO.File]::ReadAllBytes($full))
$fixed = $utf8.GetString($gbk.GetBytes($text))

$qBefore = ([regex]::Matches($text,  '\?')).Count
$qAfter  = ([regex]::Matches($fixed, '\?')).Count
if ($qAfter -gt $qBefore + 2) {
  Write-Output ("WARN: question marks grew " + $qBefore + " -> " + $qAfter + " (some chars may be lost)")
}

[System.IO.File]::WriteAllText($full, $fixed, $utf8)

# Self-check by code points (no CJK literals in this file):
#   U+6B64 U+95F4 = "ci jian" (the app name), must be present
#   U+6D93       = the signature mojibake char, must be gone
$check  = $utf8.GetString([System.IO.File]::ReadAllBytes($full))
$nameOk = $check.Contains([string][char]0x6B64 + [string][char]0x95F4)
$badLeft = $check.Contains([string][char]0x6D93)
Write-Output ("repaired: name=" + $nameOk + " mojibakeLeft=" + $badLeft + " bytes=" + $check.Length)
