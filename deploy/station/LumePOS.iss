; Lume POS (the Station): one Setup.exe that puts the whole POS on a shop PC.
; Its own AppId, so it never installs over another program.
; Built by GitHub (.github/workflows/station.yml) from deploy/station/stage/ (see stage.ps1):
;   iscc /DAppVersion=1.2.3 LumePOS.iss
; Everything it needs is inside: its own Node.js, the POS, the built-in database. The shop's
; data lives in C:\ProgramData\LumePOS and is never touched by an update or an uninstall.

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
AppId={{CA0D1811-DA13-42CB-A0E9-1CA6346DD544}
AppName=Lume POS
AppVersion={#AppVersion}
AppVerName=Lume POS {#AppVersion}
AppPublisher=Lume
AppPublisherURL=https://github.com/gyrika/possaas
DefaultDirName={autopf}\Lume POS
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
; The Lume POS honeycomb on the Setup.exe file, its pages, and in Windows' list of programs
; (pictures drawn by scripts/make-icons.mjs).
SetupIconFile=pos-app\app.ico
WizardImageFile=wizard.bmp,wizard-2x.bmp
WizardSmallImageFile=wizard-small.bmp,wizard-small-2x.bmp
UninstallDisplayIcon={app}\pos-app\LumePOS.exe
OutputDir=Output
OutputBaseFilename={#SetupName}
Compression=lzma2/max
SolidCompression=yes
UninstallDisplayName=Lume POS
CloseApplications=no
; Never ask to restart Windows: a shop's counter PC cannot be restarted mid-day (owner, 2026-10-30).
RestartIfNeededByRun=no

[Messages]
WelcomeLabel1=Welcome to Lume POS
WelcomeLabel2=This puts Lume POS on this computer: the counter, the kitchen screen and everything they need.%n%nIt takes about a minute. Then the POS opens and asks a few questions about your shop.
FinishedHeadingLabel=Lume POS is ready
FinishedLabel=The POS starts by itself whenever this computer starts.
WinVersionTooLowError=Lume POS needs Windows 10 (version 2004 or newer) or Windows 11, 64-bit. Please update Windows first.

[Dirs]
Name: "{commonappdata}\LumePOS"

[Files]
Source: "stage\node\node.exe"; DestDir: "{app}\node"; Flags: ignoreversion
Source: "stage\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
; The counter app is usually running during an update, which locks its files. Setup run by hand closes it
; first (PrepareToInstall) and opens it again at the end, so nothing waits for a restart. The silent nightly
; update leaves it open: then its files are replaced at the next restart (restartreplace), without asking.
; The POS screens come from the server, so they update at once either way.
Source: "stage\pos-app\*"; DestDir: "{app}\pos-app"; Flags: ignoreversion recursesubdirs createallsubdirs restartreplace
Source: "station.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "station-install.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "station-uninstall.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "station-update.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "station-support.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "stage\version.txt"; DestDir: "{app}"; Flags: ignoreversion
#ifdef Offline
Source: "stage\webview2\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall
#endif

[Icons]
; The counter's app (a real Windows program, not a browser): its own icon, full screen.
Name: "{commondesktop}\Lume POS"; Filename: "{app}\pos-app\LumePOS.exe"; WorkingDir: "{app}\pos-app"
Name: "{autoprograms}\Lume POS"; Filename: "{app}\pos-app\LumePOS.exe"; WorkingDir: "{app}\pos-app"
; When the POS will not open: the support file to send to whoever looks after it (server/supportFile.ts).
Name: "{autoprograms}\Lume POS support file"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\station-support.ps1"""; IconFilename: "{app}\pos-app\LumePOS.exe"
; Whoever logs in to Windows at the counter gets the POS.
Name: "{commonstartup}\Lume POS"; Filename: "{app}\pos-app\LumePOS.exe"; WorkingDir: "{app}\pos-app"

[Run]
#ifdef Offline
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\station-install.ps1"" -WebView2Setup ""{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"""; Flags: runhidden waituntilterminated; StatusMsg: "Starting Lume POS..."
#else
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\station-install.ps1"""; Flags: runhidden waituntilterminated; StatusMsg: "Starting Lume POS..."
#endif
Filename: "{app}\pos-app\LumePOS.exe"; Description: "Open Lume POS now"; Flags: postinstall nowait skipifsilent runasoriginaluser

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\station-uninstall.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "StopStation"

[Code]
// Before files are replaced (an update): stop the running server, so nothing is locked. Run by hand,
// also close the counter app (it opens again at the end), so Windows never needs a restart for its files.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  if not WizardSilent then
    Exec('powershell.exe', '-NoProfile -Command "Get-Process LumePOS -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ''' +
      ExpandConstant('{app}') + '*'' } | Stop-Process -Force; Start-Sleep -Milliseconds 500"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "Lume POS"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec('powershell.exe', '-NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ''' +
    ExpandConstant('{app}') + '*'' } | Stop-Process -Force"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := '';
end;
