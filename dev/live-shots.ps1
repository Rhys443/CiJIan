# Reliable live screenshots, DPI-correct.
#
# Two traps this script works around:
#  1. BrowserWindow width/height are DIP, but x/y are PHYSICAL pixels on Windows.
#     Mixing them makes the window larger than the screen and the grab lands on
#     the wrong region (looks like "only the top-left corner was captured").
#  2. capturePage() returns a stale frame for hidden windows, so it cannot be used
#     to verify rendering. CopyFromScreen after showing the window can.
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI without a BOM.

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing.Primitives -ErrorAction SilentlyContinue

$exe   = "D:\Cijian\node_modules\electron\dist\electron.exe"
$root  = "D:\Cijian"
$shots = Join-Path $root ".shots"

# Display is 150% scaled: physical 2560x1600, DIP 1707x1067.
$scale = 1.5
$winDipW = 1420
$winDipH = 900
# Place it 30 DIP from the top-left; x/y are physical pixels -> multiply by scale.
$posX = [int](30 * $scale)
$posY = [int](30 * $scale)

$sig = @'
using System;
using System.Runtime.InteropServices;
public class WA {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
'@
Add-Type -TypeDefinition $sig

$env:CJ_WIN_W = "$winDipW"
$env:CJ_WIN_H = "$winDipH"
$env:CJ_WIN_X = "$posX"
$env:CJ_WIN_Y = "$posY"

function Get-AppWindow {
    param([int]$ProcessId)
    for ($i = 0; $i -lt 40; $i++) {
        $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { return $p.MainWindowHandle }
        Start-Sleep -Milliseconds 400
    }
    return [IntPtr]::Zero
}

function Save-Shot {
    param([IntPtr]$Hwnd, [string]$Name)
    $rect = New-Object WA+RECT
    [void][WA]::GetWindowRect($Hwnd, [ref]$rect)
    $w = $rect.R - $rect.L
    $h = $rect.B - $rect.T
    if ($w -le 0 -or $h -le 0) { Write-Host "  skip $Name (bad rect)"; return }
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($rect.L, $rect.T, 0, 0, $bmp.Size)
    $g.Dispose()

    $set = New-Object 'System.Collections.Generic.HashSet[string]'
    $minL = 255; $maxL = 0
    for ($y = 0; $y -lt $h; $y += 5) {
        for ($x = 0; $x -lt $w; $x += 5) {
            $c = $bmp.GetPixel($x, $y)
            [void]$set.Add("$([int]($c.R/24)),$([int]($c.G/24)),$([int]($c.B/24))")
            $l = [int](($c.R + $c.G + $c.B) / 3)
            if ($l -lt $minL) { $minL = $l }
            if ($l -gt $maxL) { $maxL = $l }
        }
    }
    $out = Join-Path $shots $Name
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host ("  {0,-26} {1,5}x{2,-5} colours={3,5} lum={4}-{5}" -f $Name, $w, $h, $set.Count, $minL, $maxL)
}

$proc = Start-Process -FilePath $exe -ArgumentList "." -WorkingDirectory $root -PassThru
Write-Host "launched pid=$($proc.Id)"
$hwnd = Get-AppWindow -ProcessId $proc.Id
if ($hwnd -eq [IntPtr]::Zero) {
    Write-Host "ERROR: window not found"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    exit 1
}
[void][WA]::SetForegroundWindow($hwnd)
Start-Sleep -Seconds 7

# 1=home 2=draw 3=checkin 4=review 5=settings
$views = @(
    @{ key = "1"; name = "live-home.png";     wait = 4 },
    @{ key = "2"; name = "live-draw.png";     wait = 4 },
    @{ key = "3"; name = "live-checkin.png";  wait = 8 },
    @{ key = "4"; name = "live-review.png";   wait = 7 },
    @{ key = "5"; name = "live-settings.png"; wait = 4 }
)
foreach ($v in $views) {
    [void][WA]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 500
    [System.Windows.Forms.SendKeys]::SendWait($v.key)
    Start-Sleep -Seconds $v.wait
    Save-Shot -Hwnd $hwnd -Name $v.name
}

Write-Host "done"
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -like 'Cijian*' } |
    Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "closed"
