::==========================================================
::
::  This script will automatically sync sample.env in the current directory with .env. 
::  Also supports multiple .env files starting with "sample.env"
::
::  ##!!##  Do not use this in production   ##!!## 
::  This script reqrites the target environment files directly.
::
::  - New variables from the sample.env but not in .env will be copied across.
::  - Changed variables in .env which are not empty will be preserved.
::  - Variables are sorted to match the sample.env ordering.
::  - Variables in .env that don't exist in sample.env are sorted to the end.
::  - Scrip outpuit highlights any new variables as well as any that don't exist in sample.env
::  - It will scan for and sync any files starting with sample.env
::
::  Examples:
::      sample.env          -> .env
::      sample.env.local    -> .env.local
::
::==========================================================

@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Environment Variable Updater (Multi-env)

set "PREFIX=sample.env"

echo ============================================
echo   Environment Variable Updater (Multi-env)
echo ============================================
echo.

::   --------------------------------------------------
::   Discover sample.env* files
::   --------------------------------------------------
set "FOUND_ANY=0"

echo Found files matching "%PREFIX%*":
echo --------------------------------------------

for %%F in (%PREFIX%*) do (
    echo   - %%F
    set "FOUND_ANY=1"
)

if "!FOUND_ANY!"=="0" (
    echo ERROR: No files found.
    exit /b 1
)


echo --------------------------------------------
echo.

::   --------------------------------------------------
::   Sync each discovered file
::   --------------------------------------------------
for %%F in (%PREFIX%*) do (
    call :sync_env "%%F"
)

echo.
echo ============================================
echo [OK] All environment files processed
echo ============================================
pause
exit /b



::==================================================
::  sync_env
::  %1 = sample file
::==================================================
:sync_env
setlocal EnableDelayedExpansion

set "SAMPLE_FILE=%~1"

::  ----- derive target file -----
::  Are we using sample.env or a file with a suffix?
if /i "%SAMPLE_FILE%"=="sample.env" (
    set "TARGET_FILE=.env"
) else (
    set "TARGET_FILE=.env%SAMPLE_FILE:sample.env=%"
)

echo.
echo --------------------------------------------
echo Syncing %TARGET_FILE% from %SAMPLE_FILE%
echo --------------------------------------------

::   ----- temp files -----
set "TEMP_NEW=%TARGET_FILE%.new"
set "TEMP_KEYS=%TARGET_FILE%.keys"
set "TEMP_EXTRA=%TARGET_FILE%.extra"
set "TEMP_ADDED=%TARGET_FILE%.added"

del "%TEMP_NEW%" "%TEMP_KEYS%" "%TEMP_EXTRA%" "%TEMP_ADDED%" >nul 2>&1

::   ----- create target if missing -----
if not exist "%TARGET_FILE%" (
    echo %TARGET_FILE% not found. Creating from %SAMPLE_FILE%...
    copy "%SAMPLE_FILE%" "%TARGET_FILE%" >nul
    endlocal
    goto :eof
)

::   ----- process sample file -----
for /f "usebackq delims=" %%L in (`findstr /n "^" "%SAMPLE_FILE%"`) do (
    set "line=%%L"
    set "line=!line:*:=!"
    call :process_line "%TARGET_FILE%" "%TEMP_NEW%" "%TEMP_KEYS%" "%TEMP_ADDED%"
)

::   ----- detect extra keys -----
for /f "tokens=1 delims==" %%A in (
    'findstr /r "^[^#][^=]*=" "%TARGET_FILE%"'
) do (
    if not "%%A"=="" (
        findstr /b /i "%%A=" "%TEMP_KEYS%" >nul
        if errorlevel 1 (
            echo %%A>>"%TEMP_EXTRA%"
        )
    )
)

::   ----- append extras -----
if exist "%TEMP_EXTRA%" (
    >>"%TEMP_NEW%" echo.
    >>"%TEMP_NEW%" echo # Extra variables kept from previous file
    echo Extra variables kept from previous file:
    for /f "usebackq delims=" %%X in ("%TEMP_EXTRA%") do (
        for /f "tokens=1,* delims==" %%C in ('findstr /b /i "%%X=" "%TARGET_FILE%"') do (
            >>"%TEMP_NEW%" echo %%C=%%D
            echo   + %%C
        )
    )
)

::  ----- replace target -----
::  This overwrites the existing environment file.
copy "%TEMP_NEW%" "%TARGET_FILE%" /Y >nul

if exist "%TEMP_ADDED%" (
    echo.
    echo New variables added to %TARGET_FILE%:
    for /f "usebackq delims=" %%A in ("%TEMP_ADDED%") do (
        echo   + %%A
    )

)

del "%TEMP_NEW%" "%TEMP_KEYS%" "%TEMP_EXTRA%" "%TEMP_ADDED%" >nul 2>&1

echo [OK] %TARGET_FILE% synced successfully
endlocal
goto :eof


::==================================================
::  process_line
::
::  Processes one line from the sample file and adds the corresponding line to the rebuilt target file.
::
::  Inputs:
::      line = Current sample-file line, set by :sync_env
::      %1   = Target environment file
::      %2   = Temporary rebuilt output file
::      %3   = Temporary list of keys found in the sample
::      %4   = Temporary list of newly added keys
::
::  Behavior:
::      - Copies blank lines and comments from the sample.
::      - For KEY=VALUE lines, preserves an existing non-empty value from the target file.
::      - Otherwise, uses the value from the sample and records the key as newly added.
::==================================================
:process_line
setlocal EnableDelayedExpansion

set "TARGET=%~1"
set "OUT=%~2"
set "KEYS=%~3"
set "ADDED=%~4"

::  blank line
if "!line!"=="" (
    >>"%OUT%" echo.
    endlocal
    goto :eof
)

::  comment
if "!line:~0,1!"=="#" (
    >>"%OUT%" echo !line!
    endlocal
    goto :eof
)

::  key/value
for /f "tokens=1,* delims==" %%A in ("!line!") do (
    set "key=%%A"
    set "value=%%B"
)

if "!key!"=="" (
    endlocal
    goto :eof
)

>>"%KEYS%" echo !key!=

set "existing="
for /f "tokens=1,* delims==" %%C in (
    'findstr /b /i "!key!=" "%TARGET%"'
) do (
    set "existing=%%D"
)

if defined existing (
    >>"%OUT%" echo !key!=!existing!
) else (
    >>"%OUT%" echo !key!=!value!
    >>"%ADDED%" echo !key!
)

endlocal
goto :eof
