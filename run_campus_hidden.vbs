Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = base & "\runtime\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node.exe"
Set ws = CreateObject("WScript.Shell")
ws.Run """" & nodeExe & """ """ & base & "\campus_auto_run.js""", 0, False
