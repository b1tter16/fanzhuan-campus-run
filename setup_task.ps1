$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA 'FanzhuanAutoRun'
$node = Join-Path $dest 'runtime\node.exe'
$script = Join-Path $dest 'campus_auto_run.js'

Write-Host ''
Write-Host '=== 翻转校园跑自动刷 · 安装 ===' -ForegroundColor Cyan
Write-Host "安装目录：$dest"

if ($src -ne $dest) {
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  New-Item -ItemType Directory -Force $dest | Out-Null
  Copy-Item -Path (Join-Path $src '*') -Destination $dest -Recurse -Force
}

if (!(Test-Path $node)) {
  $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($systemNode) { $node = $systemNode.Source }
}

if (!(Test-Path $node) -or !(Test-Path $script)) {
  throw '安装文件不完整，请重新解压整个文件夹，或先安装 Node.js 18+。'
}

$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument ('"' + (Join-Path $dest 'run_campus_hidden.vbs') + '"') `
  -WorkingDirectory $dest
$t1 = New-ScheduledTaskTrigger -Daily -At '07:10'
$t2 = New-ScheduledTaskTrigger -Daily -At '18:10'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 40) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'FanzhuanCampusRun' -Action $action `
  -Trigger @($t1, $t2) -Settings $settings `
  -Description '翻转校园跑自动刷：每天07:10和18:10各一次，每次约20分钟' -Force | Out-Null
Write-Host '已创建计划任务：FanzhuanCampusRun（每天 07:10 / 18:10）' -ForegroundColor Green

$ws = New-Object -ComObject WScript.Shell
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) '翻转校园跑自动刷.lnk'
$cmd = Join-Path $dest '一键校园跑.cmd'
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = $env:ComSpec
$sc.Arguments = '/k ""' + $cmd + '""'
$sc.WorkingDirectory = $dest
$sc.Description = '翻转校园跑自动刷（约20分钟）'
$sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,137"
$sc.Save()
Write-Host "已创建桌面快捷方式：$lnk" -ForegroundColor Green
Write-Host ''
Write-Host '安装完成。' -ForegroundColor Cyan
Write-Host '请先确认：微信已登录，并且打开过一次“翻转任务跑”小程序。'
Write-Host '手动运行：双击桌面的“翻转校园跑自动刷”。'
Write-Host '自动运行：每天 07:10、18:10（电脑需开机）。'
