#!/bin/sh
# Testy logiki (generator planu, lista zakupów, .ics, import) — bez Node, na JavaScriptCore z macOS.
cd "$(dirname "$0")/.." || exit 1
exec /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/run-jsc.js
