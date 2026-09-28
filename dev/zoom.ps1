# ============================================================
#  放大裁切 —— 查边缘类问题的放大镜
#
#  截图为 1560x1020 这种尺寸，缩放看整体没问题，但 8-10px 宽的
#  边缘残留缩完只剩两三个像素，肉眼根本分不出是"线"还是"抗锯齿"。
#  这个工具把指定矩形裁出来、按整数倍最近邻放大，pixel 就是 pixel。
#
#  用法：
#    powershell -File dev/zoom.ps1 <src.png> <out.png> <x> <y> <w> <h> [scale]
# ============================================================
param(
  [Parameter(Mandatory=$true)][string]$Src,
  [Parameter(Mandatory=$true)][string]$Out,
  [Parameter(Mandatory=$true)][int]$X,
  [Parameter(Mandatory=$true)][int]$Y,
  [Parameter(Mandatory=$true)][int]$W,
  [Parameter(Mandatory=$true)][int]$H,
  [int]$Scale = 4
)

Add-Type -AssemblyName System.Drawing

$img = [System.Drawing.Image]::FromFile((Resolve-Path $Src).Path)
try {
  $x0 = [Math]::Max(0, $X)
  $y0 = [Math]::Max(0, $Y)
  $w  = [Math]::Min($W, $img.Width - $x0)
  $h  = [Math]::Min($H, $img.Height - $y0)
  $dw = $w * $Scale
  $dh = $h * $Scale

  $bmp = New-Object System.Drawing.Bitmap($dw, $dh)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $dw, $dh)),
               (New-Object System.Drawing.Rectangle($x0, $y0, $w, $h)),
               [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "ZOOM $Out  ${w}x${h} -> ${dw}x${dh}  (crop at $x0,$y0)"
} finally {
  $img.Dispose()
}
