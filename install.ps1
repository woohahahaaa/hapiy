# hapiy installer for Windows. Run in PowerShell:
#
#   irm https://raw.githubusercontent.com/woohahahaaa/hapiy/main/install.ps1 | iex
#
# 安装脚本做四件事：下载最新发行版、校验 SHA256、装到固定目录并加入用户
# PATH、注册登录自启（任务计划程序）。重复执行即为升级。
#
# 环境变量：
#   $env:HAPIY_HOME            安装根目录（默认 %LOCALAPPDATA%\hapiy）
#   $env:HAPIY_NO_SERVICE=1    跳过自启任务注册
$ErrorActionPreference = "Stop"

$Base = "https://github.com/woohahahaaa/hapiy/releases/latest/download"
$Asset = "hapiy-windows-amd64.zip"
$Root = if ($env:HAPIY_HOME) { $env:HAPIY_HOME } else { Join-Path $env:LOCALAPPDATA "hapiy" }
$AppDir = Join-Path $Root "app"
$Exe = Join-Path $AppDir "hapiy.exe"
# The installed backend is the prod stack, which serves on 18009 (dev uses 8080).
if (-not $env:HAPIY_PORT) { $env:HAPIY_PORT = "18009" }

function Say([string]$Message) { Write-Host "[hapiy] $Message" }

$Work = Join-Path $env:TEMP ("hapiy-install-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Path $Work -Force | Out-Null
try {
    Say "downloading $Asset ..."
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Asset" -OutFile (Join-Path $Work $Asset)
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/SHA256SUMS" -OutFile (Join-Path $Work "SHA256SUMS")

    Say "verifying checksum ..."
    $Line = Select-String -Path (Join-Path $Work "SHA256SUMS") -Pattern ("\s+" + [regex]::Escape($Asset) + "$") | Select-Object -First 1
    if (-not $Line) { throw "$Asset is not listed in SHA256SUMS" }
    $Expected = ($Line.Line.Trim() -split '\s+')[0].ToLower()
    $Actual = (Get-FileHash (Join-Path $Work $Asset) -Algorithm SHA256).Hash.ToLower()
    if ($Actual -ne $Expected) { throw "checksum mismatch (got $Actual)" }

    Say "installing to $AppDir ..."
    # 升级时先把旧版停掉：运行中的 hapiy.exe 文件被锁，覆盖会失败。
    if (Test-Path $Exe) {
        try { & $Exe service stop --quiet 2>$null | Out-Null } catch { }
    }
    Expand-Archive -Path (Join-Path $Work $Asset) -DestinationPath $Work -Force
    New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
    Copy-Item (Join-Path $Work "hapiy.exe") $Exe -Force
    $WebSrc = Join-Path $Work "webdist"
    if (Test-Path $WebSrc) {
        $WebDst = Join-Path $AppDir "webdist"
        Remove-Item $WebDst -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Item $WebSrc $WebDst -Recurse -Force
    }

    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($UserPath -notlike "*$AppDir*") {
        [Environment]::SetEnvironmentVariable("Path", ($AppDir + ";" + $UserPath), "User")
        Say "added $AppDir to the user PATH (takes effect in new terminals)"
    }

    if ($env:HAPIY_NO_SERVICE -ne "1") {
        Say "registering autostart task ..."
        $InstallCode = 0
        try {
            & $Exe service install
            $InstallCode = $LASTEXITCODE
        } catch {
            if ($LASTEXITCODE) { $InstallCode = $LASTEXITCODE } else { $InstallCode = 1 }
        }
        # 以任务计划里真实存在为准，而不是只看 service install 的返回值。
        $Task = Get-ScheduledTask -TaskName "hapiy" -ErrorAction SilentlyContinue
        if (-not $Task) {
            throw "autostart task 'hapiy' was NOT registered (service install exit $InstallCode)"
        }
        if ($Task.State -eq "Running") {
            Say "autostart ready - backend starts automatically after logon"
        } else {
            Say "autostart registered - task is in place, starts at next logon"
            Say "start it now with: $Exe service start"
        }
    }

    Say ("done: hapiy " + (& $Exe version))
    $Port = "18009"
    $PortFile = Join-Path $Root "port"
    if (Test-Path $PortFile) { $Port = (Get-Content $PortFile -Raw).Trim() }
    Say "web console: http://127.0.0.1:$Port"
} finally {
    Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
}
