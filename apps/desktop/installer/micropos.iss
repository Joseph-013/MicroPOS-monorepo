; MicroPOS Windows installer (Inno Setup 6). Built by `pnpm make` on Windows (scripts/make.mjs), which packages the
; app with Electron Forge first and passes these defines:
;   AppVersion  version from package.json
;   SourceDir   the packaged app folder (out\MicroPOS-win32-x64)
;   OutputDir   where Setup goes (out\make\inno)
;   IconFile    assets\icon.ico
;
; Wizard: install for me only / for all users, welcome, install folder, existing data (only when the data folder has
; something in it: keep or delete), shortcuts, ready, install, launch. The uninstaller asks whether to delete the data.
; The app's data lives per Windows user in %APPDATA%\micropos (Electron's userData), whichever install mode is chosen.

#ifndef AppVersion
  #error AppVersion is not defined: build with `pnpm make` (scripts/make.mjs)
#endif

#define AppName "MicroPOS"
#define AppExe "micropos.exe"

[Setup]
; Never change AppId: it is how a later Setup finds this install to upgrade it.
AppId={{AC933739-ED4B-4281-93EE-725399434856}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppName}
VersionInfoVersion={#AppVersion}
; Per user by default (no admin rights needed); the first dialog offers "Install for all users" (asks for admin).
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
; {autopf} is %LOCALAPPDATA%\Programs for one user, Program Files for all users.
DefaultDirName={autopf}\{#AppName}
DisableDirPage=no
DisableProgramGroupPage=yes
DisableWelcomePage=no
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename={#AppName}-{#AppVersion}-setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2
SolidCompression=yes
; Files of a running MicroPOS are in use: ask to close it before replacing them.
CloseApplications=yes
RestartApplications=no
; The data folder is per user on purpose (see above).
UsedUserAreasWarning=no

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; An upgrade replaces the app's resources wholesale, so nothing from the previous version is left behind.
Type: filesandordirs; Name: "{app}\resources"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[Code]
var
  DataPage: TInputOptionWizardPage;

function DataDir(): String;
begin
  Result := ExpandConstant('{userappdata}\micropos');
end;

{ True when the data folder exists and holds anything. }
function HasData(): Boolean;
var
  Rec: TFindRec;
begin
  Result := False;
  if not DirExists(DataDir()) then Exit;
  if FindFirst(DataDir() + '\*', Rec) then
  try
    repeat
      if (Rec.Name <> '.') and (Rec.Name <> '..') then
      begin
        Result := True;
        Exit;
      end;
    until not FindNext(Rec);
  finally
    FindClose(Rec);
  end;
end;

function WipeData(): Boolean;
begin
  Result := (DataPage <> nil) and DataPage.Values[1];
end;

procedure InitializeWizard();
begin
  if not HasData() then Exit;
  DataPage := CreateInputOptionPage(wpSelectDir,
    'Existing data',
    'MicroPOS data was found on this computer.',
    'Data folder:' + #13#10 + DataDir() + #13#10#13#10 +
    'It holds the database, backups, logs, the shop logo and settings. Choose what to do with it.',
    True, False);
  DataPage.Add('Keep existing data');
  DataPage.Add('Delete existing data and start fresh (cannot be undone)');
  DataPage.Values[0] := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (DataPage <> nil) and (CurPageID = DataPage.ID) and WipeData() then
    Result := MsgBox('All MicroPOS data in' + #13#10 + DataDir() + #13#10 +
      'will be deleted when installation starts. This cannot be undone.' + #13#10#13#10 + 'Continue?',
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo,
  MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := MemoDirInfo;
  if DataPage <> nil then
  begin
    Result := Result + NewLine + NewLine + 'Existing data:' + NewLine + Space;
    if WipeData() then
      Result := Result + 'Delete ' + DataDir()
    else
      Result := Result + 'Keep ' + DataDir();
  end;
  if MemoTasksInfo <> '' then Result := Result + NewLine + NewLine + MemoTasksInfo;
end;

{ Deletes the data before any file is installed. A running MicroPOS holds its database open: say so and stop rather
  than delete half of it. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Db: String;
begin
  Result := '';
  if not WipeData() then Exit;
  Db := DataDir() + '\micropos.db';
  if FileExists(Db) then
  begin
    if not RenameFile(Db, Db + '.closing') then
    begin
      Result := 'MicroPOS is running. Close it (Quit from its tray icon if it is kept running there), then click Back and Next to try again.';
      Exit;
    end;
    RenameFile(Db + '.closing', Db);
  end;
  if not DelTree(DataDir(), True, True, True) then
    Result := 'Could not delete everything in ' + DataDir() + '. Close MicroPOS and any window open on that folder, then try again.';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and not UninstallSilent() and DirExists(DataDir()) then
    if MsgBox('Also delete MicroPOS data (database, backups, logs, shop logo, settings) in' + #13#10 + DataDir() +
      '?' + #13#10#13#10 + 'Choose No to keep it for a later install. Deleting cannot be undone.',
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      if not DelTree(DataDir(), True, True, True) then
        MsgBox('Some files in ' + DataDir() + ' could not be deleted. Delete the folder by hand.', mbError, MB_OK);
end;
