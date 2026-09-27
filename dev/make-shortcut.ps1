# ============================================================
#  在桌面创建「此间」快捷方式
#  用法：powershell -ExecutionPolicy Bypass -File dev\make-shortcut.ps1
#        （或 npm run shortcut）
#
#  优先指向打包好的 Cijian-*-portable.exe；
#  若还没打包，则指向本目录下的启动脚本/Electron，开发期也能一键打开。
#  注意：本文件必须带 UTF-8 BOM 保存，否则 Windows PowerShell 5.1 会把中文读成乱码。
# ============================================================

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root       = Split-Path -Parent $PSScriptRoot          # D:\Cijian
$icon       = Join-Path $root 'build\icon.ico'
$desktop    = [Environment]::GetFolderPath('Desktop')
$linkPath   = Join-Path $desktop '此间.lnk'
$description = '此间 · 15天唤醒计划 —— 每天一张拍立得打卡'

# ---------- 1. 决定快捷方式指向什么 ----------
$portable = Get-ChildItem -Path (Join-Path $root 'dist') -Filter '*.exe' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($portable) {
    $target       = $portable.FullName
    $arguments    = ''
    $workingDir   = $portable.DirectoryName
    $mode         = "打包版 ($($portable.Name))"
} else {
    $launcher = Join-Path $root '此间.cmd'
    if (Test-Path $launcher) {
        $target     = $launcher
        $arguments  = ''
        $workingDir = $root
        $mode       = '启动脚本（尚未打包）'
    } else {
        $electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
        if (-not (Test-Path $electron)) {
            throw "找不到可执行文件：既没有 dist\*.exe，也没有 $electron"
        }
        $target     = $electron
        $arguments  = '.'          # 配合工作目录，等价于 electron .
        $workingDir = $root
        $mode       = 'Electron 开发版'
    }
}

# ---------- 2. 创建快捷方式 ----------
$shell = New-Object -ComObject WScript.Shell
$link  = $shell.CreateShortcut($linkPath)
$link.TargetPath       = $target
$link.Arguments        = $arguments
$link.WorkingDirectory = $workingDir
$link.Description      = $description
$link.WindowStyle      = 1
$link.IconLocation = "$target,0"
$link.Save()

# ---------- 3. 验证 ----------
if (Test-Path $linkPath) {
    $check = $shell.CreateShortcut($linkPath)
    Write-Host ''
    Write-Host '已创建桌面快捷方式' -ForegroundColor Green
    Write-Host "  位置    $linkPath"
    Write-Host "  指向    $($check.TargetPath) $($check.Arguments)"
    Write-Host "  起始于  $($check.WorkingDirectory)"
    Write-Host "  图标    $($check.IconLocation)"
    Write-Host "  类型    $mode"
    Write-Host ''
} else {
    throw '快捷方式创建失败'
}
