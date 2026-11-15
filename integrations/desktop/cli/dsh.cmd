@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\..\..\iPolloWork.exe" --expose-internals "%~dp0..\..\..\dsh\node_modules\@ipollo\desktop-host\lib\cli.js" %*
exit /b %errorlevel%
