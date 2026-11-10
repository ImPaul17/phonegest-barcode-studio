; PhoneGest assisted installer — dark visual style, created by ImPaul.
; Keep electron-builder's own installation/uninstallation engine and data safeguards.
!include nsDialogs.nsh
!include LogicLib.nsh

!define MUI_BGCOLOR "23292E"
!define MUI_TEXTCOLOR "F5F7F9"
!define MUI_INSTFILESPAGE_COLORS "F5F7F9 23292E"
!define MUI_WELCOMEPAGE_TITLE "PhoneGest Barcode Studio"
!define MUI_WELCOMEPAGE_TEXT "Códigos de barras, PDF e imágenes en tu equipo.$\r$\n$\r$\nEste asistente permite elegir la carpeta y el disco de instalación, y crear un acceso directo.$\r$\n$\r$\nSi ya está instalado, podrás cambiar su ubicación conservando tus ajustes y proyectos.$\r$\n$\r$\nCreado por ImPaul."
!define MUI_FINISHPAGE_TITLE "Todo preparado"
!define MUI_FINISHPAGE_TEXT "PhoneGest Barcode Studio se ha instalado correctamente.$\r$\n$\r$\nAbre la aplicación desde el menú Inicio o desde tu acceso directo.$\r$\n$\r$\nCreado por ImPaul."
!define MUI_CUSTOMFUNCTION_GUIINIT PhoneGestDarkPage

!macro customWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW PhoneGestDarkPage
  !insertmacro MUI_PAGE_WELCOME
  ; The next standard page is the directory selector (the mode page is custom).
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW PhoneGestDarkPage
!macroend

!macro customPageAfterChangeDir
  Page custom PhoneGestOptionsPage PhoneGestOptionsLeave
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW PhoneGestDarkPage
!macroend

!macro customFinishPage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW PhoneGestDarkPage
  !insertmacro MUI_PAGE_FINISH
!macroend

!ifndef BUILD_UNINSTALLER
  Var PhoneGestOptions
  Var PhoneGestShortcut
  Var PhoneGestShortcutState

  !macro customInit
    StrCpy $PhoneGestShortcutState ${BST_CHECKED}
  !macroend

  !macro customInstall
    ; Record this running installer's hash after extraction. This avoids a circular
    ; build-time hash inside app.asar and lets relocation work completely offline.
    Push $0
    Push $1
    Push $2
    ${StdUtils.HashFile} $0 "SHA2-512" "$EXEPATH"
    StrLen $1 $0
    ${If} $1 == 128
      ClearErrors
      FileOpen $2 "$INSTDIR\resources\phonegest-installer.json" w
      ${IfNot} ${Errors}
        FileWrite $2 '{"version":"${VERSION}","filename":"PhoneGest-Barcode-Studio-${VERSION}-Instalador.exe","sha512Hex":"$0"}'
        FileClose $2
      ${EndIf}
    ${EndIf}
    ClearErrors
    Pop $2
    Pop $1
    Pop $0
    ; Automatic updates preserve the existing desktop shortcut preference.
    ${IfNot} ${Silent}
    ${AndIfNot} ${isUpdated}
      ${If} $PhoneGestShortcutState == ${BST_CHECKED}
        CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "PhoneGest Barcode Studio · ImPaul"
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      ${Else}
        Delete "$newDesktopLink"
      ${EndIf}
    ${EndIf}
  !macroend
!endif

; Defer function compilation until electron-builder has registered its plugins.
!macro customHeader
Function PhoneGestDarkPage
  Push $0
  Push $1
  Push $2
  SetCtlColors $HWNDPARENT F5F7F9 23292E
  System::Call 'user32::GetWindow(p $HWNDPARENT, i 5) p.r0'
  ${DoWhile} $0 != 0
    SetCtlColors $0 F5F7F9 23292E
    System::Call 'user32::GetWindow(p r0, i 5) p.r1'
    ${DoWhile} $1 != 0
      SetCtlColors $1 F5F7F9 23292E
      System::Call 'user32::GetWindow(p r1, i 2) p.r1'
    ${Loop}
    System::Call 'user32::GetWindow(p r0, i 2) p.r0'
  ${Loop}
  ; Native Windows buttons retain their system rendering and readable text.
  GetDlgItem $2 $HWNDPARENT 1
  SetCtlColors $2 23292E F5F7F9
  GetDlgItem $2 $HWNDPARENT 2
  SetCtlColors $2 23292E F5F7F9
  GetDlgItem $2 $HWNDPARENT 3
  SetCtlColors $2 23292E F5F7F9
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!ifndef BUILD_UNINSTALLER
  Function PhoneGestOptionsPage
    ${If} ${Silent}
      Abort
    ${EndIf}
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "A tu manera" "Accesos directos e instalación de PhoneGest."
    nsDialogs::Create 1018
    Pop $PhoneGestOptions
    ${If} $PhoneGestOptions == error
      Abort
    ${EndIf}
    SetCtlColors $PhoneGestOptions F5F7F9 23292E
    ${NSD_CreateLabel} 0 4u 100% 30u "Se instalará en:$\r$\n$INSTDIR"
    Pop $0
    SetCtlColors $0 F5F7F9 23292E
    ${NSD_CreateCheckbox} 0 48u 100% 18u "Crear un acceso directo en el escritorio"
    Pop $PhoneGestShortcut
    SetCtlColors $PhoneGestShortcut F5F7F9 23292E
    ${NSD_SetState} $PhoneGestShortcut $PhoneGestShortcutState
    ${NSD_CreateLabel} 0 82u 100% 38u "Tus ajustes y proyectos se conservarán si cambias la carpeta.$\r$\n$\r$\nCreado por ImPaul · PhoneGest Barcode Studio"
    Pop $0
    SetCtlColors $0 B4C2CB 23292E
    Call PhoneGestDarkPage
    nsDialogs::Show
  FunctionEnd

  Function PhoneGestOptionsLeave
    ${NSD_GetState} $PhoneGestShortcut $PhoneGestShortcutState
  FunctionEnd

!endif
!macroend
