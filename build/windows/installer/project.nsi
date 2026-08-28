Unicode true

####
## Please note: Template replacements don't work in this file. They are provided with default defines like
## mentioned underneath.
## If the keyword is not defined, "wails_tools.nsh" will populate them with the values from ProjectInfo.
## If they are defined here, "wails_tools.nsh" will not touch them. This allows to use this project.nsi manually
## from outside of Wails for debugging and development of the installer.
##
## For development first make a wails nsis build to populate the "wails_tools.nsh":
## > wails build --target windows/amd64 --nsis
## Then you can call makensis on this file with specifying the path to your binary:
## For a AMD64 only installer:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app.exe
## For a ARM64 only installer:
## > makensis -DARG_WAILS_ARM64_BINARY=..\..\bin\app.exe
## For a installer with both architectures:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app-amd64.exe -DARG_WAILS_ARM64_BINARY=..\..\bin\app-arm64.exe
####
## The following information is taken from the ProjectInfo file, but they can be overwritten here.
####
## !define INFO_PROJECTNAME    "MyProject" # Default "{{.Name}}"
## !define INFO_COMPANYNAME    "MyCompany" # Default "{{.Info.CompanyName}}"
## !define INFO_PRODUCTNAME    "MyProduct" # Default "{{.Info.ProductName}}"
## !define INFO_PRODUCTVERSION "1.0.0"     # Default "{{.Info.ProductVersion}}"
## !define INFO_COPYRIGHT      "Copyright" # Default "{{.Info.Copyright}}"
###
## !define PRODUCT_EXECUTABLE  "Application.exe"      # Default "${INFO_PROJECTNAME}.exe"
## !define UNINST_KEY_NAME     "UninstKeyInRegistry"  # Default "${INFO_COMPANYNAME}${INFO_PRODUCTNAME}"
####
## !define REQUEST_EXECUTION_LEVEL "admin"            # Default "admin"  see also https://nsis.sourceforge.io/Docs/Chapter4.html
####
## Include the wails tools
####
!include "wails_tools.nsh"

# The version information for this two must consist of 4 parts
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Enable HiDPI support. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

!include "MUI.nsh"
!include "LogicLib.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
# !define MUI_WELCOMEFINISHPAGE_BITMAP "resources\leftimage.bmp" #Include this to add a bitmap on the left side of the Welcome Page. Must be a size of 164x314
!define MUI_FINISHPAGE_NOAUTOCLOSE # Wait on the INSTFILES page so the user can take a look into the details of the installation steps
!define MUI_ABORTWARNING # This will warn the user if they exit from the installer.
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_EXECUTABLE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${INFO_PRODUCTNAME}"

!insertmacro MUI_PAGE_WELCOME # Welcome to the installer page.
!insertmacro MUI_PAGE_LICENSE "..\..\..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY # In which folder install page.
!insertmacro MUI_PAGE_COMPONENTS # Optional Agent hook components
!insertmacro MUI_PAGE_INSTFILES # Installing page.
!insertmacro MUI_PAGE_FINISH # Finished installation page.

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES # Uinstalling page

!insertmacro MUI_LANGUAGE "English" # Set the Language of the installer

LangString DESC_SecApp ${LANG_ENGLISH} "SkillsManager application files (required)."
LangString DESC_SecCursorHooks ${LANG_ENGLISH} "Install Cursor skill-usage hooks into your user profile."
LangString DESC_SecClaudeHooks ${LANG_ENGLISH} "Install Claude Code skill-usage hooks into your user profile."
LangString DESC_SecCodexHooks ${LANG_ENGLISH} "Install Codex skill-usage hooks into your user profile."
LangString DESC_SecOpenCodeHooks ${LANG_ENGLISH} "Install OpenCode skill-usage plugin into your user profile."

## The following two statements can be used to sign the installer and the uninstaller. The path to the binaries are provided in %1
#!uninstfinalize 'signtool --file "%1"'
#!finalize 'signtool --file "%1"'

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe" # Name of the installer's file.
!ifdef WAILS_INSTALL_SCOPE
  !if "${WAILS_INSTALL_SCOPE}" == "user"
    InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
    InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
  !else
    InstallDir "$PROGRAMFILES64\${INFO_PRODUCTNAME}"
    InstallDirRegKey HKLM "${UNINST_KEY}" "InstallLocation"
  !endif
!else
  InstallDir "$PROGRAMFILES64\${INFO_PRODUCTNAME}"
  InstallDirRegKey HKLM "${UNINST_KEY}" "InstallLocation"
!endif # Default installing folder ($PROGRAMFILES is Program Files folder).
ShowInstDetails show # This will always show the installation details.

Var KeepAgentHooks

# Read a registry value from HKLM then HKCU (64-bit view).
# $R0 = value name, result in $R9 (empty if missing).
Function ReadUninstRegValue
    SetRegView 64
    StrCpy $R9 ""
    !ifdef WAILS_INSTALL_SCOPE
      !if "${WAILS_INSTALL_SCOPE}" == "user"
        ReadRegStr $R9 HKCU "${UNINST_KEY}" "$R0"
      !else
        ReadRegStr $R9 HKLM "${UNINST_KEY}" "$R0"
        ${If} $R9 == ""
            ReadRegStr $R9 HKCU "${UNINST_KEY}" "$R0"
        ${EndIf}
      !endif
    !else
        ReadRegStr $R9 HKLM "${UNINST_KEY}" "$R0"
        ${If} $R9 == ""
            ReadRegStr $R9 HKCU "${UNINST_KEY}" "$R0"
        ${EndIf}
    !endif
FunctionEnd

# If already installed, set $INSTDIR to the previous path (for directory page).
Function RestorePreviousInstallDir
    # Prefer InstallLocation written by this installer.
    StrCpy $R0 "InstallLocation"
    Call ReadUninstRegValue
    ${If} $R9 != ""
        StrCpy $INSTDIR $R9
        Return
    ${EndIf}

    # Fallback for older installs that only have UninstallString:
    #   "C:\...\SkillsManager\uninstall.exe"
    StrCpy $R0 "UninstallString"
    Call ReadUninstRegValue
    ${If} $R9 == ""
        Return
    ${EndIf}

    # Strip surrounding quotes if present.
    StrCpy $R1 $R9 1
    ${If} $R1 == '"'
        StrLen $R2 $R9
        IntOp $R2 $R2 - 2
        StrCpy $R9 $R9 $R2 1
    ${EndIf}

    ${GetParent} $R9 $R8
    ${If} $R8 != ""
        StrCpy $INSTDIR $R8
    ${EndIf}
FunctionEnd

# Persist InstallLocation so reinstall/upgrade can prefill the directory page.
Function WriteInstallLocation
    SetRegView 64
    !ifdef WAILS_INSTALL_SCOPE
      !if "${WAILS_INSTALL_SCOPE}" == "user"
        WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
      !else
        WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
      !endif
    !else
        WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
    !endif
FunctionEnd

Function .onInit
   !insertmacro wails.checkArchitecture
   Call RestorePreviousInstallDir
FunctionEnd

Function un.onInit
    StrCpy $KeepAgentHooks "0"
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
        "Keep installed Agent hooks in your user profile?$\r$\n$\r$\nChoose No to remove SkillsManager-managed hooks (recommended)." \
        IDYES keep_hooks
    Return
    keep_hooks:
        StrCpy $KeepAgentHooks "1"
FunctionEnd

Section "SkillsManager" SecApp
    SectionIn RO
    !insertmacro wails.setShellContext

    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR

    !insertmacro wails.files

    # Ship hook packages + installers for optional Agent components and later manual use.
    SetOutPath "$INSTDIR\hooks"
    File "..\..\..\hooks\manifest.json"
    File "..\..\..\hooks\install.ps1"
    File "..\..\..\hooks\uninstall.ps1"
    File "..\..\..\hooks\install.sh"
    File "..\..\..\hooks\uninstall.sh"
    SetOutPath "$INSTDIR\hooks\lib"
    File "..\..\..\hooks\lib\manage.cjs"
    SetOutPath "$INSTDIR\hooks\cursor"
    File "..\..\..\hooks\cursor\record-skill-read.cjs"
    SetOutPath "$INSTDIR\hooks\claude"
    File "..\..\..\hooks\claude\record-skill-read.cjs"
    SetOutPath "$INSTDIR\hooks\codex"
    File "..\..\..\hooks\codex\record-skill-read.cjs"
    SetOutPath "$INSTDIR\hooks\opencode"
    File "..\..\..\hooks\opencode\skillsmanager-opencode.js"

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols

    !insertmacro wails.writeUninstaller
    Call WriteInstallLocation
SectionEnd

Section "Cursor Hooks" SecCursorHooks
    DetailPrint "Installing Cursor agent hooks..."
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\hooks\install.ps1" -Agent cursor'
    Pop $0
    ${If} $0 == 2
        DetailPrint "Cursor hooks skipped (node not found on PATH)."
    ${ElseIf} $0 != 0
        DetailPrint "Cursor hooks install returned exit code $0."
    ${EndIf}
SectionEnd

Section "Claude Code Hooks" SecClaudeHooks
    DetailPrint "Installing Claude Code agent hooks..."
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\hooks\install.ps1" -Agent claude'
    Pop $0
    ${If} $0 == 2
        DetailPrint "Claude Code hooks skipped (node not found on PATH)."
    ${ElseIf} $0 != 0
        DetailPrint "Claude Code hooks install returned exit code $0."
    ${EndIf}
SectionEnd

Section "Codex Hooks" SecCodexHooks
    DetailPrint "Installing Codex agent hooks..."
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\hooks\install.ps1" -Agent codex'
    Pop $0
    ${If} $0 == 2
        DetailPrint "Codex hooks skipped (node not found on PATH)."
    ${ElseIf} $0 != 0
        DetailPrint "Codex hooks install returned exit code $0."
    ${EndIf}
SectionEnd

Section "OpenCode Hooks" SecOpenCodeHooks
    DetailPrint "Installing OpenCode agent hooks..."
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\hooks\install.ps1" -Agent opencode'
    Pop $0
    ${If} $0 != 0
        DetailPrint "OpenCode hooks install returned exit code $0."
    ${EndIf}
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${SecApp} $(DESC_SecApp)
    !insertmacro MUI_DESCRIPTION_TEXT ${SecCursorHooks} $(DESC_SecCursorHooks)
    !insertmacro MUI_DESCRIPTION_TEXT ${SecClaudeHooks} $(DESC_SecClaudeHooks)
    !insertmacro MUI_DESCRIPTION_TEXT ${SecCodexHooks} $(DESC_SecCodexHooks)
    !insertmacro MUI_DESCRIPTION_TEXT ${SecOpenCodeHooks} $(DESC_SecOpenCodeHooks)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "uninstall"
    !insertmacro wails.setShellContext

    ${If} $KeepAgentHooks == "0"
        IfFileExists "$INSTDIR\hooks\uninstall.ps1" 0 skip_hooks_uninstall
            DetailPrint "Removing SkillsManager-managed agent hooks..."
            nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\hooks\uninstall.ps1" -All'
        skip_hooks_uninstall:
    ${EndIf}

    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}" # Remove the WebView2 DataPath

    RMDir /r $INSTDIR

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols

    !insertmacro wails.deleteUninstaller
SectionEnd
