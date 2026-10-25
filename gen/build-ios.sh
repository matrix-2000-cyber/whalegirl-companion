#!/usr/bin/env bash
set -euo pipefail
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'iOS builds require macOS and Xcode. Android can be built on Windows.' >&2
  exit 1
fi
cd "$(dirname "$0")/../mobile-app"
flutter pub get
flutter analyze
flutter test
flutter build ios --release --no-codesign
echo 'Unsigned iOS app compiled. Open ios/Runner.xcworkspace in Xcode to choose your Apple team, sign and install/archive.'
echo 'This unsigned .app is not an installable iPhone package.'
