# ============================================================
#  修复 electron-builder 打包时的一个已知问题
#
#  现象：
#    「Cannot create symbolic link : 客户端没有所需的特权
#      ...\winCodeSign\...\darwin\10.12\lib\libcrypto.dylib」
#    打包在 winCodeSign 解压阶段失败（exit status 2）。
#
#  原因：
#    winCodeSign 压缩包里含有两个 macOS 用的软链接（.dylib）。
#    Windows 上创建符号链接需要「创建符号链接」特权（管理员或开发者模式），
#    普通权限下 7-Zip 解压会报错。而这两个文件在 Windows 打包里完全用不到。
#
#  解决：
#    预先用 `-snl-`（不还原符号链接）把 winCodeSign 解压到缓存里的正确位置，
#    electron-builder 随后会直接复用缓存，不再自己解压。
#
#  用法：powershell -ExecutionPolicy Bypass -File dev\fix-builder-cache.ps1
# ============================================================

$ErrorActionPreference = 'Stop'

$root     = Split-Path -Parent $PSScriptRoot
$cache    = Join-Path $root '.cache\electron-builder\winCodeSign'
$sevenZip = Join-Path $root 'node_modules\7zip-bin\win\x64\7za.exe'
$target   = Join-Path $cache 'winCodeSign-2.6.0'

if (-not (Test-Path $sevenZip)) {
    throw "找不到 7za.exe，请先执行 npm install：$sevenZip"
}

if (Test-Path (Join-Path $target 'windows-10\x64\signtool.exe')) {
    Write-Host 'winCodeSign 缓存已经是好的，无需修复。' -ForegroundColor Green
    exit 0
}

New-Item -ItemType Directory -Force -Path $cache | Out-Null

# 找到已下载的 7z（没有就用 7za 的等价物先下载：这里直接报错让用户先跑一次 npm run dist）
$archive = Get-ChildItem -Path $cache -Filter '*.7z' -ErrorAction SilentlyContinue |
           Sort-Object Length -Descending | Select-Object -First 1

if (-not $archive) {
    throw "缓存里还没有 winCodeSign 压缩包。请先执行一次 npm run dist，它会失败但会把包下载下来，然后重跑本脚本。"
}

Write-Host "清理半成品解压目录…"
Get-ChildItem -Path $cache -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d+$' } |
    Remove-Item -Recurse -Force

Write-Host "解压 $($archive.Name)（跳过 macOS 符号链接）…"
Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $target | Out-Null
& $sevenZip x -snl- -bd -y $archive.FullName "-o$target" | Out-Null

if (-not (Test-Path (Join-Path $target 'windows-10\x64\signtool.exe'))) {
    throw '解压结果不完整，缺少 signtool.exe'
}

# 显式写一份缓存索引，让 electron-builder 认这个目录
$versionFile = Join-Path $target '.electron-builder-cache-hit'
Set-Content -Path $versionFile -Value 'winCodeSign-2.6.0' -NoNewline

Write-Host ''
Write-Host '修复完成，现在可以重新执行 npm run dist。' -ForegroundColor Green
Write-Host "  缓存目录  $target"
