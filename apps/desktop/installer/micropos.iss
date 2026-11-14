; MicroPOS Windows installer (Inno Setup 6). Built by `pnpm make` on Windows (scripts/make.mjs), which packages the
; app with Electron Forge first and passes these defines:
;   AppVersion  version from package.json
;   SourceDir   the packaged app folder (out\MicroPOS-win32-x64)
;   OutputDir   where Setup goes (out\make\inno)
;   IconFile    assets\icon.ico
;   OldCleanup  remove-old-micropos.ps1 at the repo root (removes the first MicroPOS, version 1)
;
; Wizard: install for me only / for all users, welcome, install folder, old MicroPOS (only when version 1, the Squirrel
; install in %LOCALAPPDATA%\micropos, is found: remove it), existing data (only when the data folder has something in
; it: keep, delete, or save a copy on the Desktop and delete), shortcuts, ready, install, launch. The uninstaller asks
; whether to delete the data. The app's data lives per Windows user in %APPDATA%\micropos (Electron's userData),
; whichever install mode is chosen.

#ifndef AppVersion
  #error AppVersion is not defined: build with `pnpm make` (scripts/make.mjs)
#endif
#ifndef OldCleanup
  #error OldCleanup is not defined: build with `pnpm make` (scripts/make.mjs)
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
; Not installed: extracted to a temporary folder and run when the old MicroPOS is to be removed.
Source: "{#OldCleanup}"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[Code]
var
  OldAppPage: TInputOptionWizardPage;
  DataPage: TInputOptionWizardPage;

function DataDir(): String;
begin
  Result := ExpandConstant('{userappdata}\micropos');
end;

{ The first MicroPOS (version 1) was a Squirrel install in %LOCALAPPDATA%\micropos, listed in Installed apps as "micropos". }
function OldAppFound(): Boolean;
begin
  Result := FileExists(ExpandConstant('{localappdata}\micropos\Update.exe')) or
    RegKeyExists(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\micropos');
end;

function RemoveOldApp(): Boolean;
begin
  Result := (OldAppPage <> nil) and OldAppPage.Values[0];
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

{ Data this version made has a backups folder (a backup is made at the first start of every day) or, from 2.0 to
  2.20.0, the marker micropos-data.json. A database with neither is version 1's, which this version cannot open. }
function DataLooksOld(): Boolean;
begin
  Result := FileExists(DataDir() + '\micropos.db') and not DirExists(DataDir() + '\backups') and
    not FileExists(DataDir() + '\micropos-data.json');
end;

{ Data page choices: 0 keep, 1 delete, 2 save a copy on the Desktop and delete. }
function WipeData(): Boolean;
begin
  Result := (DataPage <> nil) and (DataPage.Values[1] or DataPage.Values[2]);
end;

function CopyDataFirst(): Boolean;
begin
  Result := (DataPage <> nil) and DataPage.Values[2];
end;

procedure InitializeWizard();
var
  AfterID: Integer;
  Old: Boolean;
begin
  AfterID := wpSelectDir;
  if OldAppFound() then
  begin
    OldAppPage := CreateInputOptionPage(AfterID,
      'Old MicroPOS found',
      'The first MicroPOS (version 1) is installed on this computer.',
      'It is a separate program from this one. Removing it closes it and takes away its program files, shortcuts and ' +
      'its entry in Installed apps. What to do with its data is the next question.',
      False, False);
    OldAppPage.Add('Remove the old MicroPOS (recommended)');
    OldAppPage.Values[0] := True;
    AfterID := OldAppPage.ID;
  end;
  if not HasData() then Exit;
  Old := DataLooksOld();
  if Old then
    DataPage := CreateInputOptionPage(AfterID,
      'Existing data',
      'Data from the old MicroPOS (version 1) was found on this computer.',
      'Data folder:' + #13#10 + DataDir() + #13#10#13#10 +
      'This version cannot open it, and MicroPOS will not start while it is there. Save a copy to keep the old records.',
      True, False)
  else
    DataPage := CreateInputOptionPage(AfterID,
      'Existing data',
      'MicroPOS data was found on this computer.',
      'Data folder:' + #13#10 + DataDir() + #13#10#13#10 +
      'It holds the database, backups, logs, the shop logo and settings. Choose what to do with it.',
      True, False);
  DataPage.Add('Keep existing data');
  DataPage.Add('Delete existing data and start fresh (cannot be undone)');
  DataPage.Add('Save a copy of the database on the Desktop, then delete the data');
  if Old then
    DataPage.Values[2] := True
  else
    DataPage.Values[0] := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  { A silent install (/SILENT, /VERYSILENT) takes the page's default without asking. }
  if (DataPage <> nil) and (CurPageID = DataPage.ID) and not WizardSilent() then
  begin
    if CopyDataFirst() then
      Result := MsgBox('A copy of the database will be saved in a new folder on the Desktop, then all MicroPOS data in' + #13#10 +
        DataDir() + #13#10 + 'will be deleted when installation starts.' + #13#10#13#10 + 'Continue?',
        mbConfirmation, MB_YESNO) = IDYES
    else if WipeData() then
      Result := MsgBox('All MicroPOS data in' + #13#10 + DataDir() + #13#10 +
        'will be deleted when installation starts. This cannot be undone.' + #13#10#13#10 + 'Continue?',
        mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES
    else if DataLooksOld() then
      Result := MsgBox('This data is from the old MicroPOS, which this version cannot open: MicroPOS will not start ' +
        'until it is removed.' + #13#10#13#10 + 'Keep it anyway?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo,
  MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := MemoDirInfo;
  if OldAppPage <> nil then
  begin
    Result := Result + NewLine + NewLine + 'Old MicroPOS (version 1):' + NewLine + Space;
    if RemoveOldApp() then
      Result := Result + 'Remove'
    else
      Result := Result + 'Leave installed';
  end;
  if DataPage <> nil then
  begin
    Result := Result + NewLine + NewLine + 'Existing data:' + NewLine + Space;
    if CopyDataFirst() then
      Result := Result + 'Save a copy on the Desktop, then delete ' + DataDir()
    else if WipeData() then
      Result := Result + 'Delete ' + DataDir()
    else
      Result := Result + 'Keep ' + DataDir();
  end;
  if MemoTasksInfo <> '' then Result := Result + NewLine + NewLine + MemoTasksInfo;
end;

{ Runs remove-old-micropos.ps1 (closes the old app, runs its uninstaller, deletes its program folder, shortcuts and
  Installed apps entry). -KeepData: the data is this wizard's business. Returns '' or what went wrong. }
function RemoveOld(): String;
var
  Script: String;
  Code: Integer;
begin
  Result := '';
  ExtractTemporaryFile('remove-old-micropos.ps1');
  Script := ExpandConstant('{tmp}\remove-old-micropos.ps1');
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" -Yes -KeepData', '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Result := 'Could not start the removal of the old MicroPOS. Uninstall it from Installed apps, then run this setup again.'
  else if Code = 2 then
    Log('Old MicroPOS removed; some of its files were in use and go after a restart.')
  else if Code <> 0 then
    Result := 'Could not remove the old MicroPOS (code ' + IntToStr(Code) + '). Uninstall it from Installed apps, then run this setup again.'
  else
    Log('Old MicroPOS removed.');
end;

{ Copies micropos.db (with its -wal and -shm) into a new folder on the Desktop. Returns '' or what went wrong. }
function CopyDatabase(): String;
var
  Dest: String;
begin
  Result := '';
  if not FileExists(DataDir() + '\micropos.db') then Exit;
  Dest := ExpandConstant('{userdesktop}') + '\MicroPOS data copy ' + GetDateTimeString('yyyy-mm-dd hhnnss', '-', '-');
  if not ForceDirectories(Dest) then
  begin
    Result := 'Could not make the folder ' + Dest + ' for the copy. Nothing was deleted.';
    Exit;
  end;
  if not FileCopy(DataDir() + '\micropos.db', Dest + '\micropos.db', False) then
  begin
    Result := 'Could not copy the database to ' + Dest + '. Nothing was deleted.';
    Exit;
  end;
  if FileExists(DataDir() + '\micropos.db-wal') then FileCopy(DataDir() + '\micropos.db-wal', Dest + '\micropos.db-wal', False);
  if FileExists(DataDir() + '\micropos.db-shm') then FileCopy(DataDir() + '\micropos.db-shm', Dest + '\micropos.db-shm', False);
  Log('Database copied to ' + Dest);
end;

{ Before any file is installed: removes the old MicroPOS, then copies and deletes the data as chosen. A running
  MicroPOS holds its database open: say so and stop rather than delete half of it. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Db: String;
begin
  Result := '';
  if RemoveOldApp() then
  begin
    Result := RemoveOld();
    if Result <> '' then Exit;
  end;
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
  if CopyDataFirst() then
  begin
    Result := CopyDatabase();
    if Result <> '' then Exit;
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
