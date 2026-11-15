; Electron user data and updater downloads leave with the application; the Harness home is never touched.
!include FileFunc.nsh
; main.ts keeps Electron user data, and by default the Harness home, in this %APPDATA% folder. The product name also
; names other iPolloWork data under %APPDATA%, so it never selects what to remove.
!define DSH_USER_DATA_NAME "iPolloWork Desktop"
Var UnTarget
Var UnHome

; The helper refuses unsafe roots, the installation and the Harness home, and never descends into reparse points;
; a locked file leaves residue and never fails the uninstall. customCheckAppRunning extracts window-frame.dll first.
Function un.RemoveData
  System::Call '$PLUGINSDIR\window-frame.dll::UninstallRemoveData(w "$UnTarget", w "$INSTDIR", w "$UnHome") ?c'
FunctionEnd

Function un.CleanData
  ${If} ${isUpdated}
    Return
  ${EndIf}
  ; The installer runs an older uninstaller with /KEEP_APP_DATA when replacing it from another directory.
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/KEEP_APP_DATA" $R1
  ${IfNot} ${Errors}
    Return
  ${EndIf}
  ; Only a DSH_HOME published as a Windows environment variable is visible here. Without one the Harness home is the
  ; Desktop default inside the user data folder, so the helper keeps that whole folder.
  ReadEnvStr $UnHome DSH_HOME
  ClearErrors
  ${If} $UnHome == ""
    StrCpy $UnHome "$APPDATA\${DSH_USER_DATA_NAME}\harness"
  ${EndIf}
  StrCpy $UnTarget "$APPDATA\${DSH_USER_DATA_NAME}"
  Call un.RemoveData
  !ifdef APP_PACKAGE_NAME
    ; Electron derives user data from the package name; a scoped name nests it one directory deeper.
    StrCpy $UnTarget "$APPDATA\${APP_PACKAGE_NAME}"
    Call un.RemoveData
    System::Call '$PLUGINSDIR\window-frame.dll::UninstallRemoveEmptyParents(w "$UnTarget", w "$APPDATA") ?c'
  !endif
  StrCpy $UnTarget "$LOCALAPPDATA\${DSH_UPDATER_CACHE_NAME}"
  Call un.RemoveData
FunctionEnd
