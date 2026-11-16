' Launch the fish desktop pet without a console window.
' Working directory = this script's folder (the pet folder).
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c npm start", 0, False
