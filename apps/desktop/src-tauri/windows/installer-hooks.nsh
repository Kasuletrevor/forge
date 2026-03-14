!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Configuring Forge CLI on PATH..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\forge-cli\install-cli.ps1" -SourceDir "$INSTDIR\resources\forge-cli"'
  Pop $0
  StrCmp $0 "0" forge_cli_postinstall_done
  MessageBox MB_OK|MB_ICONEXCLAMATION "Forge installed, but CLI setup failed. Run install-cli.ps1 from the installed resources or reinstall Forge."
forge_cli_postinstall_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists "$INSTDIR\resources\forge-cli\uninstall-cli.ps1" 0 forge_cli_preuninstall_done
  DetailPrint "Removing Forge CLI from PATH..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\forge-cli\uninstall-cli.ps1"'
  Pop $0
  StrCmp $0 "0" forge_cli_preuninstall_done
  MessageBox MB_OK|MB_ICONEXCLAMATION "Forge uninstall could not fully remove the CLI integration. Close any running Forge processes and rerun uninstall-cli.ps1 from the installed resources if PATH cleanup is still needed."
forge_cli_preuninstall_done:
!macroend
