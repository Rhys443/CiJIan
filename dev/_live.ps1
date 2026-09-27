# Verify the real on-screen window actually renders content.
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 as ANSI
# unless it has a BOM, which mangles non-ASCII literals (a real bug we hit).

Add-Type -AssemblyName System.Drawing

$exe = "D:\Cijian\node_modules\electron\dist\electron.exe"
$proc = Start-Process -FilePath $exe -ArgumentList "." -WorkingDirectory "D:\Cijian" -PassThru
Write-Host "launched, waiting for window..."
Start-Sleep -Seconds 10

$sig = @'
using System;
using System.Runtime.InteropServices;
public class WinApi {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
'@
Add-Type -TypeDefinition $sig

# Use the process MainWindowHandle: no need to match a (non-ASCII) window title.
$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 20; $i++) {
    $p = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { $hwnd = $p.MainWindowHandle; break }
    Start-Sleep -Milliseconds 500
}

if ($hwnd -eq [IntPtr]::Zero) {
    Write-Host "ERROR: no window handle found"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

[WinApi]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Seconds 2

$rect = New-Object WinApi+RECT
[WinApi]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.R - $rect.L
$h = $rect.B - $rect.T
Write-Host "window rect: $($rect.L),$($rect.T) size ${w}x${h}"

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.L, $rect.T, 0, 0, $bmp.Size)
$g.Dispose()

$out = "D:\Cijian\.shots\live-window.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

# Colour count tells us whether real content was painted.
$set = New-Object 'System.Collections.Generic.HashSet[string]'
$minL = 255
$maxL = 0
for ($y = 0; $y -lt $h; $y += 4) {
    for ($x = 0; $x -lt $w; $x += 4) {
        $c = $bmp.GetPixel($x, $y)
        [void]$set.Add("$([int]($c.R/24)),$([int]($c.G/24)),$([int]($c.B/24))")
        $l = [int](($c.R + $c.G + $c.B) / 3)
        if ($l -lt $minL) { $minL = $l }
        if ($l -gt $maxL) { $maxL = $l }
    }
}
$bmp.Dispose()

Write-Host "distinct colours (bucketed): $($set.Count)"
Write-Host "luminance range: $minL - $maxL"
Write-Host "saved: $out"

Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -like 'Cijian*' -or $_.ProcessName -like '*??*' } |
    Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "closed"
