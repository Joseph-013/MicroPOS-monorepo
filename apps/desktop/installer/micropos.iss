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

; The installed app's id. Never change it: it is how a later Setup finds this install (to upgrade it, or to refuse to
; put an older version over it).
#define AppGuid "AC933739-ED4B-4281-93EE-725399434856"
#define AppName "MicroPOS"
#define AppExe "micropos.exe"

[Setup]
; Never change AppGuid (above). "{{" is a literal "{" here.
AppId={{{#AppGuid}}
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
  OldAppPage: TWizardPage;
  OldRemoveBox: TNewCheckBox;
  DataPage: TWizardPage;
  KeepRadio, DeleteRadio, CopyRadio: TNewRadioButton;

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
  Result := (OldAppPage <> nil) and OldRemoveBox.Checked;
end;

{ A page laid out here rather than Inno's option-list page (whose list drew its radio buttons cut off at some display
  scalings): a wrapping text block, then the choices as ordinary buttons placed under it. Returns the page; Top is
  where the first choice goes. }
function CreateChoicePage(AfterID: Integer; ACaption, ADescription, AText: String; var Top: Integer): TWizardPage;
var
  Text: TNewStaticText;
begin
  Result := CreateCustomPage(AfterID, ACaption, ADescription);
  Text := TNewStaticText.Create(Result);
  Text.Parent := Result.Surface;
  Text.Left := 0;
  Text.Top := 0;
  Text.Width := Result.SurfaceWidth;
  Text.WordWrap := True;
  Text.AutoSize := True;
  Text.Caption := AText;
  Top := Text.Top + Text.Height + ScaleY(16);
end;

function AddRadio(Page: TWizardPage; ACaption: String; var Top: Integer): TNewRadioButton;
begin
  Result := TNewRadioButton.Create(Page);
  Result.Parent := Page.Surface;
  Result.Left := 0;
  Result.Top := Top;
  Result.Width := Page.SurfaceWidth;
  Result.Height := ScaleY(20);
  Result.Caption := ACaption;
  Top := Top + Result.Height + ScaleY(8);
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
{ The version of MicroPOS already installed (for this user or for all users), or '' when there is none. }
function InstalledVersion(): String;
var
  Key: String;
begin
  Result := '';
  Key := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{{#AppGuid}}_is1';
  if not RegQueryStringValue(HKCU, Key, 'DisplayVersion', Result) then
    if not RegQueryStringValue(HKLM64, Key, 'DisplayVersion', Result) then
      RegQueryStringValue(HKLM32, Key, 'DisplayVersion', Result);
end;

{ Never installs an older MicroPOS over a newer one: the newer one may have brought the database up to a layout this
  version cannot open. The same version may be installed again (a repair). }
function InitializeSetup(): Boolean;
var
  Installed: String;
  InstalledPacked, ThisPacked: Int64;
begin
  Result := True;
  Installed := InstalledVersion();
  Log('Installed MicroPOS version: "' + Installed + '" (this setup: {#AppVersion})');
  if (Installed = '') or not StrToVersion(Installed, InstalledPacked) or not StrToVersion('{#AppVersion}', ThisPacked) then Exit;
  if ComparePackedVersion(InstalledPacked, ThisPacked) > 0 then
  begin
    SuppressibleMsgBox('MicroPOS ' + Installed + ' is installed, which is newer than this setup (' + '{#AppVersion}' + ').' + #13#10#13#10 +
      'Setup will not install an older version over it: the newer one may have updated the data to a ' +
      'format this version cannot open. Use the setup for ' + Installed + ' or later.', mbError, MB_OK, IDOK);
    Result := False;
  end;
end;

{ Data page choices: keep, delete, or save a copy on the Desktop and delete. }
function WipeData(): Boolean;
begin
  Result := (DataPage <> nil) and (DeleteRadio.Checked or CopyRadio.Checked);
end;

function CopyDataFirst(): Boolean;
begin
  Result := (DataPage <> nil) and CopyRadio.Checked;
end;

procedure InitializeWizard();
var
  AfterID, Top: Integer;
  Old: Boolean;
  Intro: String;
begin
  AfterID := wpSelectDir;
  if OldAppFound() then
  begin
    OldAppPage := CreateChoicePage(AfterID,
      'Old MicroPOS found',
      'The first MicroPOS (version 1) is installed on this computer.',
      'It is a separate program from this one. Removing it closes it and takes away its program files, shortcuts and ' +
      'its entry in Installed apps. What to do with its data is the next question.', Top);
    OldRemoveBox := TNewCheckBox.Create(OldAppPage);
    OldRemoveBox.Parent := OldAppPage.Surface;
    OldRemoveBox.Left := 0;
    OldRemoveBox.Top := Top;
    OldRemoveBox.Width := OldAppPage.SurfaceWidth;
    OldRemoveBox.Height := ScaleY(20);
    OldRemoveBox.Caption := 'Remove the old MicroPOS (recommended)';
    OldRemoveBox.Checked := True;
    AfterID := OldAppPage.ID;
  end;
  if not HasData() then Exit;
  Old := DataLooksOld();
  if Old then
    Intro := 'This version cannot open it, and MicroPOS will not start while it is there. Save a copy to keep the old records.'
  else
    Intro := 'It holds the database, backups, logs, the shop logo and settings. Choose what to do with it.';
  if Old then
    DataPage := CreateChoicePage(AfterID, 'Existing data', 'Data from the old MicroPOS (version 1) was found on this computer.',
      'Data folder:' + #13#10 + DataDir() + #13#10#13#10 + Intro, Top)
  else
    DataPage := CreateChoicePage(AfterID, 'Existing data', 'MicroPOS data was found on this computer.',
      'Data folder:' + #13#10 + DataDir() + #13#10#13#10 + Intro, Top);
  KeepRadio := AddRadio(DataPage, 'Keep existing data', Top);
  DeleteRadio := AddRadio(DataPage, 'Delete existing data and start fresh (cannot be undone)', Top);
  CopyRadio := AddRadio(DataPage, 'Save a copy of the database on the Desktop, then delete the data', Top);
  if Old then
    CopyRadio.Checked := True
  else
    KeepRadio.Checked := True;
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
