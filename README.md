# Mobile Agent

Mobile Agent is an open-source AI agent built specifically for mobile devices that runs entirely on your phone.

## Demo

[![Mobile Agent demo](https://img.youtube.com/vi/_P_SQ0MW-aU/maxresdefault.jpg)](https://youtu.be/_P_SQ0MW-aU?si=klxA4b7RU3Y2j5iy)

## Features

- On-device models that can run completely offline
- Runs completely on-device
- No external server required
- MCP support
- Skills system
- Persistent memory
- Multi-modal support
- Direct access to phone's internal storage
- Android permission-based access

## Installation

The application is distributed through GitHub Releases.

1. Download the latest APK from the Releases page.
2. Install the APK on your Android device.
3. Grant the required permissions.
4. Start using Mobile Agent.

## Voice input

System speech recognition is the default. In **Settings → Voice input**, you can
download multilingual Whisper Tiny (~78 MB) or Base (~148 MB), then select it for
offline transcription on Android/iOS. Downloads show progress and can be cancelled;
models can also be deleted. Deleting the selected model switches back to System.

Tap the microphone, speak, then tap ✓ to insert the transcription for editing.
Local Whisper processes audio after confirmation, keeps audio on-device, and limits
each recording to two minutes. Speed and runtime memory usage depend on the phone.

Developers must rebuild the native app after installing the `expo-audio` and
`whisper.rn` dependencies; Metro reload alone is not enough. The Whisper config
plugin preserves its JNI classes in Android release builds. Local voice input is
not supported on web.

## Contributing

Contributions are welcome. Feel free to open an issue for bug reports, feature requests, or submit a pull request if you'd like to contribute.

## License

This project is licensed under the MIT License.
