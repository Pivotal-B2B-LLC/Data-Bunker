@echo off
echo.
echo ================================================================================
echo    GLOBAL BUSINESS DATA DOMINATION
echo    TARGET: 130+ MILLION BUSINESSES WORLDWIDE
echo ================================================================================
echo.
echo Step 1: Generating comprehensive city lists...
echo.

REM Generate USA cities (all 20,000+)
echo [1/3] Generating USA cities database...
start /B node usa-all-cities-generator.js > usa-cities-generation.log 2>&1

REM Generate global cities
echo [2/3] Generating global cities database...
start /B node global-cities-generator.js > global-cities-generation.log 2>&1

echo.
echo City generation started in background...
echo This will take 30-60 minutes.
echo.
echo Logs:
echo   - usa-cities-generation.log
echo   - global-cities-generation.log
echo.
echo ================================================================================
echo.
echo After generation completes, run:
echo   node mega-global-discovery.js 100
echo.
echo Or wait 1 hour and I'll start it automatically...
echo.
echo Press Ctrl+C to cancel auto-start
echo.

REM Wait 1 hour for city generation
timeout /t 3600 /nobreak

echo.
echo ================================================================================
echo Starting MEGA GLOBAL DISCOVERY with 100 parallel workers...
echo ================================================================================
echo.

node mega-global-discovery.js 100

pause
