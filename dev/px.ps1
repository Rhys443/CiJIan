# ============================================================
#  逐像素扫描 —— 把一行/一列的 RGB 直接打出来
#
#  查「边上有一条线」这类问题，靠肉眼看截图是不够的：
#  一条 8-10px 的带子在缩放图里只剩两三个像素，
#  说不出它的准确宽度、准确颜色，更说不出它从哪一行开始。
#  这里把指定行/列的每个像素打成 16 进制，边界一眼可数。
#
#  用法：
#    powershell -File dev/px.ps1 <src.png> row <y> <x0> <x1> [step]
#    powershell -File dev/px.ps1 <src.png> col <x> <y0> <y1> [step]
# ============================================================
param(
  [Parameter(Mandatory=$true)][string]$Src,
  [Parameter(Mandatory=$true)][ValidateSet('row','col')][string]$Axis,
  [Parameter(Mandatory=$true)][int]$At,
  [Parameter(Mandatory=$true)][int]$From,
  [Parameter(Mandatory=$true)][int]$To,
  [int]$Step = 1
)

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Src).Path)
try {
  $from = [Math]::Max(0, $From)
  $to   = [Math]::Min($(if ($Axis -eq 'row') { $img.Width } else { $img.Height }) - 1, $To)
  $fixed = [Math]::Max(0, [Math]::Min($(if ($Axis -eq 'row') { $img.Height } else { $img.Width }) - 1, $At))

  $prev = $null
  $runStart = $from
  for ($i = $from; $i -le $to; $i += $Step) {
    $c = if ($Axis -eq 'row') { $img.GetPixel($i, $fixed) } else { $img.GetPixel($fixed, $i) }
    $hex = '#{0:x2}{1:x2}{2:x2}' -f $c.R, $c.G, $c.B
    if ($null -eq $prev) { $prev = $hex; $runStart = $i }
    elseif ($hex -ne $prev) {
      Write-Output ("{0,5}..{1,-5} {2}   (len {3})" -f $runStart, ($i - 1), $prev, ($i - $runStart))
      $prev = $hex; $runStart = $i
    }
  }
  Write-Output ("{0,5}..{1,-5} {2}   (len {3})" -f $runStart, $to, $prev, ($to - $runStart + 1))
} finally {
  $img.Dispose()
}
