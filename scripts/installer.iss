; Inno Setup script for GymSystem (TASK-045).
; Installs per-user (no admin/UAC), creates a desktop + Start Menu shortcut,
; and NEVER touches %LOCALAPPDATA%\GymSystem (data, license, WhatsApp session).
;
; Build: install Inno Setup 6 (winget: JRSoftware.InnoSetup) then run:
;   npm run build:exe        (produces dist-exe/)
;   iscc scripts/installer.iss  (produces dist-exe/GymSystem-Setup-<ver>.exe)

#define MyAppName "GymSystem"
#define MyAppVersion "0.1.0"
#define MyAppExeName "GymSystem.exe"
#define MyAppPublisher "Yassen Mohamed Kotb"
#define MyAppAssocName MyAppName + " File"
#define MyAppAssocExt ".myp"

[Setup]
AppId={{B5E1A4C6-8F2C-4A1B-9D3E-3C6A1B9E5D01}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\GymSystem
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist-exe
OutputBaseFilename=GymSystem-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist-exe\GymSystem.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist-exe\runtime\node.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "..\dist-exe\gateway\*"; DestDir: "{app}\gateway"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"