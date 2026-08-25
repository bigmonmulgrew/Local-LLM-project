@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem =============== Configuration ===============
set "ROOT=.\"
set "OUTPUT=.\file-structure.txt"
set "EXCLUDED_FOLDERS=.venv .git node_modules __pycache__ dist build"
rem =============================================

rem Convert paths to absolute paths
for %%R in ("%ROOT%") do set "ROOT=%%~fR"
for %%O in ("%OUTPUT%") do set "OUTPUT=%%~fO"

rem Create the report header
> "%OUTPUT%" echo(FOLDER STRUCTURE
>>"%OUTPUT%" echo(Root: %ROOT%
>>"%OUTPUT%" echo(Excluded: %EXCLUDED_FOLDERS%
>>"%OUTPUT%" echo(Generated: %DATE% %TIME%
>>"%OUTPUT%" echo(
>>"%OUTPUT%" echo(%ROOT%\

call :WalkTree "%ROOT%" ""
exit /b


:WalkTree
setlocal EnableDelayedExpansion

set "CURRENT=%~1"
set "PREFIX=%~2"
set /a DIR_COUNT=0
set /a FILE_COUNT=0

rem Count included subfolders
for /d %%D in ("%CURRENT%\*") do (
    call :IsExcluded "%%~nxD"
    if errorlevel 1 set /a DIR_COUNT+=1
)

rem Count files, excluding the generated report itself
for %%F in ("%CURRENT%\*") do (
    if not exist "%%~fF\" (
        if /I not "%%~fF"=="!OUTPUT!" set /a FILE_COUNT+=1
    )
)

set /a TOTAL_ITEMS=DIR_COUNT+FILE_COUNT
set /a ITEM_NUMBER=0

rem Print folders first
for /d %%D in ("%CURRENT%\*") do (
    call :IsExcluded "%%~nxD"

    if errorlevel 1 (
        set /a ITEM_NUMBER+=1

        if !ITEM_NUMBER! EQU !TOTAL_ITEMS! (
            set "CONNECTOR=\---"
            set "CHILD_PREFIX=!PREFIX!    "
        ) else (
            set "CONNECTOR=+---"
            set "CHILD_PREFIX=!PREFIX!|   "
        )

        >>"!OUTPUT!" echo(!PREFIX!!CONNECTOR!%%~nxD\
        call :WalkTree "%%~fD" "!CHILD_PREFIX!"
    )
)

rem Print files after folders
for %%F in ("%CURRENT%\*") do (
    if not exist "%%~fF\" (
        if /I not "%%~fF"=="!OUTPUT!" (
            set /a ITEM_NUMBER+=1

            if !ITEM_NUMBER! EQU !TOTAL_ITEMS! (
                set "CONNECTOR=\---"
            ) else (
                set "CONNECTOR=+---"
            )

            >>"!OUTPUT!" echo(!PREFIX!!CONNECTOR!%%~nxF
        )
    )
)

endlocal
exit /b


:IsExcluded
for %%X in (%EXCLUDED_FOLDERS%) do (
    if /I "%~1"=="%%X" exit /b 0
)
exit /b 1