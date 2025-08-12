Set objShell = CreateObject("WScript.Shell")
objShell.CurrentDirectory = "D:\project\1688-invoice"
objShell.Run "cmd /k npm run dev", 1, False