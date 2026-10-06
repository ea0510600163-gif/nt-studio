<#
  مُشغّل NT Studio — يشغّل **آخر نسخة** دائمًا.

  الخطوات:
    1) إغلاق أي نسخة قديمة
    2) تثبيت الاعتماديات إن لم تكن موجودة
    3) إعادة البناء تلقائيًا إذا كان المصدر أحدث من آخر بناء
    4) التشغيل

  يُستدعى من: D:\NT\تشغيل NT Studio.cmd
#>

$ErrorActionPreference = 'Stop'
$App = 'D:\NT\Studio'

function Write-Step([int]$n, [string]$text, [string]$color = 'Gray') {
  Write-Host "  [$n/4] $text" -ForegroundColor $color
}

Write-Host ''
Write-Host '  ============================================' -ForegroundColor DarkCyan
Write-Host '     NT Studio  -  التشغيل' -ForegroundColor Cyan
Write-Host '  ============================================' -ForegroundColor DarkCyan
Write-Host ''

if (-not (Test-Path (Join-Path $App 'package.json'))) {
  Write-Host "  [X] لم أجد المشروع في: $App" -ForegroundColor Red
  exit 1
}

Set-Location $App

# ---------------------------------------------------------------------------
# 1) إغلاق نسخة سابقة
# ---------------------------------------------------------------------------
$running = Get-Process -Name 'NT Studio' -ErrorAction SilentlyContinue
if ($running) {
  Write-Step 1 'إغلاق نسخة سابقة...' 'Yellow'
  $running | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 900
} else {
  Write-Step 1 'لا توجد نسخة سابقة'
}

# ---------------------------------------------------------------------------
# 2) الاعتماديات
# ---------------------------------------------------------------------------
$electronExe = Join-Path $App 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electronExe)) {
  Write-Step 2 'تثبيت الاعتماديات (مرة واحدة)...' 'Yellow'
  & npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  [!] فشل تثبيت الاعتماديات' -ForegroundColor Red
    exit 1
  }
} else {
  Write-Step 2 'الاعتماديات جاهزة'
}

# ---------------------------------------------------------------------------
# 3) البناء عند الحاجة
# ---------------------------------------------------------------------------
$built = Get-Item (Join-Path $App 'out\main\index.js') -ErrorAction SilentlyContinue

$newest = Get-ChildItem -Recurse -File -Path 'src', 'tests', 'scripts' `
  -Include *.ts, *.tsx, *.mjs, *.css, *.html `
  -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

$needsBuild = $true
if ($built) {
  $needsBuild = $newest.LastWriteTimeUtc -gt $built.LastWriteTimeUtc
}

if ($needsBuild) {
  Write-Step 3 'المصدر تغيّر — جارٍ البناء...' 'Yellow'
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  [!] فشل البناء' -ForegroundColor Red
    exit 1
  }
  Write-Host '        تم البناء بنجاح' -ForegroundColor DarkGreen
} else {
  Write-Step 3 'البناء محدّث' 'DarkGreen'
}

# ---------------------------------------------------------------------------
# 4) التشغيل
# ---------------------------------------------------------------------------
Write-Step 4 'التشغيل...' 'Cyan'
Start-Process -FilePath $electronExe -ArgumentList $App
Write-Host ''
Write-Host '  تم الإقلاع — النافذة مفتوحة الآن.' -ForegroundColor Green
Write-Host ''
Start-Sleep -Seconds 1
exit 0