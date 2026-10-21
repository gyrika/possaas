; Lume POS (the Station): one Setup.exe that puts the whole POS on a shop PC.
; What people see says Lume POS; the internal names (this file, the program folder, the tasks,
; C:\ProgramData\CheesyBeez, CheesyBeezPOS.exe) stay, so installed shops update in place.
; Built by GitHub (.github/workflows/station.yml) from deploy/station/stage/ (see stage.ps1):
;   iscc /DAppVersion=1.2.3 CheesyBeez.iss
; Everything it needs is inside: its own Node.js, the POS, the built-in database. The shop's
; data lives in C:\ProgramData\CheesyBeez and is never touched by an update or an uninstall.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
; iscc /DOffline ...: the offline Setup.exe, for a PC without internet. It also carries Microsoft's
; WebView2 (the counter app's web engine, ~200 MB), so it is a separate download: updates keep using
; the small one (station-update.ps1 looks only for LumePOS-Setup-*.exe).
#ifdef Offline
  #define SetupName "LumePOS-Offline-Setup-" + AppVersion
#else
  #define SetupName "LumePOS-Setup-" + AppVersion
#endif

[Setup]
AppId={{6B8E2C14-5A7D-4F39-9C21-CB3E5A1F0D42}
AppName=Lume POS
AppVersion={#AppVersion}
AppVerName=Lume POS {#AppVersion}
AppPublisher=Lume
AppPublisherURL=https://github.com/gyrika/ERP
DefaultDirName={autopf}\CheesyBeez Station
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Windows 10 version 2004 or newer, or Windows 11: the oldest Windows the bundled Node.js, .NET 4.8
; and WebView2 are all tested on (station.yml). Older PCs get a clear message instead of a POS that
; installs and then does not start.
MinVersion=10.0.19041
WizardStyle=modern
; The CheesyBeez honeycomb on the Setup.exe file, its pages, and in Windows' list of programs
; (pictures drawn by scripts/make-icons.mjs).
SetupIconFile=pos-app\app.ico
WizardImageFile=wizard.bmp,wizard-2x.bmp
WizardSmallImageFile=wizard-small.bmp,wizard-small-2x.bmp
UninstallDisplayIcon={app}\pos-app\CheesyBeezPOS.exe
OutputDir=Output
OutputBaseFilename={#SetupName}
Compression=lzma2/max
SolidCompression=yes
UninstallDisplayName=Lume POS
CloseApplications=no

[Messages]
WelcomeLabel1=Welcome to Lume POS
WelcomeLabel2=This puts Lume POS on this computer: the counter, the kitchen screen and everything they need.%n%nIt takes about a minute. Then the POS opens and asks a few questions about your shop.
FinishedHeadingLabel=Lume POS is ready
FinishedLabel=The POS starts by itself whenever this computer starts.
WinVersionTooLowError=Lume POS needs Windows 10 (version 2004 or newer) or Windows 11, 64-bit. Please update Windows first.

[Dirs]
Name: "{commonappdata}\CheesyBeez"

[Files]
Source: "stage\node\node.exe"; DestDir: "{app}\node"; Flags: ignoreversion
Source: "stage\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
; The counter app is usually running during an update, which locks its files: those are replaced at the
; next restart (restartreplace). The POS screens come from the server, so they update at once anyway.
Source: "stage\pos-app\*"; DestDir: "{app}\pos-app"; Flags: ignoreversion recursesubdirs createallsubdirs restartreplace
Source: "station.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "station-install.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "station-uninstall.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "station-update.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "stage\version.txt"; DestDir: "{app}"; Flags: ignoreversion
#ifdef Offline
Source: "stage\webview2\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall
#endif

[InstallDelete]
; The shortcuts' old name (before Lume POS), so an updated PC does not show both.
Type: files; Name: "{commondesktop}\CheesyBeez POS.lnk"
Type: files; Name: "{autoprograms}\CheesyBeez POS.lnk"
Type: files; Name: "{commonstartup}\CheesyBeez POS.lnk"

[Icons]
; The counter's app (a real Windows program, not a browser): its own icon, full screen.
Name: "{commondesktop}\Lume POS"; Filename: "{app}\pos-app\CheesyBeezPOS.exe"; WorkingDir: "{app}\pos-app"
Name: "{autoprograms}\Lume POS"; Filename: "{app}\pos-app\CheesyBeezPOS.exe"; WorkingDir: "{app}\pos-app"
; Whoever logs in to Windows at the counter gets the POS.
Name: "{commonstartup}\Lume POS"; Filename: "{app}\pos-app\CheesyBeezPOS.exe"; WorkingDir: "{app}\pos-app"

[Run]
#ifdef Offline
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\station-install.ps1"" -WebView2Setup ""{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"""; Flags: runhidden waituntilterminated; StatusMsg: "Starting Lume POS..."
#else
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\station-install.ps1"""; Flags: runhidden waituntilterminated; StatusMsg: "Starting Lume POS..."
#endif
Filename: "{app}\pos-app\CheesyBeezPOS.exe"; Description: "Open Lume POS now"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\station-uninstall.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "StopStation"

[Code]
// Before files are replaced (an update): stop the running server, so nothing is locked.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "CheesyBeez Station"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec('powershell.exe', '-NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ''' +
    ExpandConstant('{app}') + '*'' } | Stop-Process -Force"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := '';
end;
