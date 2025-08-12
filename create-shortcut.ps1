$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcut = $shell.CreateShortcut("$desktop\1688 Invoice Server.lnk")
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-ExecutionPolicy Bypass -NoExit -Command `"cd 'D:\project\1688-invoice'; npm run dev`""
$shortcut.WorkingDirectory = "D:\project\1688-invoice"
$shortcut.IconLocation = "C:\Windows\System32\cmd.exe"
$shortcut.Description = "1688 Invoice Server 실행 (PowerShell)"
$shortcut.Save()
Write-Host "PowerShell 바로가기가 바탕화면에 생성되었습니다." -ForegroundColor Green